# MCP Server Integration - Implementation Summary

## ✅ Changes Completed

### 1. **Content Structure Revised**
- Cleaned up content directory to match your specification:
  ```
  content/
  ├── arbiter-prompt.md              # Generic rules arbiter (existing)
  ├── session-state-instructions.md  # Generic session state handling (existing)  
  ├── world-arbiter-usage.md         # NEW: World query usage instructions
  └── rulesets/
      └── ose/
          ├── session-state-fields.md    # OSE-specific state format (existing)
          └── campaigns/
              └── lolth-conspiracy/
                  ├── campaign-prompt.md      # Campaign theme, party, etc. (existing)
                  └── session-state.md        # Current session state (existing)
  ```

- **Removed files/folders**:
  - All `world-state.md` files (world info now from MCP server)
  - All `world-backups/` directories
  - All `modules/` and `references/` directories  
  - All `rules-arbiter.md` files (now generic `arbiter-prompt.md`)

### 2. **MCP Client Implementation**
- **Added**: `server/world-mcp-client.js` - Stubbed MCP client with interface you need to implement
- **Note**: MCP client dependencies are commented out until MCP packages are published
- **Added**: Environment variable `WORLD_MCP_SERVER_URL` in `.env.example`

### 3. **Server Code Updates**
- **Modified**: `loadSystemPrompt()` to query MCP server instead of loading `world-state.md`
- **Added**: `query_world` tool for GM to query world information during sessions
- **Updated**: Session ending flow to send world deltas to MCP server
- **Simplified**: Rules arbiter to use generic `arbiter-prompt.md` instead of ruleset-specific files
- **Added**: Graceful shutdown handling for MCP client

### 4. **New World Query System**
- **Created**: `content/world-arbiter-usage.md` - Instructions for GM on how to use `query_world` tool
- **Available Tools**: GM now has `query_rules`, `query_world`, and `roll_dice` tools
- **Integration**: World context is injected into system prompt at session start via MCP call

### 5. **Session Flow Changes**
- **Session Start**: App queries MCP server for world context → injects into system prompt
- **During Session**: GM can use `query_world` tool as needed for continuity
- **Session End**: World information included in session state file (external processes handle MCP updates)

---

## 🚧 MCP Server Interface You Need to Build

The stubbed `world-mcp-client.js` defines the interface your MCP server needs to implement:

### **Required MCP Server Endpoints**

#### 1. **GetWorldContext**
```javascript
// Called at session start
async getWorldContext(campaignId) → string
```
- **Input**: `campaignId` (format: `"ruleset.campaign"` e.g., `"ose.lolth-conspiracy"`)  
- **Output**: Markdown text with accumulated world state for system prompt injection
- **Purpose**: Replace loading `world-state.md` files with dynamic MCP query

**Expected Response Format**:
```markdown
# World Context for Campaign

## LOCATIONS
- **Location Name** Description. [S1]

## NPCS  
- **NPC Name** Description, current disposition. [S2]

## FACTIONS
- **Faction** Current standing with party. [S1]

## PARTY
- **Reputation** How different groups view the party. [S3]

## LORE
- **Historical Fact** Established knowledge. [S1]

## OPEN THREADS
- **Active Quest** Current status. [S2]
```

#### 2. **QueryWorld** 
```javascript
// Called during sessions via query_world tool
async queryWorld(campaignId, query) → string
```
- **Input**: `campaignId`, `query` (GM's specific question)
- **Output**: Relevant world information  
- **Purpose**: Real-time world knowledge queries for continuity

**Example Queries**:
- `"What does the party know about the Temple of Elemental Evil?"`
- `"NPCs in Hommlet who might have information about missing caravans"`
- `"Current reputation with the Viscount of Verbobonc"`

---

## 📝 **Important Notes**

### **Read-Only Integration**
The MCP server integration is **read-only** from the app's perspective. World state updates are handled externally - the app only reads world context and queries information.

### **Session State File**
Session state files now contain both traditional session state AND world information updates. External processes can parse these files to update the MCP server as needed.

### **Connection Configuration**
```javascript
// Environment Variables
WORLD_MCP_SERVER_URL=ws://localhost:3333/ws  // or your MCP server endpoint

// In your MCP server, handle:
serverConfig = {
  url: process.env.WORLD_MCP_SERVER_URL,
  // Add authentication, connection options as needed
}
```

---

## 🔄 Migration from File-Based System

### **Session References**  
- World information includes session references like `[S1]`, `[S3]` to track when facts were established
- Your MCP server should maintain this continuity tracking

### **Fact Categories**
- **LOCATIONS**: Geography, settlements, dungeons, points of interest
- **NPCS**: Characters, relationships, current dispositions  
- **FACTIONS**: Organizations, political entities, standings with party
- **PARTY**: Reputation, relationships, how groups view the party
- **LORE**: Historical events, legends, cultural knowledge, religious information
- **OPEN THREADS**: Ongoing quests, unresolved mysteries, future plot hooks

### **Special Markings**
- `(UNVERIFIED)` - Rumors or uncertain information
- `(DEAD)` - Deceased NPCs  
- `(RESOLVED)` - Completed plot threads

---

## 🚀 Next Steps

1. **Dependencies Ready**: Server dependencies are already installed and syntax-checked
2. **Build MCP Server**: Implement the three endpoints above in your preferred MCP framework
3. **Add MCP Client**: When MCP client packages are available, add them to dependencies and replace stubs
4. **Test Integration**: Start with simple world queries to verify connectivity
5. **Data Migration** (if needed): Convert existing `world-state.md` files to your MCP server's data format

### **Testing the Implementation**
- The app will run with stubbed responses until you connect a real MCP server
- Stub responses are clearly marked for easy identification during development
- All existing functionality (session state, rules arbiter, dice rolling) remains unchanged

The frontend continues to work as-is since it receives the same data structure, just sourced from MCP instead of files.