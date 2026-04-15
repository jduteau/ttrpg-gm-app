#!/usr/bin/env node
/**
 * TTRPG GM App — Session Importer
 *
 * Imports existing session blog posts (markdown or text files) into the app database.
 *
 * Usage:
 *   node import-sessions.js --campaign ose.lolth-conspiracy --file "session1.md" --title "Session 1"
 *   node import-sessions.js --campaign ose.lolth-conspiracy --file "session1.md"   (title inferred from filename)
 *   node import-sessions.js --campaign ironsworn-badlands.jake-powell --dir "./ironsworn-sessions/"  (bulk import folder)
 *
 * Campaign IDs: ose.lolth-conspiracy, masks.halcyon-city, dragonbane.mercy-row, ironsworn-badlands.jake-powell
 *
 * The blog post is imported as an "archive" role message — displayed differently
 * in the UI to distinguish it from live session content. You can then continue
 * the session normally and the GM will have the post as context.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, basename, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
const dirPath    = getArg('dir');
const titleArg   = getArg('title');
const listFlag   = hasFlag('list');
const helpFlag   = hasFlag('help') || args.length === 0;

const VALID_CAMPAIGNS = ['ose.lolth-conspiracy', 'masks.halcyon-city', 'dragonbane.mercy-row', 'ironsworn-badlands.jake-powell'];
const CAMPAIGN_NAMES = {
  'ose.lolth-conspiracy': 'OSE Advanced Fantasy — The Lolth Conspiracy',
  'masks.halcyon-city': 'Masks: A New Generation — Halcyon City Heroes',
  'dragonbane.mercy-row': 'Dragonbane — Mercy Row',
  'ironsworn-badlands.jake-powell': 'Ironsworn: Badlands — Jake Powell\'s Journey',
};

if (helpFlag) {
  console.log(`
TTRPG GM App — Session Importer
────────────────────────────────
Import existing session blog posts into the app.

Single file:
  node import-sessions.js --campaign ose.lolth-conspiracy --file "path/to/session1.md"
  node import-sessions.js --campaign ose.lolth-conspiracy --file "session1.md" --title "The Village of Hommlet"

Bulk import a folder (all .md and .txt files):
  node import-sessions.js --campaign ose.lolth-conspiracy --dir "./my-ose-sessions/"

List current sessions in the database:
  node import-sessions.js --list

Campaign IDs: ${VALID_CAMPAIGNS.join(', ')}
`);
  process.exit(0);
}

// ── Open database ────────────────────────────────────────────────────────────
const DATA_DIR = join(__dirname, 'server', 'data');
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
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

function titleFromFilename(filename) {
  return basename(filename, extname(filename))
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function importFile(campaign, file, title) {
  if (!existsSync(file)) {
    console.error(`✗ File not found: ${file}`);
    return false;
  }

  const content = readFileSync(file, 'utf-8').trim();
  if (!content) {
    console.error(`✗ File is empty: ${file}`);
    return false;
  }

  const resolvedTitle = title || titleFromFilename(file);
  const now = new Date().toISOString();

  // Create the session
  const sessionId = dbInsert(
    'INSERT INTO sessions (campaign_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [campaign, resolvedTitle, now, now]
  );

  // Insert as 'archive' role — rendered specially in the UI
  dbInsert(
    'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
    [sessionId, 'archive', content, now]
  );

  saveDb();
  console.log(`✓ Imported "${resolvedTitle}" → ${CAMPAIGN_NAMES[campaign]} (session id: ${sessionId})`);
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
        console.log(`\n${CAMPAIGN_NAMES[s.campaign_id] || s.campaign_id}`);
        lastCampaign = s.campaign_id;
      }
      const msgCount = dbGet('SELECT COUNT(*) as count FROM messages WHERE session_id = ?', [s.id]);
      console.log(`  [${s.id}] ${s.title}  (${msgCount.count} messages)`);
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
if (!VALID_CAMPAIGNS.includes(campaignId)) {
  console.error(`Error: unknown campaign "${campaignId}". Valid options: ${VALID_CAMPAIGNS.join(', ')}`);
  process.exit(1);
}

// Single file import
if (filePath) {
  const ok = importFile(campaignId, filePath, titleArg);
  process.exit(ok ? 0 : 1);
}

// Bulk directory import
if (dirPath) {
  if (!existsSync(dirPath)) {
    console.error(`Error: directory not found: ${dirPath}`);
    process.exit(1);
  }
  const files = readdirSync(dirPath)
    .filter(f => ['.md', '.txt'].includes(extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    console.error(`No .md or .txt files found in ${dirPath}`);
    process.exit(1);
  }

  console.log(`Importing ${files.length} file(s) into ${CAMPAIGN_NAMES[campaignId]}...\n`);
  let ok = 0;
  for (const file of files) {
    if (importFile(campaignId, join(dirPath, file), null)) ok++;
  }
  console.log(`\nDone: ${ok}/${files.length} imported.`);
  process.exit(ok === files.length ? 0 : 1);
}

console.error('Error: provide --file or --dir. Use --help for usage.');
process.exit(1);
