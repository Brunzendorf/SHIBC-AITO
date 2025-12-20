# Agent System - Detaillierte Feature-Dokumentation

> **Module:** `src/agents/`
> **Hauptdateien:** `daemon.ts`, `claude.ts`, `profile.ts`, `state.ts`, `workspace.ts`, `initiative.ts`
> **Status:** ✅ 90% Production-Ready
> **Letzte Überprüfung:** 2025-12-20

---

## Übersicht

Das Agent-System ist das Herzstück von AITO. Jeder Agent (CEO, CMO, CTO, etc.) ist ein eigenständiger Prozess, der in einem Docker-Container läuft und periodisch "aufwacht", um Aufgaben zu erledigen.

### Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                     AgentDaemon                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Profile   │  │    State    │  │  Workspace  │         │
│  │   Loader    │  │   Manager   │  │    (Git)    │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│  ┌──────▼────────────────▼────────────────▼──────┐         │
│  │                 Loop Engine                    │         │
│  │  ┌────────────────────────────────────────┐   │         │
│  │  │  1. Load Context (State, RAG, Kanban)  │   │         │
│  │  │  2. Build Prompt                       │   │         │
│  │  │  3. Execute Claude/Gemini              │   │         │
│  │  │  4. Parse Output                       │   │         │
│  │  │  5. Process Actions                    │   │         │
│  │  │  6. Update State                       │   │         │
│  │  │  7. Commit Changes                     │   │         │
│  │  └────────────────────────────────────────┘   │         │
│  └───────────────────────────────────────────────┘         │
│                          │                                  │
│  ┌───────────────────────▼───────────────────────┐         │
│  │              Action Processor                  │         │
│  │  spawn_worker, create_task, propose_decision  │         │
│  │  vote, claim_issue, complete_issue, etc.      │         │
│  └───────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Agent Daemon (`src/agents/daemon.ts`)

### Klasse: `AgentDaemon`

Der Daemon ist der Hauptprozess jedes Agenten. Er läuft 24/7 und triggert AI nur bei Bedarf.

### Konfiguration

```typescript
interface DaemonConfig {
  agentType: AgentType;      // 'ceo' | 'cmo' | 'cto' | etc.
  agentId: string;           // UUID aus DB
  profilePath: string;       // Pfad zur Profil-Datei
  loopInterval: number;      // Sekunden zwischen Loops
  loopEnabled: boolean;      // Loop aktiviert?
  orchestratorUrl: string;   // Orchestrator API URL
}
```

### Lifecycle

#### `constructor(config: DaemonConfig)`
Erstellt eine neue Daemon-Instanz.

**Beispiel:**
```typescript
const daemon = new AgentDaemon({
  agentType: 'cmo',
  agentId: 'auto',  // Wird aus DB geladen
  profilePath: '/profiles/cmo.md',
  loopInterval: 7200,  // 2 Stunden
  loopEnabled: true,
  orchestratorUrl: 'http://orchestrator:8080'
});
```

---

#### `start(): Promise<void>`
Startet den Daemon mit allen Initialisierungen.

**Ablauf:**
```
1. Load Profile (DB-first, dann File-Fallback)
2. Load Agent from DB (get UUID)
3. Initialize State Manager
4. Load Settings from DB (Queue Delays, Task Limits)
5. Initialize Workspace (Git Clone)
6. Check LLM Availability (Claude/Gemini)
7. Subscribe to Redis Events
8. Schedule Loop (Cron)
9. Update Status → 'active'
10. Log Startup Event
11. Run Startup Prompt (optional)
12. Check Pending Tasks (process if any)
```

**Fehlerbehandlung:**
- Bei Fehler: Status → 'error'
- Exception wird nach oben geworfen

**Beispiel:**
```typescript
const daemon = new AgentDaemon(config);
await daemon.start();
// Agent läuft jetzt und reagiert auf Events
```

**Datei:** `daemon.ts:124-198`
**Status:** ✅ Vollständig implementiert

---

#### `stop(): Promise<void>`
Graceful Shutdown des Daemons.

**Ablauf:**
1. Stop Cron Job
2. Unsubscribe from Redis
3. Log Stop Event
4. `isRunning = false`

**Hinweis:** Status wird NICHT auf 'inactive' gesetzt, damit Orchestrator weiß, dass Agent eigentlich laufen sollte.

**Datei:** `daemon.ts:203-230`
**Status:** ✅ Vollständig implementiert

---

### Message Handling

#### Redis Streams Infrastructure (TASK-016)

**Problem:** Pub/Sub ist fire-and-forget - wenn Agent nicht verbunden, geht Message verloren.

**Lösung:** Redis Streams mit Consumer Groups für guaranteed delivery.

**Neue Funktionen in `src/lib/redis.ts`:**

```typescript
// Stream Key Patterns (parallel zu Pub/Sub Channels)
export const streams = {
  broadcast: 'stream:broadcast',
  head: 'stream:head',
  clevel: 'stream:clevel',
  agent: (id: string) => `stream:agent:${id}`,
};

// Publish mit Guarantee
await publishToStream(streams.agent(agentId), message);

// Consumer Group erstellen
await createConsumerGroup(streamKey, groupName, '$');

// Blocking Read mit ACK
const messages = await readFromStream(streamKey, groupName, consumerName);
await acknowledgeMessages(streamKey, groupName, messageIds);
```

