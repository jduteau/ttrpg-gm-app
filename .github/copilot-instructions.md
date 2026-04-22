# TTRPG GM App — Copilot Instructions

A self-hosted AI Game Master application for solo tabletop RPG campaigns. Node.js/Express backend, React/Vite frontend, SQLite via sql.js, Anthropic API for streaming chat and tool use, MCP server integration for world information.

---

## Project Structure

```
ttrpg-gm-app/
├── content/                                # Campaign content and database
│   ├── arbiter-prompt.md                   # Generic rules arbiter persona
│   ├── session-state-instructions.md       # Generic GM instructions for reading/writing state
│   ├── session-state-template.md           # Universal session state template (fallback)
│   ├── world-arbiter-usage.md              # Generic world query usage instructions
│   ├── data/
│   │   └── sessions.db                     # SQLite database (sql.js)
│   └── rulesets/
│       └── ose/
│           ├── system-prompt.md            # Core OSE rules and mechanics
│           ├── session-state-fields.md     # OSE-specific state template
│           └── campaigns/
│               └── lolth-conspiracy/
│                   ├── campaign-prompt.md  # Party, setting, house rules
│                   ├── session-state.md    # Current campaign state (updated at session end)
│                   └── state-backups/      # Dated session state snapshots
├── server/
│   ├── index.js                            # Express server — all API routes and Anthropic calls
│   └── world-mcp-client.js                 # MCP client for world information
├── client/
│   ├── index.html
│   ├── vite.config.js                      # Proxies /api → localhost:3001
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                         # Root: two-stage campaign selector, session routing, dialog state
│       ├── App.css
│       ├── index.css                       # CSS variables and global styles
│       └── components/
│           ├── AuthScreen.jsx              # Password entry screen for basic protection
│           ├── AuthScreen.css
│           ├── CampaignSelector.jsx        # Two-stage selector: ruleset → campaign
│           ├── CampaignSelector.css
│           ├── Sidebar.jsx                 # Session list, active context files, state badge
│           ├── Sidebar.css
│           ├── ChatWindow.jsx              # Main chat, streaming, arbiter blocks, state blocks
│           ├── ChatWindow.css
│           ├── NewSessionDialog.jsx        # Module/reference picker before session starts
│           └── NewSessionDialog.css
├── import-sessions.js                      # CLI tool: import blog post archives into DB
├── package.json                            # Root: concurrently dev scripts
├── .env.example                            # ANTHROPIC_API_KEY, PORT, APP_PASSWORD, CONTENT_DIR, CORS_ORIGIN, WORLD_MCP_SERVER_URL
├── MCP-INTEGRATION-SUMMARY.md              # Documentation for MCP server integration
└── .github/
    └── copilot-instructions.md             # This file
```

---

## Tech Stack

- **Backend**: Node.js 18+, Express, ES modules (`"type": "module"`)
- **Database**: sql.js (pure-JS SQLite, no native compilation) — `content/data/sessions.db`
- **AI**: `@anthropic-ai/sdk` — streaming via `anthropic.messages.stream()`, tool use for rules arbiter and world queries
- **World Data**: MCP (Model Context Protocol) server integration for campaign world information
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

# Simple password protection for the frontend
# Leave empty to disable authentication
APP_PASSWORD=your_secure_password_here

# Optional: path to content directory (rulesets, prompts, database)
# Defaults to ./content relative to the project root
# CONTENT_DIR=/path/to/content

# Optional: allowed CORS origins for split client/server deploys
# CORS_ORIGIN=https://your-client.example.com

# MCP World Server Configuration
# URL to the world MCP server that provides campaign world information
# WORLD_MCP_SERVER_URL=ws://localhost:3333/ws
```

The server loads this via `dotenv/config`.

---

## Database Schema

Managed by `server/index.js` on startup. Uses sql.js with manual save-to-disk after every write.

```sql
sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id   TEXT NOT NULL,           -- Composite ID: 'ose.lolth-conspiracy' | 'masks.halcyon-city' | etc.
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
|------|---------|-------|
| `user` | plain text | Player input |
| `assistant` | plain text | GM response |
| `tool_use` | JSON `{tool_use_id, question}` or `{tool_use_id, tool_name, ...}` | Rules arbiter or world query (for UI rendering) |
| `tool_result` | JSON `{tool_use_id, result}` | Tool response (for UI rendering) |
| `archive` | plain text | Imported session blog post |
| `state` | plain text | End-of-session state snapshot (includes world updates) |

