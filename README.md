# GM Screen — TTRPG Campaign Manager

A self-hosted AI Game Master app for solo tabletop RPG campaigns. Built with Node.js/Express, React, and the Anthropic API. Supports multiple rulesets and campaigns with a two-stage selector (rules system → campaign), streaming chat, a built-in dice roller, a rules arbiter, session state management, and MCP server integration for world information.

The UI uses a parchment palette with shared theme tokens for campaign accents, arbiter highlights, destructive actions, overlays, shadows, and surface washes so the client stays visually consistent across screens and dialogs. Theme retuning should happen in `client/src/index.css` rather than by editing literal colors in individual component styles.

The frontend is responsive for desktop, iPad, and iPhone layouts. On narrower screens the campaign sidebar becomes a slide-in drawer, the new-session dialog becomes a bottom sheet, and the app uses dynamic viewport sizing plus safe-area padding for Mobile Safari.

---

## Setup

### 1. Prerequisites
- Node.js 18+
- An Anthropic API key (https://console.anthropic.com)

### 2. Install dependencies
```bash
npm install
npm install --prefix server
npm install --prefix client
```

### 3. Configure your API key
```bash
cp .env.example .env
# Edit .env and paste your ANTHROPIC_API_KEY
# Optionally set CONTENT_DIR if you want content stored outside the project
# Optionally set WORLD_MCP_SERVER_URL to connect to your world MCP server
```

### 4. Run in development mode
```bash
npm run dev
```
Opens the client at http://localhost:5173 (API on port 3001).

### 5. Run in production
```bash
npm run build   # compiles the React client into client/dist
npm start       # serves everything from Express on port 3001
```

---

## Project structure
```
ttrpg-gm-app/
├── content/                          # Campaign content and database
│   ├── arbiter-prompt.md             # Generic rules arbiter persona
│   ├── session-state-instructions.md # GM instructions for reading/writing state
│   ├── session-state-template.md     # Fallback state template
│   ├── world-arbiter-usage.md        # World query usage instructions
│   ├── data/
│   │   └── sessions.db               # SQLite database (sql.js)
│   └── rulesets/
│       └── {rulesetId}/
│           ├── system-prompt.md      # Core rules (# header = display name)
│           ├── session-state-fields.md  # Optional: ruleset-specific state format
│           └── campaigns/
│               └── {campaignId}/
│                   ├── campaign-prompt.md  # Party, setting, house rules (# header = display name)
│                   └── session-state.md    # Current campaign state (auto-updated)
├── server/
│   ├── index.js                      # Express API, Anthropic streaming, all routes
│   └── world-mcp-client.js           # MCP client for world information
├── client/                           # Vite + React frontend
│   └── src/
│       ├── App.jsx
│       └── components/
│           ├── CampaignSelector.jsx
│           ├── Sidebar.jsx
│           ├── ChatWindow.jsx
│           └── NewSessionDialog.jsx
├── import-sessions.js                # CLI: import recaps and state files
├── MCP-INTEGRATION-SUMMARY.md        # Documentation for MCP server integration
├── .env.example
└── package.json
```

---

## Adding content

### Add a new campaign to an existing ruleset
1. Create `content/rulesets/{rulesetId}/campaigns/{campaignId}/campaign-prompt.md`
2. First line should be a `# Campaign Name` header
3. Add a `## Campaign Overview` section for the description shown in the UI
4. Restart the server — it auto-discovers the new campaign

### Add a new ruleset
1. Create `content/rulesets/{rulesetId}/system-prompt.md` (first line: `# Ruleset Name`)
2. Optionally add `rules-arbiter.md` to enable the rules arbiter tool, `session-state-fields.md` for custom state format
3. Create at least one campaign under `campaigns/`
4. Optionally add an icon/color entry to `RULESET_DEFAULTS` in `server/index.js`.
	Choose a muted accent that stays readable against the parchment UI theme rather than a highly saturated dark-theme color.
5. Restart the server

### World Information via MCP Server
World information (locations, NPCs, factions, lore) is now handled by an external MCP (Model Context Protocol) server instead of local files. See `MCP-INTEGRATION-SUMMARY.md` for details on implementing the MCP server interface.

---

## Importing past sessions

Use `import-sessions.js` to import existing session recaps and/or state files:

```bash
# Recap only
node import-sessions.js --campaign ose.lolth-conspiracy --file "session1.md"
node import-sessions.js --campaign ose.lolth-conspiracy --file "session1.md" --title "The Village of Hommlet"

# Recap + state (marks session as ended, writes session-state.md)
node import-sessions.js --campaign ose.lolth-conspiracy --file "session1.md" --state "session1-state.md"

# State only
node import-sessions.js --campaign ose.lolth-conspiracy --state "session1-state.md" --title "Session 1"

# Bulk import a folder of recaps
node import-sessions.js --campaign ose.lolth-conspiracy --dir "./my-sessions/"

# List all sessions in the database
node import-sessions.js --list
```

Importing with `--state` writes the state to `session-state.md` in the campaign folder and marks the session as ended in the database.

Tip: use single quotes for paths with spaces — `'~/Documents/My Sessions/session1.md'`

---

## Data
- All session data is stored locally in `content/data/sessions.db` (SQLite via sql.js)
- No data leaves your machine except API calls to Anthropic
- To back up your data, copy `content/data/sessions.db` and the `content/rulesets/` folder
- Set `CONTENT_DIR` in `.env` to store content outside the project directory (useful for server deployments)

---

## World State & Session State

The app maintains two types of persistent state:

### Session State
- **Purpose**: Where the story is right now and what's happening next
- **File**: `session-state.md` in each campaign folder
- **Contains**: Character positions, health, active quests, immediate plot threads, pending decisions
- **When**: Updated at the end of each session

### World State
- **Purpose**: What exists and what happened (accumulated facts and continuity)
- **Storage**: MCP (Model Context Protocol) server instead of local files
- **Contains**: Established locations, NPCs, factions, party reputation, historical events, open plot hooks
- **When**: Delta generated at the end of each session and sent to MCP server

### End Session Workflow
When you end a session, the GM will:
1. Generate a **session state snapshot** (immediate situation) → saved to local file
2. Generate a **world state delta** (new facts established this session) → sent to MCP server
3. Create a **session report** (narrative recap for archives)

The world state delta captures everything mentioned during play—NPCs, locations, prices, rumors, party actions—and is automatically sent to your MCP server for integration into the campaign's world knowledge. This ensures nothing important gets forgotten between sessions.

### MCP Server Setup
To use world state functionality, you'll need to set up an MCP server that implements the world information interface. See `MCP-INTEGRATION-SUMMARY.md` for details on:
- Required MCP server endpoints (`getWorldContext`, `queryWorld`)
- Data formats and API specifications 
- Connecting your MCP server via `WORLD_MCP_SERVER_URL` environment variable

### Session State

Session state files are updated at session end:
- `session-state.md`
