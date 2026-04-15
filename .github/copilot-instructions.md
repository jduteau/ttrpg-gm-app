# TTRPG GM App — Copilot Instructions

A self-hosted AI Game Master application for solo tabletop RPG campaigns. Node.js/Express backend, React/Vite frontend, SQLite via sql.js, Anthropic API for streaming chat and tool use.

---

## Project Structure

```
ttrpg-gm-app/
├── server/
│   ├── index.js                        # Express server — all API routes and Anthropic calls
│   ├── arbiter-prompt.md               # Shared rules arbiter persona
│   ├── session-state-instructions.md   # Shared GM instructions for reading/writing state
│   ├── session-state-template.md       # Universal session state template (fallback)
│   └── campaigns/
│       ├── ose/
│       │   ├── system-prompt.md        # GM persona, rules, party stats
│       │   ├── rules-arbiter.md        # OSE rules reference for arbiter
│       │   ├── session-state-fields.md # Campaign-specific state template (overrides universal)
│       │   ├── session-state.md        # Current campaign state (auto-managed)
│       │   ├── state-backups/          # Dated state snapshots
│       │   ├── modules/                # Module content files (.md)
│       │   └── references/             # Reference files (.md) — party, monsters, tables
│       ├── masks/                      # Same structure
│       ├── dragonbane/                 # Same structure
│       └── ironsworn/                  # Same structure
├── client/
│   ├── index.html
│   ├── vite.config.js                  # Proxies /api → localhost:3001
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                     # Root: campaign selector, session routing, dialog state
│       ├── App.css
│       ├── index.css                   # CSS variables and global styles
│       └── components/
│           ├── CampaignSelector.jsx    # Full-screen campaign picker
│           ├── CampaignSelector.css
│           ├── Sidebar.jsx             # Session list, active context files, state badge
│           ├── Sidebar.css
│           ├── ChatWindow.jsx          # Main chat, streaming, arbiter blocks, state blocks
│           ├── ChatWindow.css
│           ├── NewSessionDialog.jsx    # Module/reference picker before session starts
│           └── NewSessionDialog.css
├── import-sessions.js                  # CLI tool: import blog post archives into DB
├── package.json                        # Root: concurrently dev scripts
├── .env.example                        # ANTHROPIC_API_KEY, PORT
└── .github/
    └── copilot-instructions.md         # This file
```

---

## Tech Stack

- **Backend**: Node.js 18+, Express, ES modules (`"type": "module"`)
- **Database**: sql.js (pure-JS SQLite, no native compilation) — `server/data/sessions.db`
- **AI**: `@anthropic-ai/sdk` — streaming via `anthropic.messages.stream()`, tool use for rules arbiter
- **Frontend**: React 18, Vite 5, plain CSS (no Tailwind, no component library)
- **Dev**: `concurrently` to run server and client together via `npm run dev` from root

---

## Running the App

```bash
# Install (run once, or after adding dependencies)
npm install
npm install --prefix server
npm install --prefix client

# Development
npm run dev              # starts both server (port 3001) and client (port 5173)
npm run dev:server       # server only
npm run dev:client       # client only

# Production
npm run build            # compiles React into client/dist
npm start                # serves everything from Express on port 3001
```

The Vite dev proxy forwards `/api/*` requests to `localhost:3001`.

---

## Environment

Copy `.env.example` to `.env` in the project root and fill in:

```
ANTHROPIC_API_KEY=sk-ant-...
PORT=3001
```

The server loads this via `dotenv/config`.

---

## Database Schema

Managed by `server/index.js` on startup. Uses sql.js with manual save-to-disk after every write.

```sql
sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id   TEXT NOT NULL,           -- 'ose' | 'masks' | 'dragonbane' | 'ironsworn'
  title         TEXT NOT NULL,
  context_files TEXT NOT NULL DEFAULT '[]',  -- JSON array of relative file paths
  ended_at      TEXT,                    -- ISO timestamp, null if session active
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
)

messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  role       TEXT NOT NULL,   -- 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'archive' | 'state'
  content    TEXT NOT NULL,   -- plain text, or JSON string for tool_use/tool_result
  created_at TEXT NOT NULL
)
```

### Message roles
| Role | Content | Purpose |
|------|---------|---------|
| `user` | plain text | Player input |
| `assistant` | plain text | GM response |
| `tool_use` | JSON `{tool_use_id, question}` | Rules arbiter query (for UI rendering) |
| `tool_result` | JSON `{tool_use_id, result}` | Rules arbiter ruling (for UI rendering) |
| `archive` | plain text | Imported session blog post |
| `state` | plain text | End-of-session state snapshot |

---

## API Routes

