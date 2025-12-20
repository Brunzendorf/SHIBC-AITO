# Worker System - Detaillierte Feature-Dokumentation

> **Module:** `src/workers/`
> **Hauptdateien:** `worker.ts`, `spawner.ts`, `archive-worker.ts`, `backlog-groomer.ts`
> **Status:** ⚠️ 75% Production-Ready
> **Letzte Überprüfung:** 2025-12-20

---

## Übersicht

Das Worker-System ermöglicht Agents den Zugriff auf externe Tools via MCP (Model Context Protocol). Workers sind kurzlebige Claude Code Sessions, die spezifische Tasks ausführen.

### Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent Daemon                          │
│                                                              │
│  Action: spawn_worker                                        │
│  ├── task: "Fetch SHIBC price"                              │
│  ├── servers: ["fetch"]                                      │
│  └── timeout: 60000                                          │
└─────────────────────────────────┬───────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────┐
│                      Worker Spawner                          │
│                                                              │
│  1. Validate server access                                   │
│  2. Generate dynamic MCP config                              │
│  3. Spawn Claude Code with MCP                               │
│  4. Parse output                                             │
│  5. Publish result to Redis                                  │
└─────────────────────────────────┬───────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────┐
│                      MCP Worker                              │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Claude Code CLI                                     │    │
│  │  + MCP Config (/tmp/mcp-worker-{id}.json)           │    │
│  │  + Domain Whitelist                                  │    │
│  │  + API Knowledge                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│  ┌───────────────────────┼───────────────────────────┐      │
│  │                       │                           │      │
│  ▼                       ▼                           ▼      │
│ [fetch]              [telegram]              [etherscan]    │
│  HTTP                 Bot API                 Blockchain    │
│  Requests             Messages               Data           │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Worker Spawner (`src/workers/spawner.ts`)

### Zweck
Verwaltet das Spawnen und Tracking von MCP-Workern.

### Konfiguration

```typescript
const MAX_CONCURRENT_WORKERS = 3;  // Pro Agent

const SERVER_ACCESS = {
  ceo: ['filesystem', 'fetch'],
  dao: ['filesystem', 'etherscan'],
  cmo: ['telegram', 'fetch', 'filesystem'],
  cto: ['directus', 'filesystem', 'fetch'],
  cfo: ['etherscan', 'filesystem'],
  coo: ['telegram', 'filesystem'],
  cco: ['filesystem', 'fetch']
};
```

### Funktionen

#### `spawnWorker(agentId, agentType, task, servers, context?, timeout?): Promise<WorkerResult>`
Spawnt einen Worker synchron und wartet auf Ergebnis.

**Signatur:**
```typescript
interface WorkerResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  toolCalls?: ToolCall[];
}
```

**Parameter:**
| Name | Typ | Required | Beschreibung |
|------|-----|----------|--------------|
| `agentId` | `string` | ✅ | UUID des aufrufenden Agents |
| `agentType` | `AgentType` | ✅ | Typ für Server-Whitelist |
| `task` | `string` | ✅ | Task-Beschreibung |
| `servers` | `string[]` | ✅ | Benötigte MCP-Server |
| `context` | `object` | ❌ | Zusätzlicher Kontext |
| `timeout` | `number` | ❌ | Timeout in ms (default: 60000) |

**Ablauf:**
```typescript
async function spawnWorker(...): Promise<WorkerResult> {
  // 1. Validate server access
  const validServers = validateServerAccess(agentType, servers);
  if (validServers.length === 0) {
    return { success: false, error: 'No valid servers' };
  }

  // 2. Check concurrent limit
  const activeCount = getActiveWorkerCount(agentId);
  if (activeCount >= MAX_CONCURRENT_WORKERS) {
    return { success: false, error: 'Max concurrent workers reached' };
  }

  // 3. Execute worker
  const result = await executeWorker({
    taskId: crypto.randomUUID(),
    parentAgent: agentId,
    task,
    servers: validServers,
    context,
    timeout
  });

  return result;
}
```