### Message Trimming

Ended sessions automatically trim conversation messages to keep the database lean:
- **Kept**: `archive` and `state` messages (provide continuity)
- **Removed**: `user`, `assistant`, `tool_use`, `tool_result` messages (conversational flow)

When a session ends, only archive content and final state are preserved. The next session starts fresh with the state file injected into the system prompt, maintaining full continuity.

---

## API Routes

All routes are in `server/index.js`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/verify` | Password authentication → returns Bearer token |
| GET | `/api/rulesets` | List all rulesets with their campaigns (protected) |
| GET | `/api/campaigns/:campaignId/files` | List modules, references, hasArbiter, hasState (protected) |
| GET | `/api/campaigns/:campaignId/sessions` | List sessions (newest first, protected) |
| POST | `/api/campaigns/:campaignId/sessions` | Create session `{title?, context_files[]}` (protected) |
| GET | `/api/sessions/:id/messages` | All messages for a session (protected) |
| DELETE | `/api/sessions/:id` | Delete session and messages (protected) |
| POST | `/api/sessions/cleanup` | Trim messages from all ended sessions (protected) |
| POST | `/api/sessions/:id/chat` | Send message → SSE stream (protected) |
| POST | `/api/sessions/:id/end` | End session → SSE stream (generates + saves state, protected) |

**Authentication**: All routes except `/api/auth/verify` require a valid Bearer token in the `Authorization` header. Tokens expire after 24 hours and are managed in-memory on the server.

### SSE event types (chat and end endpoints)

```js
{ text: "..." }                              // streaming GM text chunk
{ arbiter_start: true, question: "..." }     // arbiter being consulted
{ arbiter_done: true, question, ruling }     // arbiter ruling received
{ dice_roll: true, label, expressions, results } // dice rolled server-side
{ state_start: true }                        // end-session state generation starting
{ state_done: true, content: "..." }         // state saved to file
{ report_text: "..." }                        // streaming session report chunk
{ done: true }                               // stream complete
{ error: "..." }                             // error occurred
```

---

## System Prompt Assembly

Every API call assembles the system prompt in this order:

1. `rulesets/{rulesetId}/system-prompt.md` — Core rules and mechanics
2. `session-state-instructions.md` — Shared: how to read/write state
3. `world-arbiter-usage.md` — Shared: how to use query_world tool
4. `rulesets/{rulesetId}/session-state-fields.md` if present, otherwise `session-state-template.md` — State format
5. `rulesets/{rulesetId}/campaigns/{campaignId}/campaign-prompt.md` — Party, setting, house rules
6. World context from MCP server (replaces world-state.md files) — Accumulated campaign facts for consistency
7. `rulesets/{rulesetId}/campaigns/{campaignId}/session-state.md` if it has real content — Current campaign state
8. Each file in `context_files[]` — Selected modules and references (no longer supported, kept for compatibility)

---

## Rules Arbiter

When a ruleset has a `rules-arbiter.md` file, the GM gets a `query_rules` tool. The tool call:

1. Interrupts the GM stream
2. Makes a separate non-streaming Anthropic call with `arbiter-prompt.md` + `rules-arbiter.md` system prompt
3. Returns the ruling as a tool result
4. GM stream continues incorporating the ruling

Tool use and tool results are saved as separate DB rows (`tool_use` / `tool_result` roles) for UI rendering. The `ChatWindow` merges them into `ArbiterBlock` components.

---

## World Query System

The GM has access to a `query_world` tool that consults the campaign's world knowledge through an MCP (Model Context Protocol) server. This replaces the previous world-state.md file system.

### How it Works

1. **Session Start**: App queries MCP server for world context → injects into system prompt
2. **During Session**: GM can use `query_world` tool as needed for continuity
3. **Session End**: World delta generated → sent to MCP server for persistence

### Tool Usage

The GM uses `query_world` whenever they need information about:
- **Locations**: Geography, settlements, dungeons, points of interest
- **NPCs**: Characters, relationships, current dispositions
- **Factions**: Organizations, political entities, standings with party
- **Party Reputation**: How different groups view the party
- **Lore**: Historical events, legends, cultural knowledge
- **Open Threads**: Ongoing quests, unresolved mysteries, future plot hooks

Queries are specific and contextual, e.g., "What does the party know about the Temple of Elemental Evil?" or "NPCs in Hommlet who might help with information".

---

## Dice Roller

The GM always has a `roll_dice` tool available (alongside `query_rules` when an arbiter exists and `query_world` for world information). The tool:

1. Is called by the GM with `{ expressions: ["d20", "2d6"], label: "Attack roll" }`
2. Rolls dice server-side using `crypto.randomInt` (cryptographically random)
3. Emits `{ dice_roll: true, label, expressions, results }` SSE event to the client
4. Returns the formatted result string to the GM as a tool result so it can narrate the outcome

Supported expressions: `d20`, `2d6`, `3d6+2`, `4d6k3` (keep highest 3), `d100`, `d8-1`

DB storage: `tool_use` row has `{ tool_use_id, tool_name: 'roll_dice', expressions, label }`; `tool_result` row has `{ tool_use_id, result }`.

The `ChatWindow` renders dice rolls as compact `DiceRollBlock` components. `mergeMessages()` detects dice roll pairs by the presence of `d.expressions` (vs `d.question` for arbiter pairs).

The GM always has a `roll_dice` tool available (alongside `query_rules` when an arbiter exists). The tool:

1. Is called by the GM with `{ expressions: ["d20", "2d6"], label: "Attack roll" }`
2. Rolls dice server-side using `crypto.randomInt` (cryptographically random)
3. Emits `{ dice_roll: true, label, expressions, results }` SSE event to the client
4. Returns the formatted result string to the GM as a tool result so it can narrate the outcome

Supported expressions: `d20`, `2d6`, `3d6+2`, `4d6k3` (keep highest 3), `d100`, `d8-1`

DB storage: `tool_use` row has `{ tool_use_id, tool_name: 'roll_dice', expressions, label }`; `tool_result` row has `{ tool_use_id, result }`.

The `ChatWindow` renders dice rolls as compact `DiceRollBlock` components. `mergeMessages()` detects dice roll pairs by the presence of `d.expressions` (vs `d.question` for arbiter pairs).

---

## Session State

- `rulesets/{rulesetId}/campaigns/{campaignId}/session-state.md` — Current state, read at every session start, overwritten on End Session
- State is detected as "real" only if the file exists, is non-empty, and doesn't start with `<!--`

## World State

- World information is now served by an MCP (Model Context Protocol) server instead of local files
- Contains established facts organized by category: LOCATIONS, NPCS, FACTIONS, PARTY, LORE, OPEN THREADS
- Used as foundation for consistency and continuity, injected into system prompt via MCP query
- World deltas are sent to MCP server instead of being written to files

End Session flow:
1. User clicks End Session → confirmation dialog
2. POST `/api/sessions/:id/end`
3. Server appends a fixed instruction to history asking GM to produce combined state snapshot (includes session state and world updates)
4. GM streams the state block (not saved as a normal message during streaming)
5. On completion, state is saved to file, stored in DB as `role: 'state'`
6. Session marked `ended_at = now`
7. Conversation messages automatically trimmed to keep database lean

---

## Rulesets and Campaigns

Rulesets and campaigns are **dynamically discovered** by scanning the `content/rulesets/` directory at server startup — no hardcoded definitions required.

### Discovery mechanism (`server/index.js`)

- `scanRulesets()` — reads each subdirectory of `content/rulesets/`, extracts the name from the first markdown header in `system-prompt.md`
- `scanCampaigns()` — for each ruleset, reads each subdirectory of `campaigns/`, extracts name from `campaign-prompt.md`
- Results are cached in `_rulesetsCache` / `_campaignsCache` for the lifetime of the server process
- `RULESET_DEFAULTS` provides icon/color overrides for known ruleset IDs; unknown rulesets fall back to `🎲` / `#6e7560`

