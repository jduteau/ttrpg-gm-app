import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';
import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const isProd = process.env.NODE_ENV === 'production';
app.use(cors(isProd ? {} : { origin: 'http://localhost:5173' }));
app.use(express.json());

if (isProd) {
  const clientDist = join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
}

// ── Database ─────────────────────────────────────────────────────────────────
const DATA_DIR = join(__dirname, 'data');
const DB_PATH  = join(DATA_DIR, 'sessions.db');
mkdirSync(DATA_DIR, { recursive: true });

const SQL = await initSqlJs();
const db  = existsSync(DB_PATH)
  ? new SQL.Database(readFileSync(DB_PATH))
  : new SQL.Database();

function saveDb() { writeFileSync(DB_PATH, db.export()); }

function dbRun(sql, params = []) { db.run(sql, params); saveDb(); }

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
  const id = dbGet('SELECT last_insert_rowid() as id').id;
  saveDb();
  return id;
}

db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id   TEXT NOT NULL,
    title         TEXT NOT NULL,
    context_files TEXT NOT NULL DEFAULT '[]',
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
// Migrate existing sessions that lack context_files column (safe to run repeatedly)
try { db.run(`ALTER TABLE sessions ADD COLUMN context_files TEXT NOT NULL DEFAULT '[]'`); } catch {}
saveDb();

// ── Campaigns ─────────────────────────────────────────────────────────────────
const CAMPAIGNS = {
  ose:        { id: 'ose',        name: 'OSE Advanced Fantasy',    subtitle: 'The Lolth Conspiracy',  icon: '⚔️',  color: '#c0392b' },
  masks:      { id: 'masks',      name: 'Masks: A New Generation', subtitle: 'Superhero Drama',        icon: '🦸',  color: '#8e44ad' },
  dragonbane: { id: 'dragonbane', name: 'Dragonbane',              subtitle: 'Mythic Fantasy',         icon: '🐉',  color: '#16a085' },
  ironsworn:  { id: 'ironsworn',  name: 'Ironsworn: Badlands',     subtitle: "Jake Powell's Journey",  icon: '🤠',  color: '#d35400' },
};

// ── File helpers ──────────────────────────────────────────────────────────────
const CAMPAIGNS_DIR = join(__dirname, 'campaigns');

function campaignDir(campaignId) {
  return join(CAMPAIGNS_DIR, campaignId);
}

function labelFromFilename(filename) {
  return basename(filename, extname(filename))
    .replace(/^\d+-/, '')        // strip leading "01-" ordering prefixes
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function listFolder(campaignId, subfolder) {
  const dir = join(campaignDir(campaignId), subfolder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => ['.md', '.txt'].includes(extname(f).toLowerCase()))
    .sort()
    .map(f => ({
      path: `${subfolder}/${f}`,
      label: labelFromFilename(f),
    }));
}

function loadCampaignFiles(campaignId, contextFiles = []) {
  const dir = campaignDir(campaignId);
  const parts = [];

  // Always load system prompt
  const promptPath = join(dir, 'system-prompt.md');
  if (existsSync(promptPath)) {
    parts.push(readFileSync(promptPath, 'utf-8').trim());
  } else {
    parts.push(`You are a GM for the ${CAMPAIGNS[campaignId]?.name ?? campaignId} campaign.`);
  }

  // Load selected context files
  for (const filePath of contextFiles) {
    const fullPath = join(dir, filePath);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8').trim();
      const label = labelFromFilename(filePath);
      parts.push(`\n\n---\n# ${label}\n\n${content}`);
    }
  }

  return parts.join('\n\n');
}

// ── Anthropic ─────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Routes ────────────────────────────────────────────────────────────────────

// Campaigns list
app.get('/api/campaigns', (req, res) => {
  res.json(Object.values(CAMPAIGNS).map(({ id, name, subtitle, icon, color }) => ({
    id, name, subtitle, icon, color,
  })));
});

// Available files for a campaign
app.get('/api/campaigns/:campaignId/files', (req, res) => {
  const { campaignId } = req.params;
  if (!CAMPAIGNS[campaignId]) return res.status(404).json({ error: 'Campaign not found' });
  res.json({
    modules:    listFolder(campaignId, 'modules'),
    references: listFolder(campaignId, 'references'),
  });
});

// Sessions for a campaign
app.get('/api/campaigns/:campaignId/sessions', (req, res) => {
  const sessions = dbAll(
    'SELECT * FROM sessions WHERE campaign_id = ? ORDER BY updated_at DESC',
    [req.params.campaignId]
  );
  res.json(sessions.map(s => ({
    ...s,
    context_files: JSON.parse(s.context_files || '[]'),
  })));
});

// Create session
app.post('/api/campaigns/:campaignId/sessions', (req, res) => {
  const { campaignId } = req.params;
  if (!CAMPAIGNS[campaignId]) return res.status(404).json({ error: 'Campaign not found' });
  const now = new Date().toISOString();
  const count = dbGet('SELECT COUNT(*) as count FROM sessions WHERE campaign_id = ?', [campaignId]).count;
  const title         = req.body.title || `Session ${Number(count) + 1}`;
  const contextFiles  = JSON.stringify(req.body.context_files || []);
  const id = dbInsert(
    'INSERT INTO sessions (campaign_id, title, context_files, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [campaignId, title, contextFiles, now, now]
  );
  res.json({ id, campaign_id: campaignId, title, context_files: req.body.context_files || [], created_at: now, updated_at: now });
});

// Messages for a session
app.get('/api/sessions/:sessionId/messages', (req, res) => {
  const messages = dbAll(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    [req.params.sessionId]
  );
  res.json(messages);
});

// Delete session
app.delete('/api/sessions/:sessionId', (req, res) => {
  dbRun('DELETE FROM messages WHERE session_id = ?', [req.params.sessionId]);
  dbRun('DELETE FROM sessions WHERE id = ?', [req.params.sessionId]);
  res.json({ success: true });
});

// Chat (streaming)
app.post('/api/sessions/:sessionId/chat', async (req, res) => {
  const { sessionId } = req.params;
  const { message } = req.body;

  const session = dbGet('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const campaign = CAMPAIGNS[session.campaign_id];
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const contextFiles = JSON.parse(session.context_files || '[]');
  const systemPrompt = loadCampaignFiles(session.campaign_id, contextFiles);

  const now = new Date().toISOString();
  dbInsert(
    'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
    [sessionId, 'user', message, now]
  );

  const history = dbAll(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    [sessionId]
  );

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let fullResponse = '';
  try {
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      system: systemPrompt,
      messages: history.map(m => ({ role: m.role, content: m.content })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    dbInsert(
      'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
      [sessionId, 'assistant', fullResponse, new Date().toISOString()]
    );
    dbRun('UPDATE sessions SET updated_at = ? WHERE id = ?', [new Date().toISOString(), sessionId]);

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Anthropic error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

if (isProd) {
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '..', 'client', 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🎲 TTRPG GM Server running on http://localhost:${PORT}`);
});
