import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
import { join, dirname, basename, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { randomInt } from 'crypto';
import initSqlJs from 'sql.js';
import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// ── Content directory ─────────────────────────────────────────────────────────
// All campaign content, rulesets, and the database live here.
// Override with CONTENT_DIR env var to decouple content from server code.
const CONTENT_DIR = process.env.CONTENT_DIR
  ? resolve(process.env.CONTENT_DIR)
  : join(__dirname, '..', 'content');

// ── CORS ──────────────────────────────────────────────────────────────────────
// CORS_ORIGIN: comma-separated allowed origins (e.g. "https://myapp.com,https://www.myapp.com")
// Defaults to localhost:5173 in dev, or open (*) in prod if not set.
const isProd = process.env.NODE_ENV === 'production';
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : (isProd ? '*' : 'http://localhost:5173');
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

if (isProd && !process.env.CORS_ORIGIN) {
  // Only serve client static files when running as a single combined deploy
  const clientDist = join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
}

// ── Database ──────────────────────────────────────────────────────────────────
const DATA_DIR = join(CONTENT_DIR, 'data');
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

// ── Message Trimming ─────────────────────────────────────────────────────────
/**
 * Trim conversation messages from ended sessions to keep database lean.
 * Keeps only 'archive' and 'state' messages for continuity, removes conversational flow.
 * 
 * @param {number|null} sessionId - Specific session ID to trim, or null to trim all ended sessions
 */
function trimEndedSessionMessages(sessionId = null) {
  const condition = sessionId 
    ? 'WHERE s.id = ? AND s.ended_at IS NOT NULL'
    : 'WHERE s.ended_at IS NOT NULL';
  const params = sessionId ? [sessionId] : [];
  
  // Find sessions to trim
  const sessionsToTrim = dbAll(`
    SELECT s.id, s.title, COUNT(m.id) as total_messages,
           SUM(CASE WHEN m.role IN ('archive', 'state') THEN 1 ELSE 0 END) as keep_messages
    FROM sessions s 
    LEFT JOIN messages m ON s.id = m.session_id 
    ${condition}
    GROUP BY s.id
    HAVING total_messages > keep_messages
  `, params);
  
  if (sessionsToTrim.length === 0) {
    console.log('No ended sessions need message trimming');
    return;
  }
  
  // Trim messages for each session
  for (const session of sessionsToTrim) {
    const deletedCount = dbAll(`
      SELECT COUNT(*) as count FROM messages 
      WHERE session_id = ? AND role NOT IN ('archive', 'state')
    `, [session.id])[0].count;
    
    if (deletedCount > 0) {
      dbRun(`
        DELETE FROM messages 
        WHERE session_id = ? AND role NOT IN ('archive', 'state')
      `, [session.id]);
      
      console.log(`Trimmed ${deletedCount} messages from ended session: ${session.title}`);
    }
  }
  
  const totalTrimmed = sessionsToTrim.reduce((sum, s) => sum + (s.total_messages - s.keep_messages), 0);
  console.log(`Message trimming completed: ${totalTrimmed} messages removed from ${sessionsToTrim.length} sessions`);
}

// ── Rule Sets and Campaigns ────────────────────────────────────────────────────

// Default visual attributes for rulesets
const RULESET_DEFAULTS = {
  'ose': { icon: '⚔️', color: '#9b4b37' },
  'masks': { icon: '🦸', color: '#7b5a7a' },
  'dragonbane': { icon: '🐉', color: '#3f7a67' },
  'ironsworn-badlands': { icon: '🤠', color: '#9a6131' },
  // Add more defaults here as needed
};

// Cache for scanned rulesets and campaigns
let _rulesetsCache = null;
let _campaignsCache = null;

// Extract title from markdown file's first header
function extractTitleFromMarkdown(content) {
  if (!content) return null;
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

// Convert directory name to display name
function dirToDisplayName(dirName) {
  return dirName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Scan rulesets directory and build RULESETS object
function scanRulesets() {
  if (_rulesetsCache) return _rulesetsCache;
  
  const rulesets = {};
  
  try {
    const rulesetDirs = readdirSync(RULESETS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    
    for (const rulesetId of rulesetDirs) {
      const rulesetPath = join(RULESETS_DIR, rulesetId);
      
      // Try to extract name from system-prompt.md
      let name = null;
      let description = 'Tabletop RPG system';
      
      const systemPromptPath = join(rulesetPath, 'system-prompt.md');
      if (existsSync(systemPromptPath)) {
        const content = readFileSync(systemPromptPath, 'utf-8');
        name = extractTitleFromMarkdown(content);
        
        // Extract description from first paragraph if available
        const lines = content.split('\n').filter(line => line.trim());
        const descLine = lines.find(line => 
          !line.startsWith('#') && 
          !line.startsWith('---') && 
          line.trim().length > 10
        );
        if (descLine) {
          description = descLine.trim();
        }
      }
      
      // Fallback to directory name if no title found
      if (!name) {
        name = dirToDisplayName(rulesetId);
      }
      
      // Get visual attributes from defaults or generate fallbacks
      const defaults = RULESET_DEFAULTS[rulesetId] || { icon: '🎲', color: '#6e7560' };
      
      rulesets[rulesetId] = {
        id: rulesetId,
        name,
        description,
        icon: defaults.icon,
        color: defaults.color
      };
    }
  } catch (error) {
    console.error('Error scanning rulesets:', error);
  }
  
  _rulesetsCache = rulesets;
  return rulesets;
}

// Scan campaigns across all rulesets and build CAMPAIGNS object
function scanCampaigns() {
  if (_campaignsCache) return _campaignsCache;
  
  const campaigns = {};
  const rulesets = scanRulesets();
  
  try {
    for (const rulesetId of Object.keys(rulesets)) {
      const campaignsDir = join(RULESETS_DIR, rulesetId, 'campaigns');
      
      if (!existsSync(campaignsDir)) continue;
      
      const campaignDirs = readdirSync(campaignsDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
      
      for (const campaignId of campaignDirs) {
        const compositeId = `${rulesetId}.${campaignId}`;
        
        // Try to extract name and description from campaign-prompt.md
        let name = null;
        let description = 'Campaign setting';
        
        const campaignPromptPath = join(campaignsDir, campaignId, 'campaign-prompt.md');
        if (existsSync(campaignPromptPath)) {
          const content = readFileSync(campaignPromptPath, 'utf-8');
          name = extractTitleFromMarkdown(content);
          
          // Extract description from overview section or first paragraph
          const overviewMatch = content.match(/##\s+(?:Campaign\s+)?Overview\s*\n\n(.+?)(?:\n\n|\n##|$)/s);
          if (overviewMatch) {
            description = overviewMatch[1].trim().replace(/\n/g, ' ');
          }
        }
        
        // Fallback to directory name if no title found
        if (!name) {
          name = dirToDisplayName(campaignId);
        }
        
        campaigns[compositeId] = {
          id: campaignId,
          rulesetId,
          name,
          description
        };
      }
    }
  } catch (error) {
    console.error('Error scanning campaigns:', error);
  }
  
  _campaignsCache = campaigns;
  return campaigns;
}

// Dynamic getters that replace the old static objects
function getRulesets() {
  return scanRulesets();
}

function getCampaigns() {
  return scanCampaigns();
}

function getRuleset(id) {
  return getRulesets()[id];
}

function getCampaign(id) {
  return getCampaigns()[id];
}

// ── File helpers ──────────────────────────────────────────────────────────────
const RULESETS_DIR = join(CONTENT_DIR, 'rulesets');

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

function hasWorldState(campaignId) {
  const { rulesetId, campaignId: campId } = parseCampaignId(campaignId);
  const p = join(RULESETS_DIR, rulesetId, 'campaigns', campId, 'world-state.md');
  if (!existsSync(p)) return false;
  const content = readFileSync(p, 'utf-8').trim();
  return content.length > 0 && !content.startsWith('<!--');
}

function loadSharedFile(filename) {
  const p = join(CONTENT_DIR, filename);
  return existsSync(p) ? readFileSync(p, 'utf-8').trim() : null;
}

function loadSystemPrompt(campaignId, contextFiles = []) {
  const { rulesetId, campaignId: campId } = parseCampaignId(campaignId);
  const campaign = getCampaign(campaignId);
  const ruleset = getRuleset(rulesetId);
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

  // 5. World state (accumulated facts, locations, NPCs, events)
  if (hasWorldState(campaignId)) {
    const worldState = readCampaignFile(campaignId, 'world-state.md');
    parts.push(`\n\n---\n# World State\n\nThis is the accumulated world state containing established facts, locations, NPCs, and events from previous sessions. Use this as the foundation for consistency and continuity.\n\n${worldState}`);
  }

  // 6. Restored session state (current campaign state — highest priority)
  if (hasSessionState(campaignId)) {
    const state = readCampaignFile(campaignId, 'session-state.md');
    parts.push(`\n\n---\n# Session State (Restored)\n\nThis is the current campaign state from the end of the last session. Treat it as authoritative.\n\n${state}`);
  }

  // 7. Selected modules and references
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
    const ts = new Date().toISOString().replace('T', '-').slice(0, 16).replace(':', '');
    const backupPath = join(backupDir, `session-state-${ts}.md`);
    copyFileSync(statePath, backupPath);
  }

  writeFileSync(statePath, stateContent, 'utf-8');
}

function saveWorldState(campaignId, worldContent) {
  const { rulesetId, campaignId: campId } = parseCampaignId(campaignId);
  const campaignPath = join(RULESETS_DIR, rulesetId, 'campaigns', campId);
  const worldPath    = join(campaignPath, 'world-state.md');
  const backupDir    = join(campaignPath, 'world-backups');
  mkdirSync(backupDir, { recursive: true });

  // Archive current world state before overwriting
  if (existsSync(worldPath)) {
    const ts = new Date().toISOString().replace('T', '-').slice(0, 16).replace(':', '');
    const backupPath = join(backupDir, `world-state-${ts}.md`);
    copyFileSync(worldPath, backupPath);
  }

  writeFileSync(worldPath, worldContent, 'utf-8');
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

const ROLL_DICE_TOOL = {
  name: 'roll_dice',
  description: 'Roll dice for any game mechanic — attack rolls, saving throws, damage, random encounters, morale checks, ability checks, treasure rolls, or any other roll required during play. Always use this tool instead of assuming or narrating a result. Roll all dice for a single action together.',
  input_schema: {
    type: 'object',
    properties: {
      expressions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Dice expressions to roll. Supported formats: d20, 2d6, 3d6+2, 4d6k3 (keep highest 3), d100, d8-1.',
      },
      label: {
        type: 'string',
        description: 'Brief label for what is being rolled, e.g. "Attack roll vs AC 5" or "Saving throw vs death".',
      },
    },
    required: ['expressions'],
  },
};

// Dice rolling — cryptographically random, mirrors the dice-roller skill script
function rollDie(sides) { return randomInt(1, sides + 1); }

function parseAndRoll(expr) {
  expr = expr.trim().toLowerCase();
  const keepMatch = expr.match(/^(\d*)d(\d+)k(\d+)$/);
  if (keepMatch) {
    const num = parseInt(keepMatch[1]) || 1;
    const sides = parseInt(keepMatch[2]);
    const keep = parseInt(keepMatch[3]);
    const rolls = Array.from({ length: num }, () => rollDie(sides));
    const kept = [...rolls].sort((a, b) => b - a).slice(0, keep);
    return { expression: expr, rolls, kept, modifier: 0, total: kept.reduce((s, r) => s + r, 0), note: `Kept highest ${keep}` };
  }
  const stdMatch = expr.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (stdMatch) {
    const num = parseInt(stdMatch[1]) || 1;
    const sides = parseInt(stdMatch[2]);
    const modifier = parseInt(stdMatch[3] || '0');
    const rolls = Array.from({ length: num }, () => rollDie(sides));
    const total = rolls.reduce((s, r) => s + r, 0) + modifier;
    return { expression: expr, rolls, kept: rolls, modifier, total, note: '' };
  }
  return { error: `Could not parse: '${expr}'` };
}

function formatDiceResult(result) {
  if (result.error) return `ERROR: ${result.error}`;
  const expr = result.expression.toUpperCase();
  const { rolls, modifier, total, note } = result;
  if (rolls.length === 1 && modifier === 0) return `🎲 ${expr} → ${total}`;
  if (note) return `🎲 ${expr} → [${result.rolls.join(', ')}] ${note} = ${result.kept.reduce((s, r) => s + r, 0)}`;
  const modStr = modifier !== 0 ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : '';
  return `🎲 ${expr} → [${rolls.join(' + ')}]${modStr} = ${total}`;
}

function rollDice(expressions) {
  return expressions.map(expr => formatDiceResult(parseAndRoll(expr)));
}

// ── Anthropic ─────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function callArbiter(campaignId, question) {
  const systemPrompt = loadArbiterPrompt(campaignId);
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
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
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     systemPrompt,
      tools:      hasArbiter ? [QUERY_RULES_TOOL, ROLL_DICE_TOOL] : [ROLL_DICE_TOOL],
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
      const toolUseId = toolUseBlock.id;
      const toolName  = toolUseBlock.name;

      if (fullText.trim() && saveAssistantMessages) {
        dbInsert('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
          [sessionId, 'assistant', fullText, new Date().toISOString()]);
      }

      if (toolName === 'roll_dice') {
        const expressions = toolInput.expressions ?? [];
        const label       = toolInput.label ?? '';
        const results     = rollDice(expressions);
        const resultText  = results.join('\n');

        if (saveAssistantMessages) {
          dbInsert('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
            [sessionId, 'tool_use', JSON.stringify({ tool_use_id: toolUseId, tool_name: 'roll_dice', expressions, label }), new Date().toISOString()]);
          dbInsert('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
            [sessionId, 'tool_result', JSON.stringify({ tool_use_id: toolUseId, result: resultText }), new Date().toISOString()]);
        }

        send({ dice_roll: true, label, expressions, results });

        history.push({ role: 'assistant', content: [
          ...(fullText ? [{ type: 'text', text: fullText }] : []),
          { type: 'tool_use', id: toolUseId, name: 'roll_dice', input: { expressions, label } },
        ]});
        history.push({ role: 'user', content: [
          { type: 'tool_result', tool_use_id: toolUseId, content: resultText },
        ]});

      } else {
        // query_rules (arbiter)
        const question = toolInput.question ?? '';

        send({ arbiter_start: true, question });
        const ruling = await callArbiter(campaignId, question);

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
      }

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
  const rulesets = getRulesets();
  const campaigns = getCampaigns();
  
  const result = {};
  for (const rulesetId of Object.keys(rulesets)) {
    result[rulesetId] = {
      ...rulesets[rulesetId],
      campaigns: Object.values(campaigns)
        .filter(c => c.rulesetId === rulesetId)
        .map(({ id, name, description }) => ({ id, name, description }))
    };
  }
  res.json(result);
});

// Legacy route: return campaigns in old format for backwards compatibility
app.get('/api/campaigns', (req, res) => {
  const campaigns = getCampaigns();
  const rulesets = getRulesets();
  
  const legacyFormat = Object.values(campaigns).map(campaign => {
    const ruleset = rulesets[campaign.rulesetId];
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
  if (!getCampaign(campaignId)) return res.status(404).json({ error: 'Campaign not found' });
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
  if (!getCampaign(campaignId)) return res.status(404).json({ error: 'Campaign not found' });
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
  const { sessionId } = req.params;

  const session = dbGet('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // Only the most recent session for this campaign may be deleted
  const latestSession = dbGet(
    'SELECT id FROM sessions WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1',
    [session.campaign_id]
  );
  if (!latestSession || latestSession.id !== parseInt(sessionId)) {
    return res.status(400).json({ error: 'Only the most recent session can be deleted.' });
  }

  let stateRestored = false;

  // If the session was ended, roll the state file back to the most recent backup
  if (session.ended_at) {
    const { rulesetId, campaignId: campId } = parseCampaignId(session.campaign_id);
    const campaignPath = join(RULESETS_DIR, rulesetId, 'campaigns', campId);
    const statePath    = join(campaignPath, 'session-state.md');
    const backupDir    = join(campaignPath, 'state-backups');

    if (existsSync(backupDir)) {
      const backups = readdirSync(backupDir)
        .filter(f => f.startsWith('session-state-') && f.endsWith('.md'))
        .sort(); // alphabetical sort = chronological order given the timestamp format

      if (backups.length > 0) {
        copyFileSync(join(backupDir, backups[backups.length - 1]), statePath);
        stateRestored = true;
      } else if (existsSync(statePath)) {
        writeFileSync(statePath, '<!-- No prior state -->\n', 'utf-8');
      }
    } else if (existsSync(statePath)) {
      writeFileSync(statePath, '<!-- No prior state -->\n', 'utf-8');
    }
  }

  dbRun('DELETE FROM messages WHERE session_id = ?', [sessionId]);
  dbRun('DELETE FROM sessions WHERE id = ?', [sessionId]);

  res.json({ success: true, stateRestored });
});

// Cleanup endpoint: trim messages from all ended sessions
app.post('/api/sessions/cleanup', (req, res) => {
  try {
    trimEndedSessionMessages();
    res.json({ success: true, message: 'Ended session messages trimmed successfully' });
  } catch (error) {
    console.error('Error during session cleanup:', error);
    res.status(500).json({ error: 'Cleanup failed', details: error.message });
  }
});

// ── Chat ──────────────────────────────────────────────────────────────────────
app.post('/api/sessions/:sessionId/chat', async (req, res) => {
  const { sessionId } = req.params;
  const { message }   = req.body;

  const session = dbGet('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const campaign = getCampaign(session.campaign_id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const contextFiles = JSON.parse(session.context_files || '[]');
  const systemPrompt = loadSystemPrompt(session.campaign_id, contextFiles);
  const { rulesetId } = parseCampaignId(session.campaign_id);
  const hasArbiter   = existsSync(join(RULESETS_DIR, rulesetId, 'rules-arbiter.md'));

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
  const campaign = getCampaign(session.campaign_id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const contextFiles = JSON.parse(session.context_files || '[]');
  const systemPrompt = loadSystemPrompt(session.campaign_id, contextFiles);
  const { rulesetId } = parseCampaignId(session.campaign_id);
  const hasArbiter   = existsSync(join(RULESETS_DIR, rulesetId, 'rules-arbiter.md'));

  // Build base history once; fork separate arrays for state and report
  const dbMessages = dbAll(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC', [sessionId]
  );
  const baseHistory = buildHistory(dbMessages);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function send(data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

  try {
    // ── Phase 1: State snapshot ──────────────────────────────────────────────
    send({ state_start: true });

    const stateHistory = [...baseHistory, {
      role: 'user',
      content: 'The session is now ending. Please produce the full session state snapshot as instructed in your system prompt. Output only the state block — no other commentary.',
    }];

    const stateContent = await runChatStream(res, {
      systemPrompt, history: stateHistory, hasArbiter,
      campaignId: session.campaign_id,
      sessionId,
      saveAssistantMessages: false,
    });

    if (stateContent) {
      saveSessionState(session.campaign_id, stateContent);
      dbInsert('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
        [sessionId, 'state', stateContent, new Date().toISOString()]);

      // Extract episode title from the state header line
      // Format: *Last updated: end of Session N | Episode Title*
      const titleMatch = stateContent.match(/\*Last updated:.*?\|\s*(.+?)\s*\*/);
      const episodeTitle = titleMatch?.[1]?.trim();
      if (episodeTitle) {
        dbRun('UPDATE sessions SET title = ?, ended_at = ?, updated_at = ? WHERE id = ?',
          [episodeTitle, new Date().toISOString(), new Date().toISOString(), sessionId]);
        send({ session_title: episodeTitle });
      } else {
        dbRun('UPDATE sessions SET ended_at = ?, updated_at = ? WHERE id = ?',
          [new Date().toISOString(), new Date().toISOString(), sessionId]);
      }
    }

    send({ state_done: true, content: stateContent });

    // ── Phase 2: World state delta ───────────────────────────────────────────
    send({ world_delta_start: true });

    const worldDeltaHistory = [...baseHistory, {
      role: 'user',
      content: `Review the session transcript and generate a World State Delta. 

Err heavily on the side of inclusion — capture everything that was established, implied, or could become relevant later, even if it seems throwaway. When in doubt, include it.

For each entry record:
- The fact itself
- Which session established it [S#] 
- Category: LOCATIONS | NPCS | FACTIONS | PARTY | LORE | OPEN THREADS

Include:
- Named or described locations, even briefly mentioned ones
- Any NPC, named or unnamed but notable (the stable owner, the adjuster)
- Prices, distances, timeframes mentioned in passing
- Rumors, secondhand information (flag as UNVERIFIED)
- Anything the party did that others might remember
- Unresolved questions or hooks, even if you didn't intend them as hooks

Do not summarize or collapse entries. One fact per line.

Output only the world state delta — no other commentary.`,
    }];

    let worldDeltaContent = '';
    try {
      const worldDeltaStream = anthropic.messages.stream({
        model:      'claude-sonnet-4-6',
        max_tokens: 2048,
        system:     systemPrompt,
        messages:   worldDeltaHistory,
      });
      for await (const event of worldDeltaStream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          worldDeltaContent += event.delta.text;
          send({ world_delta_text: event.delta.text });
        }
      }
    } catch (worldDeltaErr) {
      console.error('World state delta generation error:', worldDeltaErr);
    }

    if (worldDeltaContent) {
      dbInsert('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
        [sessionId, 'world_delta', worldDeltaContent, new Date().toISOString()]);
    }

    send({ world_delta_done: true, content: worldDeltaContent });

    // ── Phase 3: Session report ──────────────────────────────────────────────
    send({ report_start: true });

    const reportHistory = [...baseHistory, {
      role: 'user',
      content: 'Now please write a session report — a narrative, blog-style account of this session written in past tense. Cover the key events, decisions, discoveries, and notable moments as an engaging adventure recap. This will serve as the permanent archive of this session.',
    }];

    let reportContent = '';
    try {
      const reportStream = anthropic.messages.stream({
        model:      'claude-sonnet-4-6',
        max_tokens: 2048,
        system:     systemPrompt,
        messages:   reportHistory,
      });
      for await (const event of reportStream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          reportContent += event.delta.text;
          send({ report_text: event.delta.text });
        }
      }
    } catch (reportErr) {
      console.error('Session report generation error:', reportErr);
    }

    if (reportContent) {
      dbInsert('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)',
        [sessionId, 'archive', reportContent, new Date().toISOString()]);
    }

    // Trim after both state and report are saved (trim keeps archive + state)
    trimEndedSessionMessages(sessionId);

    send({ report_done: true, content: reportContent });
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
        const toolName = d.tool_name || 'query_rules';
        const input = d.expressions
          ? { expressions: d.expressions, label: d.label }
          : { question: d.question };
        const entry = { type: 'tool_use', id: d.tool_use_id, name: toolName, input };
        const last = history[history.length - 1];
        if (last?.role === 'assistant' && Array.isArray(last.content)) {
          last.content.push(entry);
        } else {
          history.push({ role: 'assistant', content: [entry] });
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