### Adding a new campaign to an existing ruleset

1. Create `content/rulesets/{rulesetId}/campaigns/{campaignId}/` with `campaign-prompt.md`
2. Optionally add campaign-specific `session-state.md`
3. Restart the server — it will be auto-discovered

### Adding a new ruleset

1. Create `content/rulesets/{rulesetId}/` with `system-prompt.md` (first line should be a `#` header — used as the display name)
2. Optionally add `rules-arbiter.md` to enable the rules arbiter tool, `session-state-fields.md` for custom state format
3. Create first campaign under `campaigns/` subdirectory
4. Add an entry to `RULESET_DEFAULTS` in `server/index.js` for custom icon/color (optional)

---

## Authentication

Simple password-based protection for self-hosted use. Not enterprise-grade but sufficient to keep casual visitors out.

### Frontend Authentication
- **AuthScreen component** — Password entry with parchment theme styling
- **Token storage** — 24-hour Bearer tokens in `localStorage`
- **Authentication state** — App.jsx manages auth state and checks tokens on load
- **API integration** — `getAuthHeaders()` helper adds tokens to all requests

### Backend Authentication  
- **Password verification** — Compares against `APP_PASSWORD` environment variable
- **Token management** — In-memory Set with automatic cleanup after 24 hours
- **Route protection** — `requireAuth` middleware on all `/api/*` routes except `/api/auth/verify`
- **Graceful fallback** — If `APP_PASSWORD` not set, auth is disabled with console warning

