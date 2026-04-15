import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
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
  ended_at      TEXT,
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
try { db.run(`ALTER TABLE sessions ADD COLUMN ended_at TEXT`); } catch {}
saveDb();

// ── Campaign ID Helpers ─────────────────────────────────────────────────────────
/**
 * Parse composite campaign ID
 * @param {string} campaignId - Format: 'ruleset.campaign' 
 * @returns {{rulesetId: string, campaignId: string}}
 */
function parseCampaignId(campaignId) {
  const [rulesetId, ...campaignParts] = campaignId.split('.');
  return {
    rulesetId,
    campaignId: campaignParts.join('.') // Handle campaign names with dots
  };
}

/**
 * Build composite campaign ID
 * @param {string} rulesetId 
 * @param {string} campaignId 
 * @returns {string} - Format: 'ruleset.campaign'
 */
function buildCampaignId(rulesetId, campaignId) {
  return `${rulesetId}.${campaignId}`;
}

// ── Rule Sets and Campaigns ────────────────────────────────────────────────────
const RULESETS = {
  ose: {
    id: 'ose',
    name: 'Old-School Essentials',
    description: 'Classic D&D rules',
    icon: '⚔️',
    color: '#c0392b'
  },
  masks: {
    id: 'masks',
    name: 'Masks: A New Generation', 
    description: 'Superhero teen drama',
    icon: '🦸',
    color: '#8e44ad'
  },
  dragonbane: {
    id: 'dragonbane',
    name: 'Dragonbane',
    description: 'Swedish fantasy RPG',
    icon: '🐉',
    color: '#16a085'
  },
  'ironsworn-badlands': {
    id: 'ironsworn-badlands',
    name: 'Ironsworn: Badlands', 
    description: 'Solo iron age western',
    icon: '🤠',
    color: '#d35400'
  }
};

const CAMPAIGNS = {
  'ose.lolth-conspiracy': {
    id: 'lolth-conspiracy',
    rulesetId: 'ose',
    name: 'The Lolth Conspiracy',
    description: 'Dark elf infiltration'
  },
  'masks.halcyon-city': {
    id: 'halcyon-city',
    rulesetId: 'masks', 
    name: 'Halcyon City Heroes',
    description: 'Superhero team adventures'
  },
  'dragonbane.mercy-row': {
    id: 'mercy-row',
    rulesetId: 'dragonbane',
    name: 'Mercy Row',
    description: 'Urban fantasy campaign'
  },
  'ironsworn-badlands.jake-powell': {
    id: 'jake-powell',
    rulesetId: 'ironsworn-badlands',
    name: "Jake Powell's Journey", 
    description: 'Solo hero adventure'
  }
};

// ── File helpers ──────────────────────────────────────────────────────────────
const RULESETS_DIR = join(__dirname, 'rulesets');