**Datei:** `spawner.ts:30-100`
**Status:** ✅ Vollständig implementiert

---

#### `spawnWorkerAsync(agentId, agentType, task, servers, context?, timeout?): Promise<void>`
Spawnt Worker im Hintergrund und publiziert Ergebnis zu Redis.

**Unterschied zu `spawnWorker`:**
- Wartet nicht auf Ergebnis
- Publiziert Ergebnis zu `channel:agent:{agentId}`
- Daemon empfängt als `worker_result` Message

**Ablauf:**
```typescript
async function spawnWorkerAsync(...): Promise<void> {
  // Fire and forget
  spawnWorker(agentId, agentType, task, servers, context, timeout)
    .then(async (result) => {
      // Publish result to agent channel
      const message = {
        type: 'worker_result',
        payload: {
          taskId,
          success: result.success,
          result: result.output,
          error: result.error,
          duration: result.duration
        }
      };
      await publisher.publish(
        channels.agent(agentId),
        JSON.stringify(message)
      );
    })
    .catch((error) => {
      logger.error({ error, agentId, task }, 'Worker failed');
    });
}
```

**Datei:** `spawner.ts:102-150`
**Status:** ✅ Vollständig implementiert

---

#### `validateServerAccess(agentType, requestedServers): string[]`
Prüft welche Server für den Agent erlaubt sind.

**Signatur:**
```typescript
function validateServerAccess(
  agentType: AgentType,
  requestedServers: string[]
): string[]
```

**Beispiel:**
```typescript
validateServerAccess('cmo', ['fetch', 'telegram', 'etherscan'])
// Returns: ['fetch', 'telegram']  (etherscan nicht erlaubt für CMO)
```

**Datei:** `spawner.ts:152-180`
**Status:** ✅ Vollständig implementiert

---

#### `getActiveWorkerCount(agentId): number`
Zählt aktive Worker eines Agents.

**Implementierung:**
- In-Memory Counter
- Increment bei Start, Decrement bei Ende
- Timeout-basierter Cleanup

**Datei:** `spawner.ts:182-200`
**Status:** ✅ Vollständig implementiert

---

## 2. MCP Worker (`src/workers/worker.ts`)

### Zweck
Führt die eigentliche Worker-Task aus via Claude Code mit MCP.

### Konfiguration

```typescript
// MCP Server Basis-Config
const MCP_CONFIG_PATH = process.env.MCP_CONFIG_PATH ||
  '/app/.claude/mcp_servers.json';

// DRY-RUN Mode
const DRY_RUN = process.env.DRY_RUN === 'true';
```

### Funktionen

#### `executeWorker(task: WorkerTask): Promise<WorkerResult>`
Hauptfunktion für Worker-Execution.

**Signatur:**
```typescript
interface WorkerTask {
  taskId: string;
  parentAgent: string;
  task: string;
  servers: string[];
  context?: Record<string, unknown>;
  timeout?: number;
}
```

**Ablauf:**
```typescript
async function executeWorker(task: WorkerTask): Promise<WorkerResult> {
  const startTime = Date.now();

  try {
    // 1. Generate dynamic MCP config
    const mcpConfig = await generateDynamicMCPConfig(task.servers);
    const configPath = `/tmp/mcp-worker-${task.taskId}.json`;
    await fs.writeFile(configPath, JSON.stringify(mcpConfig));

    // 2. Build prompt with domain whitelist
    const whitelist = await getWhitelistForPromptAsync();
    const apiKnowledge = await getAPIsForTask(task.task);

    const prompt = buildWorkerPrompt(task, whitelist, apiKnowledge);

    // 3. Add DRY-RUN instructions if enabled
    if (DRY_RUN) {
      prompt += getDryRunInstructions();
    }

    // 4. Execute Claude Code with MCP
    const result = await executeClaudeCodeWithMCP({
      prompt,
      timeout: task.timeout || 60000
    }, configPath);

    // 5. Parse output
    const parsed = parseWorkerOutput(result.output);

    // 6. Log tool calls for dashboard
    if (parsed.toolCalls) {
      await logToolCalls(task.parentAgent, parsed.toolCalls);
    }

    // 7. Cleanup config file
    await fs.unlink(configPath);

    return {
      success: parsed.success,
      output: parsed.result,
      error: parsed.error,
      duration: Date.now() - startTime,
      toolCalls: parsed.toolCalls
    };

  } catch (error) {
    // Handle domain blocked errors
    if (error.message?.includes('domain not whitelisted')) {
      const blockedUrl = extractBlockedUrl(error.message);
      await createDomainApprovalRequest(blockedUrl, task);
    }

    return {
      success: false,
      error: error.message,
      duration: Date.now() - startTime
    };
  }
}
```