### Authentication Flow
1. App checks `localStorage` for existing token on load
2. If token exists, validates with test API request to `/api/rulesets`
3. Invalid/missing token → `AuthScreen` component  
4. Valid password → server generates token, client stores in `localStorage`
5. All subsequent API calls include `Authorization: Bearer <token>` header
6. Tokens auto-expire after 24 hours, requiring re-authentication

### Key Files
- `client/src/components/AuthScreen.jsx` — Password entry UI
- `client/src/api.js` — `getAuthHeaders()` helper for token inclusion
- `server/index.js` — Auth middleware, token management, `/api/auth/verify` route

---

## Frontend Conventions

- **CSS variables** defined in `client/src/index.css` — always use these, never hardcode colours
- **Campaign colour** passed as `--campaign-color` prop via inline style on container elements
- **Two-stage selection** — `CampaignSelector` first shows rulesets, then campaigns for the selected ruleset, with breadcrumb navigation and back button
- **No component library** — all styling is hand-written CSS in co-located `.css` files
- **Font stack**: `--font-display` (Cinzel) for headings/labels, `--font-body` (Crimson Pro) for prose
- **Parchment theme** — backgrounds use `--bg-void` / `--bg-deep` / `--bg-surface` / `--bg-raised` for warm paper surfaces rather than dark panels
- **Animations**: `fadeUp` keyframe used for message/block entry; `blink` for streaming cursor
- **Responsive shell** — pair `100vh` with `100dvh`, set `viewport-fit=cover`, and use `env(safe-area-inset-*)` spacing so the UI behaves on iPhone/iPad Safari. On narrow screens the sidebar is a drawer controlled by `App.jsx`, and `NewSessionDialog` becomes a bottom sheet.

### Key CSS variables

```css
--bg-void, --bg-deep, --bg-surface, --bg-raised, --bg-hover
--bg-wash, --bg-wash-strong, --bg-panel-tint, --bg-panel-tint-strong, --bg-campaign-tint, --bg-header
--border-dim, --border-mid, --border-bright
--border-grid-strong, --border-grid-soft
--text-primary, --text-secondary, --text-muted, --text-dim
--accent-gold, --accent-gold-dim, --accent-gold-glow
--accent-gold-soft, --accent-gold-faint
--accent-arbiter, --accent-arbiter-soft, --accent-danger, --accent-danger-soft
--overlay-veil, --shadow-soft, --shadow-gold-soft, --shadow-gold-tight, --shadow-icon
--font-display, --font-body
--sidebar-width: 260px
--transition: 0.18s ease
```

### Component responsibilities

