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

// ── Database ──────────────────────────────────────────────────────────────────
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
  const stmt = db.prepare(sql); stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free(); return row;
}
function dbAll(sql, params = []) {
  const stmt = db.prepare(sql); stmt.bind(params);
  const rows = []; while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free(); return rows;
}
function dbInsert(sql, params = []) {
  db.run(sql, params);
  const id = dbGet('SELECT last_insert_rowid() as id').id;
  saveDb(); return id;
}

db.run(`CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id   TEXT NOT NULL,
  title         TEXT NOT NULL,
  context_files TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
)`);
db.run(`CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
)`);
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

function labelFromFilename(filename) {
  return basename(filename, extname(filename))
    .replace(/^\d+-/, '').replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function listFolder(campaignId, subfolder) {
  const dir = join(CAMPAIGNS_DIR, campaignId, subfolder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => ['.md', '.txt'].includes(extname(f).toLowerCase()))
    .sort()
    .map(f => ({ path: `${subfolder}/${f}`, label: labelFromFilename(f) }));
}

function readFile(campaignId, relPath) {
  const full = join(CAMPAIGNS_DIR, campaignId, relPath);
  return existsSync(full) ? readFileSync(full, 'utf-8').trim() : null;
}

function loadSystemPrompt(campaignId, contextFiles = []) {
  const parts = [];
  const prompt = readFile(campaignId, 'system-prompt.md');
  parts.push(prompt ?? `You are a GM for the ${CAMPAIGNS[campaignId]?.name ?? campaignId} campaign.`);
  for (const filePath of contextFiles) {
    const content = readFile(campaignId, filePath);
    if (content) parts.push(`\n\n---\n# ${labelFromFilename(filePath)}\n\n${content}`);
  }
  return parts.join('\n\n');
}

function loadArbiterPrompt(campaignId) {
  const shared   = existsSync(join(__dirname, 'arbiter-prompt.md'))
    ? readFileSync(join(__dirname, 'arbiter-prompt.md'), 'utf-8').trim() : '';
  const specific = readFile(campaignId, 'rules-arbiter.md') ?? '';
  return [shared, specific].filter(Boolean).join('\n\n---\n\n');
}

// ── Rules arbiter tool definition ─────────────────────────────────────────────
const QUERY_RULES_TOOL = {
  name: 'query_rules',
  description: 'Consult the rules arbiter for an authoritative ruling on a specific game mechanic or rule. Use this whenever you need to resolve a mechanical question before narrating an outcome. Ask one focused question per call.',
  input_schema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The specific rules question to ask. Be precise — reference the mechanic, action, or situation by name.',
      },
    },
    required: ['question'],
  },
};

// ── Anthropic ─────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function callArbiter(campaignId, question) {
  const systemPrompt = loadArbiterPrompt(campaignId);
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: question }],
  });
  return response.content.find(b => b.type === 'text')?.text ?? '(No ruling returned)';
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/campaigns', (req, res) => {
  res.json(Object.values(CAMPAIGNS).map(({ id, name, subtitle, icon, color }) => ({ id, name, subtitle, icon, color })));
});

app.get('/api/campaigns/:campaignId/files', (req, res) => {
  const { campaignId } = req.params;
  if (!CAMPAIGNS[campaignId]) return res.status(404).json({ error: 'Campaign not found' });
  const hasArbiter = existsSync(join(CAMPAIGNS_DIR, campaignId, 'rules-arbiter.md'));
  res.json({
    modules:    listFolder(campaignId, 'modules'),
    references: listFolder(campaignId, 'references'),
    hasArbiter,
  });
});

app.get('/api/campaigns/:campaignId/sessions', (req, res) => {
  const sessions = dbAll(
    'SELECT * FROM sessions WHERE campaign_id = ? ORDER BY updated_at DESC',
    [req.params.campaignId]
  );
  res.json(sessions.map(s => ({ ...s, context_files: JSON.parse(s.context_files || '[]') })));
});

app.post('/api/campaigns/:campaignId/sessions', (req, res) => {
  const { campaignId } = req.params;
  if (!CAMPAIGNS[campaignId]) return res.status(404).json({ error: 'Campaign not found' });
  const now   = new Date().toISOString();
  const count = dbGet('SELECT COUNT(*) as count FROM sessions WHERE campaign_id = ?', [campaignId]).count;
  const title        = req.body.title || `Session ${Number(count) + 1}`;
  const contextFiles = JSON.stringify(req.body.context_files || []);
  const id = dbInsert(
    'INSERT INTO sessions (campaign_id, title, context_files, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [campaignId, title, contextFiles, now, now]
  );
  res.json({ id, campaign_id: campaignId, title, context_files: req.body.context_files || [], created_at: now, updated_at: now });
});

app.get('/api/sessions/:sessionId/messages', (req, res) => {
  const messages = dbAll(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    [req.params.sessionId]
  );
  res.json(messages.map(m => ({
    ...m,
    arbiter_data: m.arbiter_data ? JSON.parse(m.arbiter_data) : undefined,
  })));
});