**Datei:** `worker.ts:50-180`
**Status:** ✅ Vollständig implementiert

**Bekannte Probleme:**
- ⚠️ Domain-Whitelist-Enforcement zu schwach (TASK-018)
- ⚠️ Kein Timeout-Enforcement (TASK-020)

---

#### `generateDynamicMCPConfig(servers): Promise<MCPConfig>`
Generiert MCP-Config für die angeforderten Server.

**Signatur:**
```typescript
interface MCPConfig {
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>;
}
```

**Beispiel:**
```typescript
await generateDynamicMCPConfig(['fetch', 'telegram'])
// Returns:
{
  mcpServers: {
    fetch: {
      command: 'npx',
      args: ['-y', '@anthropic/mcp-fetch']
    },
    telegram: {
      command: 'npx',
      args: ['-y', 'mcp-telegram-server'],
      env: {
        TELEGRAM_BOT_TOKEN: '${TELEGRAM_BOT_TOKEN}'
      }
    }
  }
}
```

**Datei:** `worker.ts:182-250`
**Status:** ✅ Vollständig implementiert

---

#### `loadMCPConfig(): Promise<MCPConfig>`
Lädt Basis-Config aus `.claude/mcp_servers.json`.

**Config-Struktur:**
```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "mcp-telegram-server"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "${TELEGRAM_BOT_TOKEN}"
      }
    },
    "fetch": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-fetch"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-filesystem", "/app/workspace"]
    },
    "etherscan": {
      "command": "npx",
      "args": ["-y", "mcp-etherscan"],
      "env": {
        "ETHERSCAN_API_KEY": "${ETHERSCAN_API_KEY}"
      }
    },
    "directus": {
      "command": "npx",
      "args": ["-y", "mcp-directus"],
      "env": {
        "DIRECTUS_URL": "${DIRECTUS_URL}",
        "DIRECTUS_TOKEN": "${DIRECTUS_TOKEN}"
      }
    }
  }
}
```

**Datei:** `worker.ts:252-290`
**Status:** ✅ Vollständig implementiert

---

#### `getWhitelistForPromptAsync(): Promise<string>`
Generiert Whitelist-Sektion für Worker-Prompt.

**Ausgabe-Format:**
```
## Allowed Domains

You may ONLY access URLs from these whitelisted domains:

### crypto_data
- coingecko.com - CoinGecko API
- coinmarketcap.com - CoinMarketCap

### blockchain
- etherscan.io - Etherscan block explorer
- blockscout.com - Blockscout explorer

### social
- twitter.com - Twitter/X
- telegram.org - Telegram

If you need to access a domain not on this list, use the
request_domain_approval tool.
```

**Datei:** `worker.ts:292-350`
**Status:** ✅ Vollständig implementiert

---

#### `getAPIsForTask(task): Promise<APIKnowledge[]>`
Findet relevante API-Patterns für den Task.

**Signatur:**
```typescript
interface APIKnowledge {
  endpoint: string;
  method: string;
  description: string;
  example: string;
  successPattern: string;
}
```