**Verfügbare Stream-Funktionen:**
| Funktion | Beschreibung |
|----------|--------------|
| `publishToStream()` | XADD mit MAXLEN |
| `createConsumerGroup()` | XGROUP CREATE mit MKSTREAM |
| `readFromStream()` | XREADGROUP BLOCK |
| `acknowledgeMessages()` | XACK |
| `getPendingMessages()` | XPENDING für Recovery |
| `claimPendingMessages()` | XCLAIM für Dead Consumer |
| `publishWithGuarantee()` | Hybrid: Pub/Sub + Stream |

**Status:** ✅ TASK-016 Phase 1 erledigt (2025-12-20)
**TODO:** Phase 2 - Daemon-Migration zu Consumer Groups

---

#### Distributed Tracing (TASK-033)

**Problem:** Request-Flow durch das System nicht nachvollziehbar, Debugging schwierig.

**Lösung:** Trace ID Propagation mit AsyncLocalStorage.

**Neue Datei: `src/lib/tracing.ts`**

```typescript
import { withTraceAsync, getTraceId, TRACE_HEADER } from '../lib/tracing.js';

// API-Requests automatisch getraced
app.use((req, res, next) => {
  const traceId = req.headers[TRACE_HEADER.toLowerCase()] || generateTraceId();
  res.setHeader(TRACE_HEADER, traceId);
  withTraceAsync(() => next(), { traceId }).catch(next);
});

// Logger-Mixin fügt Trace IDs automatisch hinzu
const baseLogger = pino({
  mixin() {
    return getTraceInfo(); // { traceId, spanId, parentSpanId }
  },
});

// Agent-Messages mit correlationId
const message: AgentMessage = {
  ...
  correlationId: getTraceId(), // Automatisch aus Context
};

// Message-Handler mit Trace Context
await withTraceAsync(
  () => this.handleMessage(parsed, channel),
  { traceId: parsed.correlationId }
);
```

**Verfügbare Funktionen:**
| Funktion | Beschreibung |
|----------|--------------|
| `generateTraceId()` | Generiert 16-Zeichen Trace ID |
| `generateSpanId()` | Generiert 8-Zeichen Span ID |
| `withTrace()` / `withTraceAsync()` | Führt Code in Trace Context aus |
| `createChildSpan()` / `createChildSpanAsync()` | Erstellt Child Span |
| `getTraceId()` / `getSpanId()` | Holt aktuelle IDs |
| `getTraceContext()` | Holt vollen Context |
| `getTraceInfo()` | Logging-freundliches Format |
| `getSpanDuration()` | Berechnet Span-Dauer |

**HTTP Headers für Propagation:**
- `X-Trace-Id` - Request Trace ID
- `X-Span-Id` - Current Span ID
- `X-Parent-Span-Id` - Parent Span ID

**Log-Output mit Trace:**
```json
{
  "level": 30,
  "component": "api",
  "traceId": "abc123def4567890",
  "spanId": "12345678",
  "method": "GET",
  "path": "/agents"
}
```

**Status:** ✅ TASK-033 erledigt (2025-12-20)

---

#### `subscribeToEvents(): Promise<void>`
Abonniert Redis-Channels für den Agent.

**Abonnierte Channels:**
| Channel | Wer hört zu |
|---------|-------------|
| `channel:agent:{agentId}` | Nur dieser Agent |
| `channel:head` | CEO + DAO |
| `channel:clevel` | CMO, CTO, CFO, COO, CCO |
| `channel:broadcast` | Alle Agents |

**Datei:** `daemon.ts:235-260`
**Status:** ✅ Vollständig implementiert

---

#### `handleMessage(message: AgentMessage, channel: string): Promise<void>`
Verarbeitet eingehende Messages.

**Ablauf:**
1. Auto-extract State from worker_result (Preise, Balances, etc.)
2. Check if AI needed via `shouldTriggerAI()`
3. If yes: `runLoop('message', message)`
4. If no: `handleSimpleMessage()`

**Datei:** `daemon.ts:265-283`
**Status:** ✅ Vollständig implementiert

---

#### `shouldTriggerAI(message: AgentMessage): boolean`
Entscheidet ob AI für diese Message benötigt wird.

**AI wird getriggert bei:**
```typescript
const aiRequired = [
  'task',              // Neue Aufgabe
  'decision',          // Decision-Anfrage
  'alert',             // Alert
  'vote',              // Abstimmungs-Anfrage
  'worker_result',     // Worker-Ergebnis
  'pr_approved_by_rag', // RAG-approved PR
  'pr_review_assigned'  // PR zum Review
];
```

**Zusätzlich:**
- `status_request` von CEO → AI
- `priority: high | urgent` → AI

**Datei:** `daemon.ts:396-422`
**Status:** ✅ Vollständig implementiert

---

#### `handleSimpleMessage(message: AgentMessage): Promise<void>`
Verarbeitet einfache Messages ohne AI.

| Message Type | Aktion |
|--------------|--------|
| `status_request` | `sendStatusResponse()` |
| `broadcast` | Log only |
| `task_queued` | Trigger Loop |

**Datei:** `daemon.ts:427-449`
**Status:** ✅ Vollständig implementiert

---

### Loop Execution

#### `runLoop(trigger: string, data?: unknown): Promise<void>`
Die Hauptschleife - hier passiert die eigentliche AI-Arbeit.

