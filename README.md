# GM Screen — TTRPG Campaign Manager

A self-hosted AI Game Master app for your tabletop RPG campaigns. Built with Node.js/Express, React, and the Anthropic API.

## Campaigns included
- ⚔️ OSE Advanced Fantasy — The Lolth Conspiracy
- 🦸 Masks: A New Generation
- 🐉 Dragonbane
- 🤠 Ironsworn: Badlands

---

## Setup

### 1. Prerequisites
- Node.js 18+ 
- An Anthropic API key (https://console.anthropic.com)

### 2. Install dependencies
```bash
npm install
```

### 3. Configure your API key
```bash
cp .env.example .env
# Edit .env and paste your ANTHROPIC_API_KEY
```

### 4. Add your GM prompts
Copy your system prompt text files into `server/campaigns/`:
```
server/campaigns/ose.txt         ← OSE Advanced Fantasy GM prompt
server/campaigns/masks.txt       ← Masks GM prompt
server/campaigns/dragonbane.txt  ← Dragonbane GM prompt
server/campaigns/ironsworn.txt   ← Ironsworn Badlands GM prompt
```
Placeholder files are included — replace their contents with your full prompts.
The server reloads prompts on every request, so no restart needed after editing.

### 5. Run in development mode
```bash
npm run dev
```
Open http://localhost:5173

### 6. Run in production
```bash
npm run build        # builds the React client into server/public
npm run start        # serves everything from Express on port 3001
```

---

## Project structure
```
ttrpg-gm-app/
├── server/
│   ├── index.js          # Express API + Anthropic streaming proxy
│   ├── campaigns/        # GM prompt .txt files (one per campaign)
│   └── data/             # SQLite database (auto-created on first run)
├── client/               # Vite + React frontend
│   └── src/
│       ├── App.jsx
│       └── components/
│           ├── CampaignSelector.jsx
│           ├── Sidebar.jsx
│           └── ChatWindow.jsx
├── .env.example
└── package.json
```

---

## Adding a new campaign
1. Add a new entry to the `CAMPAIGNS` object in `server/index.js`
2. Create a corresponding prompt file in `server/campaigns/`
3. Restart the server

---

## Data
- All session data is stored locally in `server/data/sessions.db` (SQLite)
- No data leaves your machine except API calls to Anthropic
- To back up your campaigns, copy the `sessions.db` file