**Quellen:**
1. RAG-Index (`searchAPIPatterns()`)
2. Statische API-Registry

**Beispiel:**
```typescript
await getAPIsForTask('Fetch SHIBC price from CoinGecko')
// Returns:
[
  {
    endpoint: 'https://api.coingecko.com/api/v3/simple/price',
    method: 'GET',
    description: 'Get current price',
    example: '?ids=shiba-classic&vs_currencies=usd',
    successPattern: '"usd":\\s*([\\d.]+)'
  }
]
```

**Datei:** `worker.ts:352-420`
**Status:** ✅ Vollständig implementiert

---

#### `generateAPIPrompt(apis): string`
Generiert API-Dokumentation für Prompt.

**Ausgabe:**
```
## API Knowledge

Based on previous successful calls, here are relevant API patterns:

### CoinGecko Price API
- Endpoint: https://api.coingecko.com/api/v3/simple/price
- Method: GET
- Parameters: ids=shiba-classic&vs_currencies=usd
- Success pattern: Look for "usd": <number>
```

**Datei:** `worker.ts:422-470`
**Status:** ✅ Vollständig implementiert

---

#### `createDomainApprovalRequest(url, task): Promise<void>`
Erstellt Genehmigungsanfrage für blockierte Domain.

**Ablauf:**
1. Extract domain from URL
2. Check if pending request exists
3. Create new request in `domain_approval_requests` table
4. Log event

**Datei:** `worker.ts:472-520`
**Status:** ✅ Vollständig implementiert

---

#### `extractBlockedUrl(errorMessage): string | null`
Extrahiert URL aus Fehlermeldung.

**Regex:**
```typescript
const urlPattern = /(?:blocked|denied|not allowed).*?(https?:\/\/[^\s"']+)/i;
```

**Datei:** `worker.ts:522-540`
**Status:** ✅ Vollständig implementiert

---

#### `getDryRunInstructions(): string`
Generiert DRY-RUN-Mode-Instruktionen.

**Ausgabe:**
```
## DRY-RUN MODE ACTIVE

IMPORTANT: This is a DRY-RUN execution.

You MUST:
- Read data normally (fetch, get, etc.)
- SIMULATE all write operations
- Log what you WOULD do, but don't actually do it
- Prefix simulated actions with [DRY-RUN]

Examples:
- [DRY-RUN] Would send Telegram message: "Hello"
- [DRY-RUN] Would create file: /path/to/file.txt
```

**Datei:** `worker.ts:542-580`
**Status:** ✅ Vollständig implementiert

**Bekanntes Problem:**
- ⚠️ Nur Text-Instruktion, nicht erzwungen (TASK-019)

---

#### `logToolCalls(agentId, toolCalls): Promise<void>`
Publiziert Tool-Aktivität zu Redis für Dashboard.

**Redis-Channel:** `channel:worker:logs`

**Payload:**
```typescript
{
  agentId: string;
  timestamp: string;
  toolCalls: [
    {
      tool: 'fetch',
      input: { url: 'https://...' },
      output: '...',
      duration: 1234
    }
  ]
}
```

**Datei:** `worker.ts:582-620`
**Status:** ✅ Vollständig implementiert

---

#### `parseWorkerOutput(output): ParsedWorkerOutput`
Parst Worker-Output.

**Signatur:**
```typescript
interface ParsedWorkerOutput {
  success: boolean;
  result: string;
  error?: string;
  toolCalls?: ToolCall[];
}
```

**Parsing-Logik:**
1. Suche nach `<result>...</result>` Tags
2. Oder JSON-Block mit `success` Key
3. Fallback: Ganzer Output als Result

**Datei:** `worker.ts:622-680`
**Status:** ✅ Vollständig implementiert

---

## 3. Archive Worker (`src/workers/archive-worker.ts`)

### Zweck
Intelligente Archivierung von Agent-Outputs. Entscheidet was in RAG indexiert wird.

### Queue

**Redis-Key:** `queue:archive`