**Trigger-Typen:**
| Trigger | Beschreibung |
|---------|--------------|
| `startup` | Beim Start des Agents |
| `startup_queue` | Pending Tasks bei Start |
| `scheduled` | Regulärer Cron-Loop |
| `message` | Durch Message getriggert |
| `task_notification` | Task in Queue |
| `queue_continuation` | Weitere Tasks nach Verarbeitung |

**Ablauf:**
```typescript
async runLoop(trigger: string, data?: unknown): Promise<void> {
  // 1. Prevent concurrent loops
  if (this.loopInProgress) return;
  this.loopInProgress = true;

  try {
    // 2. Increment loop counter
    const loopCount = await state.get('LOOP_COUNT') || 0;
    await state.set('LOOP_COUNT', loopCount + 1);

    // 3. Get current state
    const currentState = await state.getAll();

    // 4. Fetch pending decisions (HEAD agents only)
    let pendingDecisions = [];
    if (profile.codename === 'ceo' || profile.codename === 'dao') {
      pendingDecisions = await decisionRepo.findPending();
    }

    // 5. Fetch pending tasks from queue
    const rawTasks = await redis.lrange(`queue:tasks:${agentType}`, 0, 9);
    let pendingTasks = rawTasks.map(parseTask);

    // 6. Get RAG context
    const ragContext = await rag.search(query, 5);

    // 7. Fetch Kanban issues
    const kanbanIssues = await getKanbanIssuesForAgent(agentType);

    // 8. TASK LIMIT CHECK
    if (kanbanIssues.inProgress.length >= MAX_CONCURRENT_TASKS) {
      pendingTasks = []; // Focus on current work
    }

    // 9. PRIORITY SORTING
    pendingTasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // 10. Build prompts
    const systemPrompt = generateSystemPrompt(profile);
    const loopPrompt = buildLoopPrompt(...);

    // 11. Execute AI
    const result = await llmRouter.execute({ prompt, systemPrompt, ... });

    // 12. Parse output
    const parsed = parseClaudeOutput(result.output);

    // 13. Apply state updates
    for (const [key, value] of parsed.stateUpdates) {
      await state.set(key, value);
    }

    // 14. Send messages
    for (const msg of parsed.messages) {
      await sendMessage(msg.to, msg.content);
    }

    // 15. Process actions
    for (const action of parsed.actions) {
      await processAction(action);
    }

    // 16. Log to history
    await historyRepo.add({ summary: parsed.summary, ... });

    // 17. Commit workspace changes
    if (await workspace.hasUncommittedChanges()) {
      await workspace.commitAndCreatePR(...);
    }

    // 18. Acknowledge processed tasks
    await redis.ltrim(taskQueueKey, pendingTasks.length, -1);

    // 19. Check for more tasks
    const remainingTasks = await redis.lrange(taskQueueKey, 0, 9);
    if (remainingTasks.length > 0) {
      // Schedule continuation with priority-based delay
      setTimeout(() => runLoop('queue_continuation'), getQueueDelay(remainingTasks));
    } else if (trigger === 'scheduled') {
      // Run initiative phase
      await runInitiativePhase(agentType);
    }

  } finally {
    this.loopInProgress = false;
  }
}
```

**Datei:** `daemon.ts:518-971`
**Status:** ✅ Vollständig implementiert

**Bekannte Probleme:**
- ⚠️ Task-Queue Race Condition (TASK-001)
- ⚠️ loopInProgress schützt nicht vollständig (TASK-002)

---

### Priority-based Queue Delays

**Konfiguration (aus DB oder Defaults):**
```typescript
let QUEUE_DELAYS = {
  critical: 0,           // Sofort
  urgent: 5_000,         // 5 Sekunden
  high: 30_000,          // 30 Sekunden
  normal: 120_000,       // 2 Minuten
  low: 300_000,          // 5 Minuten
  operational: 600_000,  // 10 Minuten
};
```

**Funktion:** `getQueueDelay(tasks)`
Gibt Delay basierend auf höchster Priority im Queue zurück.

**Datei:** `daemon.ts:86-96`
**Status:** ✅ Vollständig implementiert

---

### Task Limit Enforcement

**Konfiguration:**
```typescript
let MAX_CONCURRENT_TASKS = 2; // Aus DB geladen
```

**Logik (Zeilen 620-630):**
```typescript
const currentInProgress = kanbanIssues?.inProgress?.length || 0;
if (currentInProgress >= MAX_CONCURRENT_TASKS) {
  logger.info({ currentInProgress, maxAllowed: MAX_CONCURRENT_TASKS },
    'Agent at max capacity - clearing pending tasks');
  pendingTasks = []; // Agent soll aktuelle Arbeit abschließen
}
```

**Datei:** `daemon.ts:620-630`
**Status:** ✅ Vollständig implementiert

---

### State Auto-Extraction

Wenn ein Worker-Result reinkommt, werden automatisch volatile Daten extrahiert.

**Funktion:** `extractAndSaveWorkerState(payload)`

**Extrahierte Patterns:**