app.delete('/api/sessions/:sessionId', (req, res) => {
  dbRun('DELETE FROM messages WHERE session_id = ?', [req.params.sessionId]);
  dbRun('DELETE FROM sessions WHERE id = ?', [req.params.sessionId]);
  res.json({ success: true });
});

// ── Chat (streaming, with tool use) ──────────────────────────────────────────
app.post('/api/sessions/:sessionId/chat', async (req, res) => {
  const { sessionId } = req.params;
  const { message }   = req.body;

  const session = dbGet('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const campaign = CAMPAIGNS[session.campaign_id];
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const contextFiles = JSON.parse(session.context_files || '[]');
  const systemPrompt = loadSystemPrompt(session.campaign_id, contextFiles);
  const hasArbiter   = existsSync(join(CAMPAIGNS_DIR, session.campaign_id, 'rules-arbiter.md'));

  const now = new Date().toISOString();
  dbInsert(
    'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
    [sessionId, 'user', message, now]
  );

  // Build Anthropic message history (exclude arbiter/archive meta-messages)
  const dbMessages = dbAll(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    [sessionId]
  );

  // Reconstruct full Anthropic-compatible history including tool use turns
  const history = [];
  for (const m of dbMessages) {
    if (m.role === 'archive') continue; // archive posts not sent to GM
    if (m.role === 'user' || m.role === 'assistant') {
      history.push({ role: m.role, content: m.content });
    }
    // tool_use and tool_result rows are embedded in assistant/user turns
    // They're stored separately for UI rendering but reconstructed here
    if (m.role === 'tool_use') {
      const data = JSON.parse(m.content);
      // Insert as assistant tool_use block
      const last = history[history.length - 1];
      if (last?.role === 'assistant' && Array.isArray(last.content)) {
        last.content.push({ type: 'tool_use', id: data.tool_use_id, name: 'query_rules', input: { question: data.question } });
      } else {
        history.push({ role: 'assistant', content: [{ type: 'tool_use', id: data.tool_use_id, name: 'query_rules', input: { question: data.question } }] });
      }
    }
    if (m.role === 'tool_result') {
      const data = JSON.parse(m.content);
      history.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: data.tool_use_id, content: data.result }] });
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function send(data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

  try {
    let continueLoop = true;

    while (continueLoop) {
      continueLoop = false;
      let fullText = '';
      let toolUseBlock = null;
      let toolUseJson  = '';

      const stream = anthropic.messages.stream({
        model:      'claude-opus-4-5',
        max_tokens: 2048,
        system:     systemPrompt,
        tools:      hasArbiter ? [QUERY_RULES_TOOL] : [],
        messages:   history,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            toolUseBlock = { id: event.content_block.id, name: event.content_block.name };
            toolUseJson  = '';
          }
        }
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            fullText += event.delta.text;
            send({ text: event.delta.text });
          }
          if (event.delta.type === 'input_json_delta') {
            toolUseJson += event.delta.partial_json;
          }
        }
        if (event.type === 'message_delta' && event.delta.stop_reason === 'tool_use') {
          continueLoop = true;
        }
      }

      if (toolUseBlock) {
        // Parse tool input
        let toolInput = {};
        try { toolInput = JSON.parse(toolUseJson); } catch {}
        const question = toolInput.question ?? toolUseJson;

        // Save any partial GM text before tool call
        if (fullText.trim()) {
          dbInsert(
            'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
            [sessionId, 'assistant', fullText, new Date().toISOString()]
          );
          history.push({ role: 'assistant', content: fullText });
        }

        // Notify client: arbiter is being consulted
        send({ arbiter_start: true, question });

        // Call the arbiter
        const ruling = await callArbiter(session.campaign_id, question);

        // Save tool_use and tool_result rows for UI rendering
        const toolUseId = toolUseBlock.id;
        dbInsert(
          'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
          [sessionId, 'tool_use', JSON.stringify({ tool_use_id: toolUseId, question }), new Date().toISOString()]
        );
        dbInsert(
          'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
          [sessionId, 'tool_result', JSON.stringify({ tool_use_id: toolUseId, result: ruling }), new Date().toISOString()]
        );

        // Send full arbiter result to client
        send({ arbiter_done: true, question, ruling });

        // Append to history for next loop iteration
        history.push({ role: 'assistant', content: [
          ...(fullText ? [{ type: 'text', text: fullText }] : []),
          { type: 'tool_use', id: toolUseId, name: 'query_rules', input: { question } },
        ]});
        history.push({ role: 'user', content: [
          { type: 'tool_result', tool_use_id: toolUseId, content: ruling },
        ]});

      } else if (fullText) {
        // Normal response — save and finish
        dbInsert(
          'INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
          [sessionId, 'assistant', fullText, new Date().toISOString()]
        );
        dbRun('UPDATE sessions SET updated_at = ? WHERE id = ?', [new Date().toISOString(), sessionId]);
      }
    }

    send({ done: true });
    res.end();
  } catch (err) {
    console.error('Error:', err);
    send({ error: err.message });
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