**Item-Struktur:**
```typescript
interface ArchiveItem {
  id: string;
  agentType: string;
  agentId: string;
  summary: string;
  timestamp: string;
  loopCount: number;
  actions?: string[];
}
```

### Archive-Aktionen

| Aktion | Beschreibung |
|--------|--------------|
| `DISCARD` | Nicht signifikant, verwerfen |
| `INDEX` | In RAG-Index aufnehmen |
| `UPDATE` | Bestehendes Item aktualisieren |
| `INVALIDATE` | Altes Item als ungültig markieren |
| `CONSOLIDATE` | Mehrere Items zusammenfassen |

### Funktionen

#### `queueForArchive(item): Promise<void>`
Fügt Item zur Archive-Queue hinzu.

**Filter:**
- Summary muss mindestens 50 Zeichen haben
- Leere Summaries werden ignoriert

**Datei:** `archive-worker.ts:30-60`
**Status:** ✅ Vollständig implementiert

---

#### `processArchiveQueue(): Promise<ArchiveStats>`
Verarbeitet Queue in Batches.

**Ablauf:**
```typescript
async function processArchiveQueue(): Promise<ArchiveStats> {
  const stats = { processed: 0, indexed: 0, discarded: 0 };
  const batchSize = 10;

  while (true) {
    const items = await redis.lrange('queue:archive', 0, batchSize - 1);
    if (items.length === 0) break;

    for (const item of items) {
      const parsed = JSON.parse(item);
      const action = determineArchiveAction(parsed);

      switch (action) {
        case 'INDEX':
          await rag.indexDocument({
            content: parsed.summary,
            metadata: {
              agentType: parsed.agentType,
              loopCount: parsed.loopCount,
              actions: parsed.actions
            }
          });
          stats.indexed++;
          break;

        case 'DISCARD':
          stats.discarded++;
          break;

        // ... other actions
      }

      stats.processed++;
    }

    // Remove processed items
    await redis.ltrim('queue:archive', batchSize, -1);
  }

  return stats;
}
```

**Datei:** `archive-worker.ts:62-140`
**Status:** ✅ Vollständig implementiert

---

#### `determineArchiveAction(item): ArchiveAction`
Entscheidet was mit Item passiert.

**Kriterien für INDEX:**
- Summary > 100 Zeichen
- Enthält wichtige Keywords (decision, proposal, initiative)
- Hat Actions (nicht nur Beobachtung)
- LoopCount ist Vielfaches von 10 (periodische Snapshots)

**Kriterien für DISCARD:**
- Summary < 50 Zeichen
- Nur "No action needed" oder ähnlich
- Duplicate (gleicher Hash wie kürzlich indexiert)

**Datei:** `archive-worker.ts:142-200`
**Status:** ✅ Vollständig implementiert

---

#### `getQueueLength(): Promise<number>`
Gibt aktuelle Queue-Länge zurück.

**Datei:** `archive-worker.ts:202-210`
**Status:** ✅ Vollständig implementiert

---

#### `getArchiveStats(): Promise<ArchiveStats>`
Gibt Archivierungs-Statistiken zurück.

**Rückgabe:**
```typescript
interface ArchiveStats {
  queueLength: number;
  totalIndexed: number;
  totalDiscarded: number;
  lastProcessed: string | null;
}
```

**Datei:** `archive-worker.ts:212-240`
**Status:** ✅ Vollständig implementiert

---

#### `runArchiveWorker(): Promise<void>`
Startet den Archive-Worker als Background-Prozess.

**Intervall:** Alle 5 Minuten

**Datei:** `archive-worker.ts:242-270`
**Status:** ✅ Vollständig implementiert

---

## 4. Backlog Groomer (`src/workers/backlog-groomer.ts`)

### Zweck
Automatische Pflege des GitHub Issue-Backlogs.

### Funktionen

#### `runBacklogGrooming(): Promise<GroomingResult>`
Führt Backlog-Grooming durch.