| Pattern | Regex | Beispiel |
|---------|-------|----------|
| Preis | `\$?([\d.]+(?:e[+-]?\d+)?)\s*(?:usd)?` | "$0.00001234" |
| Fear & Greed | `(?:index\|score)[:\s]*(\d+)` | "Index: 45" |
| ETH Balance | `([\d,.]+)\s*ETH` | "1.5 ETH" |
| USD Value | `\$([\d,.]+)` | "$15,000" |
| Holder Count | `([\d,]+)\s*(?:holder\|address)` | "5,000 holders" |
| Telegram Members | `([\d,]+)\s*(?:member\|subscriber)` | "10,000 members" |

**Gespeicherte State-Keys:**
- `last_shibc_price`
- `market_data_timestamp`
- `fear_greed_index`
- `market_sentiment`
- `treasury_eth_balance`
- `treasury_total_usd`
- `holder_count_known`
- `telegram_members`

**Datei:** `daemon.ts:289-391`
**Status:** ✅ Vollständig implementiert

---

### Action Processing

#### `processAction(action: { type: string; data?: unknown }): Promise<void>`

**Verfügbare Actions:**

##### `create_task`
Erstellt eine Task für einen anderen Agent.

```typescript
{
  type: 'create_task',
  data: {
    assignTo: 'cmo',           // Agent-Typ
    title: 'Create Twitter Post',
    description: 'Post about new partnership',
    priority: 'high',          // low, normal, high, urgent
    deadline: '2024-01-15'     // Optional
  }
}
```

**Datei:** `daemon.ts:1090-1109`

---

##### `propose_decision`
Schlägt eine formale Entscheidung vor.

```typescript
{
  type: 'propose_decision',
  data: {
    title: 'Partner with Influencer XYZ',
    description: 'Detailed proposal...',
    tier: 'major',             // operational, minor, major, critical
    context: { budget: 5000 },
    options: ['Accept', 'Reject', 'Counter-offer']
  }
}
```

**Tier-Mapping:**
| Tier | Priority | Response Required |
|------|----------|-------------------|
| operational | low | No |
| minor | normal | No (auto-approve) |
| major | high | Yes |
| critical | urgent | Yes |

**Datei:** `daemon.ts:1111-1136`

---

##### `operational`
Führt eine Operation sofort aus (kein Approval nötig).

```typescript
{
  type: 'operational',
  data: {
    title: 'Daily Status Update',
    description: 'Routine metrics collection',
    action: 'fetch_metrics'
  }
}
```

**Datei:** `daemon.ts:1138-1159`

---

##### `vote`
Stimmt über eine Decision ab (nur CEO/DAO).

```typescript
{
  type: 'vote',
  data: {
    decisionId: 'dec-123-456',
    vote: 'approve',           // approve, veto, abstain
    reason: 'Good ROI expected'
  }
}
```

**Datei:** `daemon.ts:1161-1180`

---

##### `alert`
Sendet einen Alert an den Orchestrator.

```typescript
{
  type: 'alert',
  data: {
    alertType: 'security',     // security, performance, budget, etc.
    severity: 'high',          // low, medium, high, critical
    message: 'Unusual transaction detected',
    decisionId: 'dec-123'      // Optional: Related decision
  }
}
```

**Datei:** `daemon.ts:1182-1203`

---

##### `spawn_worker`
Spawnt einen MCP-Worker für externe Tool-Zugriffe.

```typescript
{
  type: 'spawn_worker',
  data: {
    task: 'Fetch current SHIBC price from CoinGecko',
    servers: ['fetch'],
    timeout: 60000,
    context: { currency: 'usd' }
  }
}

// ODER: Claude Agent spawnen
{
  type: 'spawn_worker',
  data: {
    agent: 'issue-creator',    // Agent aus .claude/agents/
    task: 'Create GitHub issue for marketing campaign',
    timeout: 120000
  }
}
```

**Server-Whitelist pro Agent:**
| Agent | Erlaubte Server |
|-------|-----------------|
| CEO | filesystem, fetch |
| DAO | filesystem, etherscan |
| CMO | telegram, fetch, filesystem |
| CTO | directus, filesystem, fetch |
| CFO | etherscan, filesystem |
| COO | telegram, filesystem |
| CCO | filesystem, fetch |

**Datei:** `daemon.ts:1205-1266`

---

##### `create_pr`
Erstellt einen Pull Request für Workspace-Änderungen.

```typescript
{
  type: 'create_pr',
  data: {
    folder: '/app/workspace/cmo/',
    summary: 'Added new marketing content',
    category: 'content'        // status, content, strategic
  }
}
```

**Kategorien:**
| Kategorie | Review-Prozess |
|-----------|----------------|
| `status` | Auto-merge möglich, kein RAG-Review |
| `content` | C-Level Review |
| `strategic` | CEO Review |

**Datei:** `daemon.ts:1268-1349`

---

##### `merge_pr`
Merged einen Pull Request nach Review.

```typescript
{
  type: 'merge_pr',
  data: {
    prNumber: 42,
    category: 'content',
    summary: 'Marketing content approved'
  }
}
```

**Datei:** `daemon.ts:1351-1399`

---

##### `claim_pr`
Claimed einen PR zum Review (first-come-first-served).

```typescript
{
  type: 'claim_pr',
  data: {
    prNumber: 42,
    prUrl: 'https://github.com/...',
    ragScore: 0.85,
    ragFeedback: 'Looks good'
  }
}
```

**Datei:** `daemon.ts:1401-1435`

---

##### `close_pr`
Lehnt einen PR ab mit Feedback.

```typescript
{
  type: 'close_pr',
  data: {
    prNumber: 42,
    reason: 'Content quality insufficient'
  }
}
```