All routes are in `server/index.js`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/campaigns` | List all campaigns |
| GET | `/api/campaigns/:id/files` | List modules, references, hasArbiter, hasState |
| GET | `/api/campaigns/:id/sessions` | List sessions (newest first) |
| POST | `/api/campaigns/:id/sessions` | Create session `{title?, context_files[]}` |
| GET | `/api/sessions/:id/messages` | All messages for a session |
| DELETE | `/api/sessions/:id` | Delete session and messages |
| POST | `/api/sessions/:id/chat` | Send message → SSE stream |
| POST | `/api/sessions/:id/end` | End session → SSE stream (generates + saves state) |

### SSE event types (chat and end endpoints)

```js
{ text: "..." }                          // streaming GM text chunk
{ arbiter_start: true, question: "..." } // arbiter being consulted
{ arbiter_done: true, question, ruling } // arbiter ruling received
{ state_start: true }                    // end-session state generation starting
{ state_done: true, content: "..." }     // state saved to file
{ done: true }                           // stream complete
{ error: "..." }                         // error occurred
```

---

## System Prompt Assembly

Every API call assembles the system prompt in this order:

1. `campaigns/{id}/system-prompt.md` — GM persona, rules, setting
2. `session-state-instructions.md` — shared: how to read/write state
3. `campaigns/{id}/session-state-fields.md` if present, otherwise `session-state-template.md` — state format
4. `campaigns/{id}/session-state.md` if it has real content — restored campaign state
5. Each file in `context_files[]` — selected modules and references

---

## Rules Arbiter

When `campaigns/{id}/rules-arbiter.md` exists, the GM gets a `query_rules` tool. The tool call:

1. Interrupts the GM stream
2. Makes a separate non-streaming Anthropic call with `arbiter-prompt.md` + `rules-arbiter.md`
3. Returns the ruling as a tool result
4. GM stream continues incorporating the ruling

Tool use and tool results are saved as separate DB rows (`tool_use` / `tool_result` roles) for UI rendering. The `ChatWindow` merges them into `ArbiterBlock` components.

---

## Session State

- `session-state.md` — current state, read at every session start, overwritten on End Session
- `state-backups/session-state-YYYY-MM-DD.md` — automatic dated backup before overwrite
- State is detected as "real" only if the file exists, is non-empty, and doesn't start with `<!--`

End Session flow:
1. User clicks End Session → confirmation dialog
2. POST `/api/sessions/:id/end`
3. Server appends a fixed instruction to history asking GM to produce state snapshot
4. GM streams the state block (not saved as a normal message during streaming)
5. On completion, state is saved to file + backup, and stored in DB as `role: 'state'`
6. Session marked `ended_at = now`

---

## Campaigns

Defined in `CAMPAIGNS` object in `server/index.js`:

```js
const CAMPAIGNS = {
  ose:        { id, name, subtitle, icon: '⚔️',  color: '#c0392b' },
  masks:      { id, name, subtitle, icon: '🦸',  color: '#8e44ad' },
  dragonbane: { id, name, subtitle, icon: '🐉',  color: '#16a085' },
  ironsworn:  { id, name, subtitle, icon: '🤠',  color: '#d35400' },
};
```

Each campaign uses `--campaign-color` CSS variable throughout the UI for theming.

### Adding a campaign

1. Add entry to `CAMPAIGNS` in `server/index.js`
2. Create `server/campaigns/{id}/` with `system-prompt.md`
3. Optionally add `rules-arbiter.md`, `session-state-fields.md`, `modules/`, `references/`

---

## Frontend Conventions

- **CSS variables** defined in `client/src/index.css` — always use these, never hardcode colours
- **Campaign colour** passed as `--campaign-color` prop via inline style on container elements
- **No component library** — all styling is hand-written CSS in co-located `.css` files
- **Font stack**: `--font-display` (Cinzel) for headings/labels, `--font-body` (Crimson Pro) for prose
- **Dark theme only** — backgrounds use `--bg-void` / `--bg-deep` / `--bg-surface` / `--bg-raised`
- **Animations**: `fadeUp` keyframe used for message/block entry; `blink` for streaming cursor

### Key CSS variables

```css
--bg-void, --bg-deep, --bg-surface, --bg-raised, --bg-hover
--border-dim, --border-mid, --border-bright
--text-primary, --text-secondary, --text-muted, --text-dim
--accent-gold, --accent-gold-dim, --accent-gold-glow
--font-display, --font-body
--sidebar-width: 260px
--transition: 0.18s ease
```

### Component responsibilities

- **App.jsx** — campaign selection state, active session state, dialog visibility, API calls for session creation
- **CampaignSelector.jsx** — full-screen picker, no state, pure display + callback
- **Sidebar.jsx** — fetches its own session list, re-fetches when `activeSession` changes, shows context files for active session
- **ChatWindow.jsx** — owns all streaming state: `streamBuffer`, `pendingArbiter`, `arbiterBlocks`, `stateBuffer`, `ending`, `sessionEnded`
- **NewSessionDialog.jsx** — fetches available files on mount, manages checkbox selection, calls back with `{title, context_files}`

---

## Import Tool

`import-sessions.js` — run from project root, uses server's sql.js installation.

```bash
node import-sessions.js --campaign ose --file "session1.md" --title "Session 1"
node import-sessions.js --campaign ose --dir "./my-sessions/"
node import-sessions.js --list
```

Imported posts are stored as `role: 'archive'` messages and rendered as gold-bordered blocks in the UI. They are excluded from the Anthropic message history sent to the GM (the GM doesn't see archive content as conversation history).

---

## Known Patterns and Gotchas

- **sql.js saves**: every DB write calls `saveDb()` which writes the whole DB to disk. This is intentional — sql.js is in-memory and the file is the persistence layer.
- **ES modules**: the server uses `"type": "module"` — use `import/export`, not `require()`.
- **Top-level await**: `server/index.js` uses top-level await for `initSqlJs()` — this requires Node 18+.
- **Stream loop**: the chat endpoint uses a `while (continueLoop)` pattern to handle multiple tool use calls in a single GM response. Each loop iteration is one Anthropic API call.
- **History reconstruction**: `buildHistory()` in the server reconstructs the full Anthropic-compatible message array from DB rows, including interleaving `tool_use` and `tool_result` content blocks in the right positions.
- **Archive messages excluded**: `archive` and `state` role messages are skipped in `buildHistory()` — they are context for the system prompt, not conversation turns.
- **Campaign color theming**: pass `style={{ '--campaign-color': campaign.color }}` on a container, then use `var(--campaign-color)` in CSS. Never hardcode campaign colours in CSS files.
- **File label formatting**: `labelFromFilename()` strips leading `01-` numeric prefixes and converts hyphens/underscores to title case. Name files accordingly.