**Aktionen:**
1. **Stale Issues schließen** (>14 Tage ohne Aktivität)
2. **Labels aktualisieren** (Priority-Rebalancing)
3. **Ready-Status promoten** (Backlog → Ready wenn Kriterien erfüllt)
4. **Agent-Assignments vorschlagen**

**Signatur:**
```typescript
interface GroomingResult {
  closedStale: number;
  updatedLabels: number;
  promotedToReady: number;
  suggestedAssignments: Assignment[];
}
```

**Datei:** `backlog-groomer.ts:30-150`
**Status:** ✅ Vollständig implementiert

---

#### `getBacklogStats(): Promise<BacklogStats>`
Gibt Backlog-Statistiken zurück.

**Rückgabe:**
```typescript
interface BacklogStats {
  total: number;
  byStatus: {
    backlog: number;
    ready: number;
    inProgress: number;
    review: number;
    done: number;
    blocked: number;
  };
  byAgent: Record<string, number>;
  staleCount: number;
}
```

**Datei:** `backlog-groomer.ts:152-200`
**Status:** ✅ Vollständig implementiert

---

## Verfügbare MCP-Server

### fetch
HTTP-Requests an whitelistete Domains.

**Tools:**
- `fetch` - HTTP GET/POST/PUT/DELETE

**Beispiel:**
```typescript
{
  type: 'spawn_worker',
  data: {
    task: 'Fetch SHIBC price from CoinGecko API',
    servers: ['fetch']
  }
}
```

### telegram
Telegram Bot API.

**Tools:**
- `sendMessage` - Nachricht senden
- `getUpdates` - Updates abrufen
- `getChatMemberCount` - Member-Count

**Beispiel:**
```typescript
{
  type: 'spawn_worker',
  data: {
    task: 'Post announcement to Telegram channel -1002876952840',
    servers: ['telegram']
  }
}
```

### filesystem
Lokaler Dateizugriff.

**Tools:**
- `readFile` - Datei lesen
- `writeFile` - Datei schreiben
- `listDirectory` - Verzeichnis auflisten

**Einschränkung:** Nur `/app/workspace`

### etherscan
Ethereum-Blockchain-Daten.

**Tools:**
- `getBalance` - Wallet-Balance
- `getTransactions` - Transaktions-History
- `getTokenInfo` - Token-Details

### directus
CMS-Integration.

**Tools:**
- `getItems` - Collection-Items abrufen
- `createItem` - Item erstellen
- `updateItem` - Item aktualisieren

---

## Bekannte Probleme

| ID | Problem | Priorität |
|----|---------|-----------|
| TASK-018 | Domain-Whitelist nur auf Server-Level | 🔴 Kritisch |
| TASK-019 | DRY-RUN nur Text-Instruktion | ⚠️ Security |
| TASK-020 | Kein Timeout-Enforcement | 🟠 Hoch |
| TASK-021 | Config-File I/O bei jedem Call | 🟡 Performance |

---

## Verwendungsbeispiele

### Worker für Preis-Fetch
```typescript
// In Agent-Loop:
{
  "actions": [
    {
      "type": "spawn_worker",
      "task": "Fetch current SHIBC price from CoinGecko. Return the USD price.",
      "servers": ["fetch"],
      "timeout": 30000
    }
  ]
}
```

### Worker für Telegram-Post
```typescript
{
  "actions": [
    {
      "type": "spawn_worker",
      "task": "Send message to Telegram channel -1002876952840: 'New partnership announced!'",
      "servers": ["telegram"],
      "timeout": 60000
    }
  ]
}
```

### Worker für Multi-Server-Task
```typescript
{
  "actions": [
    {
      "type": "spawn_worker",
      "task": "1. Fetch SHIBC price from CoinGecko. 2. Save result to /app/workspace/data/prices.json",
      "servers": ["fetch", "filesystem"],
      "timeout": 60000
    }
  ]
}
```