**Datei:** `daemon.ts:1437-1469`

---

##### `request_human_action`
Erstellt ein GitHub Issue für manuelle Aufgaben.

```typescript
{
  type: 'request_human_action',
  data: {
    title: 'API Key Renewal Required',
    description: 'The CoinGecko API key expires in 7 days...',
    urgency: 'high',           // low, medium, high, critical
    blockedInitiatives: ['init-123', 'init-456'],
    category: 'infrastructure'
  }
}
```

**Datei:** `daemon.ts:1471-1519`

---

##### `update_issue`
Fügt einen Kommentar zu einem GitHub Issue hinzu.

```typescript
{
  type: 'update_issue',
  data: {
    issueNumber: 42,
    comment: 'Progress update: 50% completed'
  }
}
```

**Datei:** `daemon.ts:1521-1549`

---

##### `claim_issue`
Claimed ein GitHub Issue (setzt Status auf in-progress).

```typescript
{
  type: 'claim_issue',
  data: {
    issueNumber: 42
  }
}
```

**Logik:**
1. Setzt Label `status:in-progress`
2. Entfernt Label `status:ready`
3. Assigned Agent als Assignee
4. Fügt Kommentar hinzu

**Datei:** `daemon.ts:1551-1583`

---

##### `complete_issue`
Schließt ein Issue ab.

```typescript
{
  type: 'complete_issue',
  data: {
    issueNumber: 42,
    setToReview: true,         // true = status:review, false = status:done
    comment: 'Implementation completed'
  }
}
```

**Datei:** `daemon.ts:1585-1628`

---

##### `propose_initiative`
Agent schlägt eigenständig eine Initiative vor.

```typescript
{
  type: 'propose_initiative',
  data: {
    title: 'Launch Twitter Spaces AMA',
    description: 'Host weekly AMA sessions...',
    priority: 'high',
    revenueImpact: 7,          // 1-10
    effort: 4,                 // 1-10
    tags: ['marketing', 'community']
  }
}
```

**Datei:** `daemon.ts:1630-1689`

---

## 2. Claude Code Wrapper (`src/agents/claude.ts`)

### Zweck
Wrapper für Claude Code CLI-Aufrufe mit Retry-Logik und Output-Parsing.

### Konfiguration

```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  retryableErrors: [
    'overloaded',
    'rate_limit',
    'timeout',
    '503',
    '502',
    '529'
  ]
};
```

### Funktionen

#### `executeClaudeCode(session: ClaudeSession): Promise<ClaudeResult>`
Basis-Ausführung von Claude Code.

**Signatur:**
```typescript
interface ClaudeSession {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  timeout?: number;  // ms
}

interface ClaudeResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}
```

**Implementierung:**
```typescript
// Spawnt: claude --print "${prompt}" --system-prompt "${systemPrompt}"
const child = spawn('claude', args, { timeout });
```

**Datei:** `claude.ts:50-120`
**Status:** ✅ Vollständig implementiert

---

#### `executeClaudeCodeWithRetry(session): Promise<ClaudeResult>`
Mit exponential Backoff bei Fehlern.

**Retry-Logik:**
```typescript
function calculateBackoffDelay(attempt: number): number {
  const baseDelay = RETRY_CONFIG.initialDelayMs;
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(exponentialDelay + jitter, RETRY_CONFIG.maxDelayMs);
}

function isRetryableError(error: string): boolean {
  return RETRY_CONFIG.retryableErrors.some(e =>
    error.toLowerCase().includes(e)
  );
}
```

**Datei:** `claude.ts:122-180`
**Status:** ✅ Vollständig implementiert

---

#### `executeClaudeCodeWithMCP(session, mcpServers): Promise<ClaudeResult>`
Mit nativen MCP-Servern.

**Beispiel:**
```typescript
const result = await executeClaudeCodeWithMCP({
  prompt: 'Fetch SHIBC price',
  systemPrompt: 'You are a data fetcher...'
}, ['fetch', 'filesystem']);
```

**Datei:** `claude.ts:182-240`
**Status:** ✅ Vollständig implementiert

---

#### `executeClaudeAgent(config): Promise<ClaudeResult>`
Führt einen benannten Agent aus `.claude/agents/` aus.

**Signatur:**
```typescript
interface AgentConfig {
  agent: string;     // Agent-Name (z.B. 'issue-creator')
  prompt: string;    // Task-Beschreibung
  timeout?: number;
}
```

**Beispiel:**
```typescript
const result = await executeClaudeAgent({
  agent: 'pr-creator',
  prompt: 'Create PR for marketing content changes',
  timeout: 120000
});
```

**Datei:** `claude.ts:242-290`
**Status:** ✅ Vollständig implementiert

---

#### `executeOllamaFallback(prompt): Promise<ClaudeResult>`
Fallback zu Ollama wenn Claude nicht verfügbar.

**Verwendet:** `llama3.2:3b` Modell

**Datei:** `claude.ts:292-340`
**Status:** ✅ Vollständig implementiert

---

#### `getKanbanIssuesForAgent(agentType): Promise<AgentKanbanState>`
Holt Kanban-Issues für einen Agent aus Redis-Cache.