- **App.jsx** — campaign selection state, active session state, dialog visibility, API calls for session creation, fetches ruleset data from `/api/rulesets`
- **CampaignSelector.jsx** — full-screen two-stage picker: first select ruleset, then campaign, with breadcrumb navigation and back button. Uses internal state to track selected ruleset. Creates composite campaign IDs (`ruleset.campaign`) for compatibility.
- **Sidebar.jsx** — fetches its own session list, re-fetches when `activeSession` changes, shows context files for active session
- **ChatWindow.jsx** — owns all streaming state: `streamBuffer`, `pendingArbiter`, `arbiterBlocks`, `stateBuffer`, `ending`, `sessionEnded`
- **NewSessionDialog.jsx** — fetches available files on mount, manages checkbox selection, calls back with `{title, context_files}`

---

## Import Tool

`import-sessions.js` — run from project root. Loads sql.js via `createRequire` from `server/node_modules`.

```bash
# Recap only
node import-sessions.js --campaign ose.lolth-conspiracy --file "session1.md" --title "Session 1"

# State only
node import-sessions.js --campaign ose.lolth-conspiracy --state "session1-state.md" --title "Session 1"

# Bulk import folder (recaps only, no state)
node import-sessions.js --campaign ose.lolth-conspiracy --dir "./my-sessions/"

node import-sessions.js --list
```

- Recaps are stored as `role: 'archive'` messages — rendered as gold-bordered blocks in the UI, excluded from Anthropic message history
- State is stored as `role: 'state'` message, written to `session-state.md` in the campaign folder
- Sessions imported with `--state` are marked `ended_at` in the database
- Available campaigns are dynamically discovered from `content/rulesets/` (no hardcoded list)
- File paths support `~` expansion and shell backslash escapes; use single quotes in the shell to avoid quoting issues with spaces

---

## Known Patterns and Gotchas

- **sql.js saves**: every DB write calls `saveDb()` which writes the whole DB to disk. This is intentional — sql.js is in-memory and the file is the persistence layer.
- **ES modules**: the server uses `"type": "module"` — use `import/export`, not `require()`.
- **Top-level await**: `server/index.js` uses top-level await for `initSqlJs()` — this requires Node 18+.
- **Stream loop**: the chat endpoint uses a `while (continueLoop)` pattern to handle multiple tool use calls in a single GM response. Each loop iteration is one Anthropic API call.
- **History reconstruction**: `buildHistory()` in the server reconstructs the full Anthropic-compatible message array from DB rows, including interleaving `tool_use` and `tool_result` content blocks in the right positions.
- **Archive messages excluded**: `archive` and `state` role messages are skipped in `buildHistory()` — they are context for the system prompt or files on disk, not conversation turns.
- **Composite campaign IDs**: Campaign IDs use the format `rulesetId.campaignId` (e.g., `ose.lolth-conspiracy`). The `parseCampaignId()` helper splits these for file path construction.
- **File cascade loading**: The system first checks campaign-specific folders, then falls back to ruleset-level shared folders for modules and references.
- **Two-stage selector**: `CampaignSelector` uses internal state to track ruleset selection, creates composite `ruleset.campaign` IDs for compatibility, and maintains breadcrumb navigation with a back button.
- **Campaign color theming**: pass `style={{ '--campaign-color': ruleset.color }}` on a container, then use `var(--campaign-color)` in CSS. Colors come from the ruleset, not individual campaigns.
- **Accent palette**: prefer muted, ink-friendly campaign accents that still contrast on parchment backgrounds; avoid neon or overly saturated hues in `RULESET_DEFAULTS` and CSS vars.
- **Theme tokens first**: when adjusting the parchment UI, prefer adding or reusing semantic CSS variables in `client/src/index.css` rather than scattering literal `rgba(...)`, shadows, or parchment tint values across component styles.
- **Mobile navigation**: preserve access to campaigns and sessions through the drawer toggle in `App.jsx`; do not assume the sidebar is permanently visible.
- **File label formatting**: `labelFromFilename()` strips leading `01-` numeric prefixes and converts hyphens/underscores to title case. Campaign vs shared files are distinguished by `[Campaign]` and `[Shared]` prefixes.
- **Dynamic discovery caching**: `scanRulesets()` and `scanCampaigns()` cache results in module-level variables — the file system is only scanned once per server process. Use `getRuleset(id)` and `getCampaign(id)` helpers throughout the server code.
