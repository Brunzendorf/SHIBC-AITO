# Deterministic MCP Enforcement System

## Problem

Agents (besonders CMO) erstellen eigene Node.js Scripts statt die vorhandenen MCP Server zu nutzen:

```
/app/workspace/send_christmas_telegram.js     # FALSCH
/app/workspace/generate-diamond-hands.js      # FALSCH
```

**Ursache:** LLMs sind kreativ und umgehen Anweisungen, selbst wenn "MANDATORY" in der Dokumentation steht.

## Lösung: Technische Enforcement statt Dokumentation

### 1. File Write Blocking

**Blockiere alle ausführbaren Dateien im Workspace:**

```typescript
const FORBIDDEN_FILE_PATTERNS = [
  /\.js$/,   // Node scripts
  /\.ts$/,   // TypeScript
  /\.sh$/,   // Shell scripts
  /\.py$/,   // Python
];
```

**Bei Versuch zu schreiben:**
```
❌ BLOCKED: Cannot create executable script
   File: send_telegram.js
   Reason: Telegram operations require spawn_worker with "telegram" MCP
   Correct: {"actions":[{"type":"spawn_worker","task":"Send to Telegram...","servers":["telegram"]}]}
```

### 2. Operation → MCP Mapping

Deterministisches Routing basierend auf Task-Inhalt:

| Operation Pattern | Required MCP | Example Task |
|-------------------|--------------|--------------|
| `telegram`, `sendMessage`, `chat_id` | `telegram` | "Send message to channel -100..." |
| `generate image`, `imagen`, `banner` | `imagen` | "Generate Christmas banner..." |
| `fetch`, `http request`, `api call` | `fetch` | "Fetch price from CoinGecko" |
| `etherscan`, `token balance` | `etherscan` | "Check SHIBC holder count" |

### 3. Enforcement Points

#### A) Pre-Execution Validation (daemon.ts)

```typescript
// Vor spawn_worker Ausführung
const validation = validateSpawnWorker(task, servers);
if (!validation.valid) {
  logger.error({
    task,
    servers,
    requiredMcp: validation.requiredMcp,
  }, 'spawn_worker missing required MCP');

  // Auto-correct: Add missing MCP
  servers.push(validation.requiredMcp);
}
```

#### B) Workspace Write Hook

```typescript
// Bei jedem File Write in workspace
const check = shouldBlockFileWrite(filepath, content);
if (check.blocked) {
  throw new Error(`
    ❌ FILE WRITE BLOCKED
    File: ${filepath}
    Reason: ${check.reason}

    ✅ CORRECT APPROACH:
    ${check.suggestedAction}
  `);
}
```

#### C) Claude Code Hooks (CLAUDE.md restrictions)

```markdown
## BLOCKED OPERATIONS

You CANNOT create these files in workspace:
- *.js, *.ts, *.sh, *.py (executable scripts)
- Any file containing: telegram api, http requests, image generation code

For these operations, you MUST use:
{"actions":[{"type":"spawn_worker","task":"...","servers":["mcp-name"]}]}
```

### 4. Pre-Defined Action Templates

Statt freier JSON-Formulierung, vordefinierte Templates:

```typescript
// Telegram Message
ACTION_TEMPLATES.sendTelegramMessage(
  "-1002876952840",
  "Merry Christmas from SHIBC!"
)
// → {"type":"spawn_worker","task":"Send message to Telegram channel -1002876952840: Merry Christmas from SHIBC!","servers":["telegram"]}

// Image Generation
ACTION_TEMPLATES.generateImage(
  "Christmas banner, golden-orange gradient, Shiba dog",
  "/app/workspace/images/christmas-2025.png",
  "gemini-2.5-flash-image"
)
// → {"type":"spawn_worker","task":"Generate image: Christmas banner...","servers":["imagen","filesystem"]}
```

### 5. Audit Logging

Alle Enforcement-Aktionen werden geloggt:

```json
{
  "level": "warn",
  "component": "mcp-enforcement",
  "agentType": "cmo",
  "action": "blocked",
  "originalAction": "Write file: send_telegram.js",
  "reason": "Script creation blocked",
  "suggestedAction": "Use spawn_worker with telegram MCP"
}
```

## Implementation Checklist

- [x] `.claude/settings.json` - Claude Code hook configuration
- [x] `.claude/hooks/block-executables.sh` - PreToolUse hook script
- [x] `docker/Dockerfile.agent` - Copy hooks to containers
- [x] `src/lib/mcp-enforcement.ts` - Core enforcement logic
- [ ] `profiles/base.md` - Update with enforcement warnings
- [x] Test: CMO versucht Script zu erstellen → wird blockiert

## Implemented Solution: Claude Code Hooks

### Hook Configuration (`.claude/settings.json`)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/block-executables.sh\""
          }
        ]
      }
    ]
  }
}
```

### How It Works

1. Agent tries to use `Write` tool to create `.js` file
2. **PreToolUse** hook triggers before execution
3. `block-executables.sh` checks file extension
4. If blocked extension → Exit code 2 → Tool call blocked
5. Error message fed back to Claude with correct approach

## Migration

### Existing Scripts aufräumen

```bash
# Alle Agent-erstellten Scripts im Workspace löschen
docker exec aito-cmo sh -c "find /app/workspace -name '*.js' -user agent -delete"
docker exec aito-cmo sh -c "find /app/workspace -name '*.sh' -user agent -delete"
```

### Agents neu starten

```bash
docker compose --profile agents restart
```

## Erwartetes Verhalten nach Implementation

**Vorher (CMO kreativ):**
```
Agent: "I'll write a Node.js script to send Telegram messages..."
→ Creates send_telegram.js
→ Script sits in workspace, never executed
→ Message never sent
```

**Nachher (deterministisch):**
```
Agent: "I need to send a Telegram message..."
→ Tries to write send_telegram.js
→ ❌ BLOCKED: "Use spawn_worker with telegram MCP"
→ Agent outputs correct action:
   {"actions":[{"type":"spawn_worker","task":"Send to Telegram...","servers":["telegram"]}]}
→ Worker executes with MCP
→ Message sent ✅
```