**Rückgabe:**
```typescript
interface AgentKanbanState {
  inProgress: KanbanIssue[];  // status:in-progress + agent:cmo
  ready: KanbanIssue[];       // status:ready + agent:cmo
  review: KanbanIssue[];      // status:review
  blocked: KanbanIssue[];     // status:blocked
}
```

**Datei:** `claude.ts:342-400`
**Status:** ✅ Vollständig implementiert

---

#### `buildLoopPrompt(...): string`
Baut den komplexen Loop-Prompt zusammen.

**Enthaltene Sektionen:**
1. Aktuelles Datum/Zeit (UTC)
2. Agent-Name & Trigger-Info
3. Current State (JSON)
4. Pending Decisions (für CEO/DAO)
5. Pending Tasks (mit Priority-Icons)
6. RAG-Kontext
7. Kanban-Issues mit Actions
8. Data-Fetching-Richtlinien
9. Proactive Intelligence Guidance
10. Tool-Availability-Hinweise
11. Decision-Tier-Erklärung
12. Action-Format-Dokumentation

**Datei:** `claude.ts:402-600`
**Status:** ✅ Vollständig implementiert

---

#### `parseClaudeOutput(output): ParsedOutput | null`
Parst JSON aus Claude-Output.

**Erwartetes Format:**
```json
{
  "summary": "What I did this loop",
  "stateUpdates": {
    "CURRENT_FOCUS": "marketing"
  },
  "messages": [
    { "to": "cto", "content": "Please review..." }
  ],
  "actions": [
    { "type": "spawn_worker", "task": "...", "servers": ["fetch"] }
  ]
}
```

**Unterstützte Formate:**
- Raw JSON
- Markdown Code Block (```json ... ```)
- XML-Style (`<json>...</json>`)

**Datei:** `claude.ts:602-680`
**Status:** ✅ Vollständig implementiert

---

## 3. Profile Loader (`src/agents/profile.ts`)

### Zweck
Lädt und parst Agent-Profile aus Datenbank oder Markdown-Dateien.

### Profil-Struktur

```typescript
interface AgentProfile {
  name: string;
  codename: AgentType;
  department: string;
  reportsTo: string;
  manages: string[];
  mission: string;
  responsibilities: string[];
  decisionAuthority: {
    solo: string[];
    ceoApproval: string[];
    daoVote: string[];
  };
  metrics: string[];
  communicationStyle: string;
  principles: string[];
  loopInterval: number;
  startupPrompt?: string;
  rawContent: string;  // Originaler Markdown-Inhalt
}
```

### Funktionen

#### `loadProfile(path, type): Promise<AgentProfile>`
Lädt Profil mit DB-first-Strategie.

**Ablauf:**
1. Versuche Profil aus DB zu laden (`agent_profiles` Tabelle)
2. Fallback: Lade aus Markdown-Datei
3. Merge mit `base.md` wenn vorhanden

**Datei:** `profile.ts:50-100`
**Status:** ✅ Vollständig implementiert

---

#### `loadProfileFromDatabase(type): Promise<AgentProfile | null>`
Lädt aktives Profil aus der Datenbank.

**SQL:**
```sql
SELECT * FROM agent_profiles
WHERE agent_type = $1 AND is_active = true
ORDER BY version DESC
LIMIT 1
```

**Datei:** `profile.ts:102-140`
**Status:** ✅ Vollständig implementiert

---

#### `loadProfileFromFile(path): Promise<AgentProfile>`
Parst Markdown-Profil.

**Markdown-Struktur:**
```markdown
## Identity
**Name:** Chief Marketing Officer (CMO)
**Codename:** cmo
**Department:** Marketing
**Reports To:** CEO
**Manages:** Content Writers, Social Media

## Mission
Drive brand awareness and community growth...

## Core Responsibilities
1. Content Strategy
2. Social Media Management
3. Community Growth

## Decision Authority
### Can Decide Alone (Minor)
- Daily posts
- Content scheduling

### Needs CEO Approval (Major)
- Campaign launches
- Influencer partnerships

### Needs DAO Vote (Critical)
- Major rebrand
- Large budget allocations

## Key Metrics
- Follower growth
- Engagement rate
- Community sentiment

## Communication Style
Professional but approachable...

## Guiding Principles
1. Data-driven decisions
2. Community first

## Loop Schedule
Every 2 hours

## Startup Prompt
Begin by checking social media metrics...
```

**Datei:** `profile.ts:142-250`
**Status:** ✅ Vollständig implementiert

---

#### `generateSystemPrompt(profile): string`
Generiert System-Prompt aus Profil.

**Rückgabe:** Roher Markdown-Content des Profils

**Datei:** `profile.ts:252-260`
**Status:** ✅ Vollständig implementiert

---

## 4. State Management (`src/agents/state.ts`)

### Zweck
Typsicheres State-Management für Agents.

### Funktionen

#### `createStateManager(agentId, agentType): StateManager`
Factory-Funktion für State-Manager.

**Rückgabe:**
```typescript
interface StateManager {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  getAll(): Promise<Record<string, unknown>>;
  clear(): Promise<void>;
}
```

**Datei:** `state.ts:20-80`
**Status:** ✅ Vollständig implementiert

---

### Standard State Keys