function labelFromFilename(filename) {
  return basename(filename, extname(filename))
    .replace(/^\d+-/, '').replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function listFolder(campaignId, subfolder) {
  const { rulesetId, campaignId: campId } = parseCampaignId(campaignId);
  
  // Check campaign-specific folder first
  const campaignDir = join(RULESETS_DIR, rulesetId, 'campaigns', campId, subfolder);
  const campaignFiles = existsSync(campaignDir) 
    ? readdirSync(campaignDir)
        .filter(f => ['.md', '.txt'].includes(extname(f).toLowerCase()))
        .map(f => ({ path: `${subfolder}/${f}`, label: `[Campaign] ${labelFromFilename(f)}` }))
    : [];
  
  // Check ruleset-level folder  
  const rulesetDir = join(RULESETS_DIR, rulesetId, subfolder);
  const rulesetFiles = existsSync(rulesetDir)
    ? readdirSync(rulesetDir)
        .filter(f => ['.md', '.txt'].includes(extname(f).toLowerCase()))
        .map(f => ({ path: `shared/${subfolder}/${f}`, label: `[Shared] ${labelFromFilename(f)}` }))
    : [];
    
  return [...campaignFiles, ...rulesetFiles].sort((a, b) => a.label.localeCompare(b.label));
}

// Read file with cascade: campaign-specific first, then ruleset-shared
function readCampaignFile(campaignId, relPath) {
  const { rulesetId, campaignId: campId } = parseCampaignId(campaignId);
  
  // Handle shared paths (prefixed with 'shared/')
  if (relPath.startsWith('shared/')) {
    const sharedPath = relPath.replace('shared/', '');
    const full = join(RULESETS_DIR, rulesetId, sharedPath);
    return existsSync(full) ? readFileSync(full, 'utf-8').trim() : null;
  }
  
  // Campaign-specific path first
  let full = join(RULESETS_DIR, rulesetId, 'campaigns', campId, relPath);
  if (existsSync(full)) return readFileSync(full, 'utf-8').trim();
  
  // Fall back to ruleset level
  full = join(RULESETS_DIR, rulesetId, relPath);
  return existsSync(full) ? readFileSync(full, 'utf-8').trim() : null;
}

// Read ruleset-level file specifically  
function readRulesetFile(rulesetId, relPath) {
  const full = join(RULESETS_DIR, rulesetId, relPath);
  return existsSync(full) ? readFileSync(full, 'utf-8').trim() : null;
}

function hasSessionState(campaignId) {
  const { rulesetId, campaignId: campId } = parseCampaignId(campaignId);
  const p = join(RULESETS_DIR, rulesetId, 'campaigns', campId, 'session-state.md');
  if (!existsSync(p)) return false;
  const content = readFileSync(p, 'utf-8').trim();
  return content.length > 0 && !content.startsWith('<!--');
}

function loadSharedFile(filename) {
  const p = join(__dirname, filename);
  return existsSync(p) ? readFileSync(p, 'utf-8').trim() : null;
}

function loadSystemPrompt(campaignId, contextFiles = []) {
  const { rulesetId, campaignId: campId } = parseCampaignId(campaignId);
  const campaign = CAMPAIGNS[campaignId];
  const ruleset = RULESETS[rulesetId];
  const parts = [];

  // 1. Ruleset system prompt (core rules and mechanics)
  const rulesetPrompt = readRulesetFile(rulesetId, 'system-prompt.md');
  parts.push(rulesetPrompt ?? `You are a GM for ${ruleset?.name ?? rulesetId} campaigns.`);

  // 2. Shared session state instructions (how to read/write state)
  const stateInstructions = loadSharedFile('session-state-instructions.md');
  if (stateInstructions) parts.push(`\n\n---\n${stateInstructions}`);

  // 3. State template: use ruleset-specific if present, otherwise fall back to universal
  const stateFields = readRulesetFile(rulesetId, 'session-state-fields.md');
  if (stateFields) {
    parts.push(`\n\n---\n${stateFields}`);
  } else {
    const stateTemplate = loadSharedFile('session-state-template.md');
    if (stateTemplate) parts.push(`\n\n---\n${stateTemplate}`);
  }

  // 4. Campaign-specific prompt (party, setting, campaign rules)
  const campaignPrompt = readCampaignFile(campaignId, 'campaign-prompt.md');
  if (campaignPrompt) {
    parts.push(`\n\n---\n# ${campaign?.name ?? campId}\n\n${campaignPrompt}`);
  }

  // 5. Restored session state (current campaign state — highest priority)
  if (hasSessionState(campaignId)) {
    const state = readCampaignFile(campaignId, 'session-state.md');
    parts.push(`\n\n---\n# Session State (Restored)\n\nThis is the current campaign state from the end of the last session. Treat it as authoritative.\n\n${state}`);
  }

  // 6. Selected modules and references
  for (const filePath of contextFiles) {
    const content = readCampaignFile(campaignId, filePath);
    if (content) parts.push(`\n\n---\n# ${labelFromFilename(filePath)}\n\n${content}`);
  }

  return parts.join('\n\n');
}

function loadArbiterPrompt(campaignId) {
  const sharedPath = join(__dirname, 'arbiter-prompt.md');
  const shared   = existsSync(sharedPath) ? readFileSync(sharedPath, 'utf-8').trim() : '';
  const specific = readCampaignFile(campaignId, 'rules-arbiter.md') ?? '';
  return [shared, specific].filter(Boolean).join('\n\n---\n\n');
}

function saveSessionState(campaignId, stateContent) {
  const { rulesetId, campaignId: campId } = parseCampaignId(campaignId);
  const campaignPath = join(RULESETS_DIR, rulesetId, 'campaigns', campId);
  const statePath    = join(campaignPath, 'session-state.md');
  const backupDir    = join(campaignPath, 'state-backups');
  mkdirSync(backupDir, { recursive: true });

  // Archive current state before overwriting
  if (existsSync(statePath)) {
    const date = new Date().toISOString().slice(0, 10);
    const backupPath = join(backupDir, `session-state-${date}.md`);
    copyFileSync(statePath, backupPath);
  }

  writeFileSync(statePath, stateContent, 'utf-8');
}

// ── Tools ─────────────────────────────────────────────────────────────────────
const QUERY_RULES_TOOL = {
  name: 'query_rules',
  description: 'Consult the rules arbiter for an authoritative ruling on a specific game mechanic or rule. Use this whenever you need to resolve a mechanical question before narrating an outcome. Ask one focused question per call.',
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The specific rules question to ask.' },
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

// Shared streaming chat loop — used by both /chat and /end
async function runChatStream(res, { systemPrompt, history, hasArbiter, campaignId, sessionId, saveAssistantMessages = true }) {
  function send(data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

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
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        toolUseBlock = { id: event.content_block.id, name: event.content_block.name };
        toolUseJson  = '';
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
      let toolInput = {};
      try { toolInput = JSON.parse(toolUseJson); } catch {}
      const question = toolInput.question ?? toolUseJson;

      if (fullText.trim() && saveAssistantMessages) {
        dbInsert('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
          [sessionId, 'assistant', fullText, new Date().toISOString()]);
        history.push({ role: 'assistant', content: fullText });
      }

      send({ arbiter_start: true, question });
      const ruling = await callArbiter(campaignId, question);

      const toolUseId = toolUseBlock.id;
      if (saveAssistantMessages) {
        dbInsert('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
          [sessionId, 'tool_use', JSON.stringify({ tool_use_id: toolUseId, question }), new Date().toISOString()]);
        dbInsert('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
          [sessionId, 'tool_result', JSON.stringify({ tool_use_id: toolUseId, result: ruling }), new Date().toISOString()]);
      }

      send({ arbiter_done: true, question, ruling });

      history.push({ role: 'assistant', content: [
        ...(fullText ? [{ type: 'text', text: fullText }] : []),
        { type: 'tool_use', id: toolUseId, name: 'query_rules', input: { question } },
      ]});
      history.push({ role: 'user', content: [
        { type: 'tool_result', tool_use_id: toolUseId, content: ruling },
      ]});

    } else if (fullText) {
      if (saveAssistantMessages) {
        dbInsert('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
          [sessionId, 'assistant', fullText, new Date().toISOString()]);
        dbRun('UPDATE sessions SET updated_at = ? WHERE id = ?', [new Date().toISOString(), sessionId]);
      }
      return fullText; // return final text for callers that need it (e.g. /end)
    }
  }
  return '';
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Return all rulesets and their campaigns
app.get('/api/rulesets', (req, res) => {
  const result = {};
  for (const rulesetId of Object.keys(RULESETS)) {
    result[rulesetId] = {
      ...RULESETS[rulesetId],
      campaigns: Object.values(CAMPAIGNS)
        .filter(c => c.rulesetId === rulesetId)
        .map(({ id, name, description }) => ({ id, name, description }))
    };
  }
  res.json(result);
});

// Legacy route: return campaigns in old format for backwards compatibility
app.get('/api/campaigns', (req, res) => {
  const legacyFormat = Object.values(CAMPAIGNS).map(campaign => {
    const ruleset = RULESETS[campaign.rulesetId];
    return {
      id: buildCampaignId(campaign.rulesetId, campaign.id),
      name: campaign.name,
      subtitle: campaign.description,
      icon: ruleset?.icon || '📖',
      color: ruleset?.color || '#666666'
    };
  });
  res.json(legacyFormat);
});

app.get('/api/campaigns/:campaignId/files', (req, res) => {
  const { campaignId } = req.params;
  if (!CAMPAIGNS[campaignId]) return res.status(404).json({ error: 'Campaign not found' });
  const { rulesetId } = parseCampaignId(campaignId);
  res.json({
    modules:    listFolder(campaignId, 'modules'),
    references: listFolder(campaignId, 'references'),
    hasArbiter: existsSync(join(RULESETS_DIR, rulesetId, 'rules-arbiter.md')),
    hasState:   hasSessionState(campaignId),
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
  res.json(messages);
});

app.delete('/api/sessions/:sessionId', (req, res) => {
  dbRun('DELETE FROM messages WHERE session_id = ?', [req.params.sessionId]);
  dbRun('DELETE FROM sessions WHERE id = ?', [req.params.sessionId]);
  res.json({ success: true });
});

// ── Chat ──────────────────────────────────────────────────────────────────────
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

  dbInsert('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
    [sessionId, 'user', message, new Date().toISOString()]);

  const dbMessages = dbAll(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC', [sessionId]
  );
  const history = buildHistory(dbMessages);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    await runChatStream(res, { systemPrompt, history, hasArbiter, campaignId: session.campaign_id, sessionId, saveAssistantMessages: true });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    console.error(err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
});

// ── End session ───────────────────────────────────────────────────────────────
app.post('/api/sessions/:sessionId/end', async (req, res) => {
  const { sessionId } = req.params;

  const session = dbGet('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const campaign = CAMPAIGNS[session.campaign_id];
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const contextFiles = JSON.parse(session.context_files || '[]');
  const systemPrompt = loadSystemPrompt(session.campaign_id, contextFiles);
  const hasArbiter   = existsSync(join(CAMPAIGNS_DIR, session.campaign_id, 'rules-arbiter.md'));

  // Build history without the state-save instruction
  const dbMessages = dbAll(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC', [sessionId]
  );
  const history = buildHistory(dbMessages);

  // Add the end-of-session instruction as a user turn
  history.push({
    role: 'user',
    content: 'The session is now ending. Please produce the full session state snapshot as instructed in your system prompt. Output only the state block — no other commentary.',
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function send(data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

  try {
    send({ state_start: true });

    // Stream the state output but don't save it as a normal message
    const stateContent = await runChatStream(res, {
      systemPrompt, history, hasArbiter,
      campaignId: session.campaign_id,
      sessionId,
      saveAssistantMessages: false,
    });

    if (stateContent) {
      // Save state to file with backup
      saveSessionState(session.campaign_id, stateContent);

      // Save as a special 'state' message in the session for the UI
      dbInsert('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
        [sessionId, 'state', stateContent, new Date().toISOString()]);

      // Mark session as ended
      dbRun('UPDATE sessions SET ended_at = ?, updated_at = ? WHERE id = ?',
        [new Date().toISOString(), new Date().toISOString(), sessionId]);
    }

    send({ state_done: true, content: stateContent });
    send({ done: true });
  } catch (err) {
    console.error(err);
    send({ error: err.message });
  }
  res.end();
});

// ── History builder ───────────────────────────────────────────────────────────
function buildHistory(dbMessages) {
  const history = [];
  for (const m of dbMessages) {
    if (m.role === 'archive' || m.role === 'state') continue;
    if (m.role === 'user' || m.role === 'assistant') {
      history.push({ role: m.role, content: m.content });
    }
    if (m.role === 'tool_use') {
      try {
        const d = JSON.parse(m.content);
        const last = history[history.length - 1];
        if (last?.role === 'assistant' && Array.isArray(last.content)) {
          last.content.push({ type: 'tool_use', id: d.tool_use_id, name: 'query_rules', input: { question: d.question } });
        } else {
          history.push({ role: 'assistant', content: [{ type: 'tool_use', id: d.tool_use_id, name: 'query_rules', input: { question: d.question } }] });
        }
      } catch {}
    }
    if (m.role === 'tool_result') {
      try {
        const d = JSON.parse(m.content);
        history.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: d.tool_use_id, content: d.result }] });
      } catch {}
    }
  }
  return history;
}

if (isProd) {
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '..', 'client', 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🎲 TTRPG GM Server running on http://localhost:${PORT}`);
});
