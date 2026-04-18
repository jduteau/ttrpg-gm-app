#!/usr/bin/env node
/**
 * TTRPG GM App — Session Importer
 *
 * Imports existing session recaps and/or state files into the app database.
 *
 * Usage:
 *   node import-sessions.js --campaign ose.lolth-conspiracy --file "session1.md"
 *   node import-sessions.js --campaign ose.lolth-conspiracy --file "session1.md" --title "Session 1"
 *   node import-sessions.js --campaign ose.lolth-conspiracy --file "session1.md" --state "session1-state.md"
 *   node import-sessions.js --campaign ose.lolth-conspiracy --dir "./my-sessions/"  (bulk import folder)
 *
 * The recap is imported as an "archive" role message — rendered as a gold-bordered block in the UI.
 * The state (--state) is imported as a "state" role message and marks the session as ended.
 * You can import state-only (--state without --file) to record just the state for a session.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from 'fs';
import { join, basename, extname, dirname, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load sql.js from server's node_modules (not installed at root level)
const serverRequire = createRequire(join(__dirname, 'server', 'index.js'));
const initSqlJs = serverRequire('sql.js');

// Expand ~ and resolve to absolute path, strip shell escape backslashes
function resolvePath(p) {
  if (!p) return p;
  p = p.replace(/\\(.)/g, '$1');  // unescape shell backslash sequences (e.g. "\ " → " ")
  if (p.startsWith('~/') || p === '~') {
    p = join(process.env.HOME, p.slice(1));
  }
  return isAbsolute(p) ? p : resolve(p);
}

// ── Parse args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const campaignId = getArg('campaign');
const filePath   = getArg('file');
const statePath  = getArg('state');
const dirPath    = getArg('dir');
const titleArg   = getArg('title');
const listFlag   = hasFlag('list');
const helpFlag   = hasFlag('help') || args.length === 0;

// ── Discover valid campaigns by scanning rulesets directory ───────────────────
const CONTENT_DIR = process.env.CONTENT_DIR
  ? resolve(process.env.CONTENT_DIR)
  : join(__dirname, 'content');
const RULESETS_DIR = join(CONTENT_DIR, 'rulesets');

function discoverCampaigns() {
  const campaigns = [];
  if (!existsSync(RULESETS_DIR)) return campaigns;
  const rulesetDirs = readdirSync(RULESETS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);
  for (const rulesetId of rulesetDirs) {
    const campaignsDir = join(RULESETS_DIR, rulesetId, 'campaigns');
    if (!existsSync(campaignsDir)) continue;
    const campaignDirs = readdirSync(campaignsDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name);
    for (const campId of campaignDirs) {
      campaigns.push(`${rulesetId}.${campId}`);
    }
  }
  return campaigns;
}

const VALID_CAMPAIGNS = discoverCampaigns();

if (helpFlag) {
  console.log(`
TTRPG GM App — Session Importer
────────────────────────────────
Import existing session recaps and/or state files into the app.

Single file (recap only):
  node import-sessions.js --campaign ose.lolth-conspiracy --file "path/to/session1.md"
  node import-sessions.js --campaign ose.lolth-conspiracy --file "session1.md" --title "The Village of Hommlet"

Recap + state (marks session as ended):
  node import-sessions.js --campaign ose.lolth-conspiracy --file "session1.md" --state "session1-state.md"

State only (no recap):
  node import-sessions.js --campaign ose.lolth-conspiracy --state "session1-state.md" --title "Session 1"

Bulk import a folder (all .md and .txt files as recaps, no state):
  node import-sessions.js --campaign ose.lolth-conspiracy --dir "./my-ose-sessions/"

List current sessions in the database:
  node import-sessions.js --list

Available campaigns: ${VALID_CAMPAIGNS.length > 0 ? VALID_CAMPAIGNS.join(', ') : '(none found — check content/rulesets/ directory)'}
`);
  process.exit(0);
}

// ── Open database ────────────────────────────────────────────────────────────
const DATA_DIR = join(CONTENT_DIR, 'data');
const DB_PATH  = join(DATA_DIR, 'sessions.db');
mkdirSync(DATA_DIR, { recursive: true });

const SQL = await initSqlJs();
const db  = existsSync(DB_PATH)
  ? new SQL.Database(readFileSync(DB_PATH))
  : new SQL.Database();

function saveDb() {
  writeFileSync(DB_PATH, db.export());
}

// Ensure tables exist
db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id   TEXT NOT NULL,
    title         TEXT NOT NULL,
    context_files TEXT NOT NULL DEFAULT '[]',
    ended_at      TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )
`);
saveDb();

// ── Helpers ──────────────────────────────────────────────────────────────────
function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbInsert(sql, params = []) {
  db.run(sql, params);
  return dbGet('SELECT last_insert_rowid() as id').id;
}

function saveSessionStateFile(campaignId, stateContent) {
  const [rulesetId, campId] = campaignId.split('.');
  const campaignPath = join(__dirname, 'server', 'rulesets', rulesetId, 'campaigns', campId);
  const statePath    = join(campaignPath, 'session-state.md');
  const backupDir    = join(campaignPath, 'state-backups');
  mkdirSync(backupDir, { recursive: true });

  if (existsSync(statePath)) {
    const ts = new Date().toISOString().replace('T', '-').slice(0, 16).replace(':', '');
    const backupPath = join(backupDir, `session-state-${ts}.md`);
    copyFileSync(statePath, backupPath);
    console.log(`  → Backed up existing state to state-backups/session-state-${ts}.md`);
  }

  writeFileSync(statePath, stateContent, 'utf-8');
  console.log(`  → Wrote session-state.md`);
}

function titleFromFilename(filename) {
  return basename(filename, extname(filename))
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function importSession(campaign, { recapFile, stateFile, title }) {
  if (!recapFile && !stateFile) {
    console.error('Error: provide --file and/or --state');
    return false;
  }

  let recapContent = null;
  if (recapFile) {
    if (!existsSync(recapFile)) { console.error(`✗ File not found: ${recapFile}`); return false; }
    recapContent = readFileSync(recapFile, 'utf-8').trim();
    if (!recapContent) { console.error(`✗ File is empty: ${recapFile}`); return false; }
  }

  let stateContent = null;
  if (stateFile) {
    if (!existsSync(stateFile)) { console.error(`✗ State file not found: ${stateFile}`); return false; }
    stateContent = readFileSync(stateFile, 'utf-8').trim();
    if (!stateContent) { console.error(`✗ State file is empty: ${stateFile}`); return false; }
  }

  const resolvedTitle = title || (recapFile ? titleFromFilename(recapFile) : stateFile ? titleFromFilename(stateFile) : 'Imported Session');
  const now = new Date().toISOString();
  const endedAt = stateContent ? now : null;

  const sessionId = dbInsert(
    'INSERT INTO sessions (campaign_id, title, ended_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [campaign, resolvedTitle, endedAt, now, now]
  );

  if (recapContent) {
    dbInsert(
      'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
      [sessionId, 'archive', recapContent, now]
    );
  }

  if (stateContent) {
    dbInsert(
      'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
      [sessionId, 'state', stateContent, now]
    );
    saveSessionStateFile(campaign, stateContent);
  }

  saveDb();

  const parts = [];
  if (recapContent) parts.push('recap');
  if (stateContent) parts.push('state');
  console.log(`✓ Imported "${resolvedTitle}" [${parts.join(' + ')}] → ${campaign} (session id: ${sessionId})`);
  return true;
}

// ── Commands ─────────────────────────────────────────────────────────────────

if (listFlag) {
  const sessions = dbAll('SELECT * FROM sessions ORDER BY campaign_id, created_at ASC');
  if (sessions.length === 0) {
    console.log('No sessions in database yet.');
  } else {
    let lastCampaign = null;
    for (const s of sessions) {
      if (s.campaign_id !== lastCampaign) {
        console.log(`\n${s.campaign_id}`);
        lastCampaign = s.campaign_id;
      }
      const msgCount = dbGet('SELECT COUNT(*) as count FROM messages WHERE session_id = ?', [s.id]);
      const ended = s.ended_at ? ' [ended]' : '';
      console.log(`  [${s.id}] ${s.title}${ended}  (${msgCount.count} messages)`);
    }
    console.log('');
  }
  process.exit(0);
}

// Validate campaign
if (!campaignId) {
  console.error('Error: --campaign is required. Use --help for usage.');
  process.exit(1);
}
if (VALID_CAMPAIGNS.length > 0 && !VALID_CAMPAIGNS.includes(campaignId)) {
  console.error(`Error: unknown campaign "${campaignId}". Valid options: ${VALID_CAMPAIGNS.join(', ')}`);
  process.exit(1);
}

// Single file import (recap and/or state)
if (filePath || statePath) {
  if (dirPath) {
    console.error('Error: --dir cannot be combined with --file or --state.');
    process.exit(1);
  }
  const ok = importSession(campaignId, {
    recapFile: filePath ? resolvePath(filePath) : null,
    stateFile: statePath ? resolvePath(statePath) : null,
    title: titleArg
  });
  process.exit(ok ? 0 : 1);
}

// Bulk directory import (recaps only)
if (dirPath) {
  const resolvedDir = resolvePath(dirPath);
  if (!existsSync(resolvedDir)) {
    console.error(`Error: directory not found: ${resolvedDir}`);
    process.exit(1);
  }
  const files = readdirSync(resolvedDir)
    .filter(f => ['.md', '.txt'].includes(extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    console.error(`No .md or .txt files found in ${resolvedDir}`);
    process.exit(1);
  }

  console.log(`Importing ${files.length} file(s) into ${campaignId}...\n`);
  let ok = 0;
  for (const file of files) {
    if (importSession(campaignId, { recapFile: join(resolvedDir, file), title: null })) ok++;
  }
  console.log(`\nDone: ${ok}/${files.length} imported.`);
  process.exit(ok === files.length ? 0 : 1);
}

console.error('Error: provide --file or --dir. Use --help for usage.');
process.exit(1);