```typescript
export const StateKeys = {
  LOOP_COUNT: 'LOOP_COUNT',
  ERROR_COUNT: 'ERROR_COUNT',
  SUCCESS_COUNT: 'SUCCESS_COUNT',
  LAST_LOOP_AT: 'LAST_LOOP_AT',
  LAST_LOOP_RESULT: 'LAST_LOOP_RESULT',
  CURRENT_FOCUS: 'CURRENT_FOCUS',
  PENDING_TASKS: 'PENDING_TASKS',
  COMPLETED_TASKS: 'COMPLETED_TASKS',
  LAST_STATUS_REPORT: 'LAST_STATUS_REPORT',
  UNREAD_MESSAGES: 'UNREAD_MESSAGES',
  CUSTOM_PREFIX: 'custom_'
};
```

---

## 5. Git Workspace (`src/agents/workspace.ts`)

### Zweck
Git-Operationen für Agent-Workspaces.

### Konfiguration

```typescript
const workspaceConfig = {
  repoUrl: process.env.GITHUB_REPO_URL,
  token: process.env.GITHUB_TOKEN,
  basePath: '/app/workspace',
  skipPR: process.env.WORKSPACE_SKIP_PR === 'true',
  autoCommit: process.env.WORKSPACE_AUTO_COMMIT !== 'false'
};
```

### Funktionen

#### `workspace.initialize(agentType): Promise<boolean>`
Initialisiert Workspace (git clone).

**Ablauf:**
1. Check if workspace exists
2. If not: `git clone --filter=blob:none ${repoUrl}`
3. Setup authenticated remote
4. Checkout main branch

**Datei:** `workspace.ts:50-100`
**Status:** ✅ Vollständig implementiert

---

#### `workspace.hasUncommittedChanges(): Promise<boolean>`
Prüft auf uncommitted changes.

**Implementierung:**
```bash
git status --porcelain
```

**Datei:** `workspace.ts:102-115`
**Status:** ✅ Vollständig implementiert

---

#### `workspace.getChangedFiles(): Promise<string[]>`
Listet geänderte Dateien.

**Datei:** `workspace.ts:117-135`
**Status:** ✅ Vollständig implementiert

---

#### `workspace.commitAndCreatePR(agentType, summary, loopNumber, category): Promise<PRResult>`
Erstellt Branch, Commit, Push und PR.

**Ablauf:**
1. Stash uncommitted changes
2. Pull latest main
3. Create feature branch: `{agentType}/loop{loopNumber}`
4. Pop stash
5. Stage all changes
6. Commit with message
7. Push branch
8. Create PR via `pr-creator` agent

**Branch-Naming:** `cmo/loop42`

**PR-Labels:**
- `agent:{agentType}`
- `category:{category}`

**Datei:** `workspace.ts:137-250`
**Status:** ✅ Vollständig implementiert

---

#### `workspace.pullWorkspace(): Promise<PullResult>`
Zieht Änderungen vom Remote mit Konflikt-Erkennung.

**Rückgabe:**
```typescript
interface PullResult {
  success: boolean;
  error?: string;
  conflicted?: boolean;  // Merge-Konflikt erkannt
  aborted?: boolean;     // Rebase/Merge abgebrochen
}
```

**TASK-012 Fix:**
- Erkennt Merge-Konflikte via Error-Message
- Führt automatisch `git rebase --abort` aus
- Fallback zu `git merge --abort`
- Gibt strukturiertes Ergebnis zurück

**Datei:** `workspace.ts:85-140`
**Status:** ✅ TASK-012 erledigt (2025-12-20)

**Bekannte Probleme:**
- ⚠️ Stash-Logik unsicher (TASK-013)

---

#### `workspace.commitAndPushDirect(agentType, summary): Promise<CommitResult>`
Direct-Push ohne PR (wenn `WORKSPACE_SKIP_PR=true`).

**Datei:** `workspace.ts:252-300`
**Status:** ✅ Vollständig implementiert

---

#### `workspace.mergePullRequest(prNumber): Promise<boolean>`
Merged einen PR.

**Implementierung:**
```bash
gh pr merge ${prNumber} --squash --delete-branch
```

**Datei:** `workspace.ts:302-340`
**Status:** ✅ Vollständig implementiert

---

#### `workspace.closePullRequest(prNumber, reason): Promise<boolean>`
Schließt einen PR mit Feedback.

**Implementierung:**
```bash
gh pr close ${prNumber} --comment "${reason}"
```

**Datei:** `workspace.ts:342-380`
**Status:** ✅ Vollständig implementiert

---

## 6. Initiative System (`src/agents/initiative.ts`)

### Zweck
Ermöglicht Agents, proaktiv Initiativen vorzuschlagen.

### Circuit Breaker Protection (TASK-032)

GitHub API-Aufrufe sind mit Circuit Breaker geschützt:

```typescript
import { createCircuitBreaker, GITHUB_OPTIONS } from '../lib/circuit-breaker.js';

const searchIssuesBreaker = createCircuitBreaker(
  'github-search-issues',
  async (query, owner, repo) => {
    const result = await gh.search.issuesAndPullRequests({ q: query });
    return result.data.items;
  },
  GITHUB_OPTIONS,
  () => []  // Fallback: leeres Array
);
```

**Geschützte Funktionen:**
- `searchIssuesBreaker` - GitHub Issue-Suche
- `listIssuesBreaker` - Issue-Listen abrufen
- `createIssueBreaker` - Issues erstellen

**Verhalten bei offenem Circuit:**
- Fallback: Leere Arrays zurückgeben
- Logging: "Circuit breaker call rejected (circuit open)"
- Reset nach 60 Sekunden (GITHUB_OPTIONS.resetTimeout)

**Status:** ✅ TASK-032 erledigt (2025-12-20)

### Funktionen

#### `runInitiativePhase(agentType): Promise<InitiativeResult>`
Führt die Initiative-Phase aus.

**Ablauf:**
1. Check Cooldown (4h default)
2. Check Daily Limit (3/day default)
3. Get bootstrap initiatives for agent type
4. Check for duplicates via Jaccard similarity
5. Create GitHub issue
6. Update Redis cache

**Rückgabe:**
```typescript
interface InitiativeResult {
  created: boolean;
  initiative?: Initiative;
  issueUrl?: string;
  needsAIGeneration?: boolean;
}
```

**Datei:** `initiative.ts:50-150`
**Status:** ✅ Vollständig implementiert

---

#### `createInitiativeFromProposal(agentType, proposal): Promise<InitiativeResult>`
Erstellt Initiative aus Agent-Vorschlag.

**Signatur:**
```typescript
interface InitiativeProposal {
  title: string;
  description: string;
  priority: string;
  revenueImpact: number;  // 1-10
  effort: number;         // 1-10
  tags: string[];
}
```

**Datei:** `initiative.ts:152-220`
**Status:** ✅ Vollständig implementiert

---

#### `wasInitiativeCreated(initiative): Promise<boolean>`
Prüft auf Duplikate via Jaccard Similarity.

**Algorithmus:**
```typescript
function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().match(/[a-z0-9]+/g) || []);
  const wordsB = new Set(b.toLowerCase().match(/[a-z0-9]+/g) || []);

  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

// Threshold: 0.8 (80% similar = duplicate)
```

**Zusätzlich:** GitHub Issue-Suche via API

**Datei:** `initiative.ts:300-400`
**Status:** ✅ Vollständig implementiert

**Bekannte Probleme:**
- ⚠️ Hash-Kollision möglich (TASK-008)
- ⚠️ GitHub API Error zu permissiv (TASK-009)

---

#### `claimIssue(issueNumber, agentType): Promise<boolean>`
Agent claimed ein Issue.

**Aktionen:**
1. Add label `status:in-progress`
2. Remove label `status:ready`
3. Set agent as assignee
4. Add comment

**Datei:** `initiative.ts:420-470`
**Status:** ✅ Vollständig implementiert

---

#### `completeIssue(issueNumber, agentType, setToReview, comment?): Promise<boolean>`
Agent schließt Issue ab.

**Aktionen:**
1. Add label `status:done` oder `status:review`
2. Remove label `status:in-progress`
3. Add completion comment
4. Refresh backlog cache

**Datei:** `initiative.ts:472-530`
**Status:** ✅ Vollständig implementiert

---

#### `updateIssueStatus(issueNumber, newStatus, agentType?): Promise<boolean>`
Ändert Issue-Status.

**Status-Labels:**
- `status:backlog`
- `status:ready`
- `status:in-progress`
- `status:review`
- `status:done`
- `status:blocked`

**Datei:** `initiative.ts:532-600`
**Status:** ✅ Vollständig implementiert

---

## Bekannte Probleme (Agent System)

| ID | Modul | Problem | Priorität |
|----|-------|---------|-----------|
| ~~TASK-001~~ | daemon.ts | ~~Task-Queue Race Condition~~ | ✅ Erledigt |
| TASK-002 | daemon.ts | loopInProgress unvollständig | 🔴 Kritisch |
| ~~TASK-003~~ | daemon.ts | ~~Parser null-check fehlt~~ | ✅ Erledigt |
| TASK-008 | initiative.ts | Hash-Kollision bei Duplikaten | 🟠 Hoch |
| TASK-009 | initiative.ts | GitHub API Error zu permissiv | 🟠 Hoch |
| ~~TASK-012~~ | workspace.ts | ~~Git Merge Conflicts~~ | ✅ Erledigt |
| TASK-013 | workspace.ts | Stash-Logik unsicher | 🟠 Hoch |
| TASK-014 | workspace.ts | Token in URL exposed | ⚠️ Security |
| ~~TASK-032~~ | initiative.ts | ~~Circuit Breaker fehlt~~ | ✅ Erledigt |

---

## Verwendungsbeispiele

### Agent starten
```typescript
import { AgentDaemon, createDaemonConfigFromEnv } from './agents/daemon.js';

const config = createDaemonConfigFromEnv();
const daemon = new AgentDaemon(config);

// Graceful shutdown
process.on('SIGTERM', async () => {
  await daemon.stop();
  process.exit(0);
});

await daemon.start();
```

### Custom Action verarbeiten
```typescript
// In daemon.ts processAction() hinzufügen:
case 'custom_action': {
  const data = actionData as { param1: string; param2: number };
  await doSomethingCustom(data.param1, data.param2);
  logger.info({ param1: data.param1 }, 'Custom action executed');
  break;
}
```

### Initiative vorschlagen
```typescript
// Im Agent-Loop-Prompt:
{
  "actions": [
    {
      "type": "propose_initiative",
      "data": {
        "title": "Launch Twitter Spaces",
        "description": "Weekly AMA sessions to engage community",
        "priority": "high",
        "revenueImpact": 7,
        "effort": 4,
        "tags": ["marketing", "community"]
      }
    }
  ]
}
```
