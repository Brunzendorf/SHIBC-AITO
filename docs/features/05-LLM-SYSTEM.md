# LLM System - Detaillierte Feature-Dokumentation

> **Modul:** `src/lib/llm/`
> **Hauptdateien:** `router.ts`, `types.ts`, `claude-provider.ts`, `gemini.ts`, `openai.ts`, `models.ts`, `quota.ts`, `benchmark.ts`
> **Status:** 90% Production-Ready
> **Letzte Überprüfung:** 2025-12-20

---

## Übersicht

Das LLM-System bietet eine einheitliche Abstraktionsschicht für verschiedene LLM-Provider (Claude, Gemini, OpenAI). Es ermöglicht intelligentes Routing basierend auf Task-Kontext, automatisches Fallback bei Fehlern und Quota-Management.

### Architektur

```
┌─────────────────────────────────────────────────────────────────────┐
│                           LLM Router                                 │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │                   Routing Strategien                        │     │
│  │                                                             │     │
│  │  task-type    agent-role    load-balance    gemini-prefer  │     │
│  │     │              │             │               │          │     │
│  │     └──────────────┼─────────────┼───────────────┘          │     │
│  │                    ▼                                        │     │
│  │              Routing Decision                               │     │
│  │          (primary + fallback)                               │     │
│  └────────────────────────────────────────────────────────────┘     │
│                          │                                           │
│         ┌────────────────┼────────────────┐                         │
│         ▼                ▼                ▼                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │   Claude    │  │   Gemini    │  │   OpenAI    │                 │
│  │  Provider   │  │  Provider   │  │   Codex     │                 │
│  │             │  │             │  │  Provider   │                 │
│  │  CLI-based  │  │  CLI-based  │  │  CLI-based  │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
│         │                │                │                         │
│         ▼                ▼                ▼                         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Quota Manager                             │   │
│  │         Token/Session Tracking + Warning System              │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Types (`src/lib/llm/types.ts`)

### LLMProviderType

```typescript
export type LLMProviderType = 'claude' | 'gemini' | 'openai';
```

### LLMSession

Session-Konfiguration für LLM-Aufrufe.

```typescript
export interface LLMSession {
  prompt: string;           // Haupt-Prompt
  systemPrompt?: string;    // System-Instruktionen
  maxTokens?: number;       // Max Output-Tokens
  timeout?: number;         // Timeout in ms
  maxRetries?: number;      // Retry-Anzahl
  mcpConfigPath?: string;   // MCP Config für Claude
  mcpServers?: string[];    // MCP Server für Gemini
  model?: string;           // Model-Override
  enableTools?: boolean;    // CLI Tools (Read/Write/Bash)
}
```

### LLMResult

Ergebnis eines LLM-Aufrufs.

```typescript
export interface LLMResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  retryable?: boolean;      // Transient error?
  retriesUsed?: number;
  provider?: LLMProviderType;
}
```

### TaskContext

Kontext für Routing-Entscheidungen.

```typescript
export interface TaskContext {
  taskType?: 'spawn_worker' | 'operational' | 'propose_decision' |
             'vote' | 'create_task' | 'alert' | 'loop';
  agentType?: string;       // ceo, cmo, cto, etc.
  priority?: 'low' | 'normal' | 'high' | 'critical';
  requiresReasoning?: boolean;
  estimatedComplexity?: 'simple' | 'medium' | 'complex';
}
```

### RoutingStrategy

```typescript
export type RoutingStrategy =
  | 'task-type'      // Route by task complexity
  | 'agent-role'     // Route by agent importance
  | 'load-balance'   // Route by availability
  | 'gemini-prefer'  // Cost optimization
  | 'claude-only';   // Force Claude
```

**Status:** ✅ Vollständig implementiert

---

## 2. LLM Router (`src/lib/llm/router.ts`)

### LLMRouterConfig

```typescript
export interface LLMRouterConfig {
  strategy: RoutingStrategy;
  enableFallback: boolean;
  preferGemini: boolean;
  geminiDefaultModel?: string;
}
```

### Klasse: LLMRouter

#### Constructor

```typescript
constructor(config: LLMRouterConfig = DEFAULT_ROUTER_CONFIG)
```

**Parameter:**
- `config`: Router-Konfiguration (aus Environment)

**Initialisiert:**
- Provider-Map (Claude, Gemini, OpenAI)
- Default-Konfiguration aus `llmConfig`

**Status:** ✅ Vollständig implementiert

---

#### checkAvailability()

```typescript
async checkAvailability(): Promise<Record<LLMProviderType, boolean>>
```

Prüft Verfügbarkeit aller Provider parallel.

**Rückgabe:**
```typescript
{
  claude: true,
  gemini: true,
  openai: false
}
```

**Status:** ✅ Vollständig implementiert

---

#### route()

```typescript
async route(context?: TaskContext): Promise<RoutingDecision>
```

Entscheidet welcher Provider verwendet wird.

**Routing-Logik nach Strategie:**

| Strategie | Logik |
|-----------|-------|
| `task-type` | Simple Tasks → Gemini, Complex → Claude |
| `agent-role` | CEO/DAO/CTO → Claude, Rest → Gemini |
| `load-balance` | Verfügbarkeit prüfen, Standard = Claude |
| `gemini-prefer` | Immer Gemini, außer critical |
| `claude-only` | Immer Claude |

**Task-Type Mapping:**

| Task Type | Primary | Reason |
|-----------|---------|--------|
| `spawn_worker` | Gemini | Simple task |
| `operational` | Gemini | Simple task |
| `create_task` | Gemini | Simple task |
| `alert` | Gemini | Simple task |
| `propose_decision` | Claude | Complex reasoning |
| `vote` | Claude | Critical decision |
| `loop` | Depends | Based on complexity |

**Status:** ✅ Vollständig implementiert

---

#### execute()

```typescript
async execute(session: LLMSession, context?: TaskContext): Promise<LLMResult>
```

Hauptmethode für LLM-Aufrufe mit automatischem Routing und Fallback.

**Ablauf:**
1. Model-Tier basierend auf Task auswählen
2. Provider via Routing wählen
3. Quota prüfen (Fallback bei Erschöpfung)
4. Primary Provider ausführen
5. Usage für Quota-Tracking aufzeichnen
6. Bei Fehler + Fallback enabled: Fallback versuchen

**Beispiel:**
```typescript
const result = await llmRouter.execute(
  {
    prompt: "Analyze this market data...",
    timeout: 60000,
  },
  {
    taskType: 'vote',
    priority: 'critical',
    agentType: 'ceo',
  }
);
```

**Status:** ✅ Vollständig implementiert

---

#### updateConfig()

```typescript
updateConfig(config: Partial<LLMRouterConfig>): void
```

Runtime-Konfigurationsänderung.

**Status:** ✅ Vollständig implementiert

---

## 3. Claude Provider (`src/lib/llm/claude-provider.ts`)

Wrapper um bestehende Claude Code CLI-Funktionen.

### Klasse: ClaudeProvider

```typescript
export class ClaudeProvider implements LLMProvider {
  name: 'claude' = 'claude';

  async isAvailable(): Promise<boolean>;
  async execute(session: LLMSession): Promise<LLMResult>;
  async executeWithRetry(session: LLMSession): Promise<LLMResult>;
}
```

**Implementierung:**
- Delegiert an `src/agents/claude.ts` Funktionen
- Konvertiert zwischen `LLMSession` und `ClaudeSession`
- Fügt `provider: 'claude'` zum Result hinzu

**Besonderheiten:**
- Model-Auswahl nicht via CLI Args möglich
- Nutzt User-Settings für Model
- MCP Config via `--mcp-config` Flag

**Status:** ✅ Vollständig implementiert

---

## 4. Gemini Provider (`src/lib/llm/gemini.ts`)

CLI-basierter Gemini-Provider.

### Retry-Konfiguration

```typescript
export const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 5000,
  maxDelayMs: 60000,
  retryableErrors: [
    'overloaded_error', 'rate_limit', 'timeout',
    '529', '503', '502',
    'resource_exhausted', 'quota_exceeded',
  ],
};
```

### isGeminiAvailable()

```typescript
export async function isGeminiAvailable(
  retries = 3,
  delayMs = 2000
): Promise<boolean>
```

Prüft ob `gemini --version` erfolgreich ist.

**Status:** ✅ Vollständig implementiert

---

### executeGeminiCode()

```typescript
export async function executeGeminiCode(session: LLMSession): Promise<LLMResult>
```

Führt Gemini CLI aus.

**CLI Args:**
```bash
gemini -y -m <model> [--allowed-mcp-server-names ...] "<prompt>"
```

- `-y`: YOLO Mode (auto-approve tools)
- `-m`: Model-Auswahl
- `--allowed-mcp-server-names`: MCP Server

**Besonderheiten:**
- System-Prompt wird Prompt vorangestellt (kein --system-prompt Flag)
- Prompt als letztes positional Argument
- Working Dir: `/app/workspace` oder `process.cwd()`

**Status:** ✅ Vollständig implementiert

---

### executeGeminiCodeWithRetry()

```typescript
export async function executeGeminiCodeWithRetry(
  session: LLMSession
): Promise<LLMResult>
```

Gemini mit Exponential Backoff.

**Retry-Logik:**
- Prüft ob Error retryable ist
- Exponential Backoff mit Jitter
- Max 3 Retries (Default)

**Status:** ✅ Vollständig implementiert

---

### Klasse: GeminiProvider

```typescript
export class GeminiProvider implements LLMProvider {
  name: 'gemini' = 'gemini';

  async isAvailable(): Promise<boolean>;
  async execute(session: LLMSession): Promise<LLMResult>;
  async executeWithRetry(session: LLMSession): Promise<LLMResult>;
}
```

**Status:** ✅ Vollständig implementiert

---

## 5. OpenAI Provider (`src/lib/llm/openai.ts`)

CLI-basierter OpenAI Codex Provider.

### Retry-Konfiguration

```typescript
export const OPENAI_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 5000,
  maxDelayMs: 60000,
  retryableErrors: ['rate_limit', 'timeout', '429', '503', '502', 'overloaded'],
};
```

### executeCodex()

```typescript
export async function executeCodex(session: LLMSession): Promise<LLMResult>
```

Führt Codex CLI aus.

**CLI Args:**
```bash
codex exec --model <model> -- "<prompt>"
```

**Status:** ✅ Vollständig implementiert (aber Codex CLI selten installiert)

---

## 6. Model Selection (`src/lib/llm/models.ts`)

### ModelTier

```typescript
export interface ModelTier {
  complexity: ModelComplexity;      // simple, medium, complex, critical
  geminiModel: string;
  claudeModel?: string;             // Claude CLI nutzt User-Settings
  description: string;
  estimatedCostMultiplier: number;
  estimatedSpeed: 'fastest' | 'fast' | 'medium' | 'slow';
}
```

### MODEL_TIERS

| Tier | Gemini Model | Cost | Speed | Use Case |
|------|--------------|------|-------|----------|
| simple | gemini-2.5-flash-lite | 1x | fastest | spawn_worker, alert |
| medium | gemini-2.5-flash | 1.5x | fast | create_task, loop |
| complex | gemini-2.5-flash | 3x | medium | propose_decision, vote |
| critical | gemini-2.5-pro | 5x | slow | smart_contract |

### TASK_COMPLEXITY_MAP

```typescript
export const TASK_COMPLEXITY_MAP: Record<string, ModelComplexity> = {
  // Simple
  spawn_worker: 'simple',
  operational: 'simple',
  alert: 'simple',

  // Medium
  create_task: 'medium',
  loop: 'medium',

  // Complex
  propose_decision: 'complex',
  vote: 'complex',

  // Critical
  critical_decision: 'critical',
  smart_contract: 'critical',
};
```

### selectModelForTask()

```typescript
export function selectModelForTask(
  taskType?: string,
  priority?: string,
  requiresReasoning?: boolean,
  estimatedComplexity?: ModelComplexity
): ModelTier
```

Wählt Model-Tier basierend auf Kontext.

**Priorität:**
1. Explizite `estimatedComplexity`
2. `priority === 'critical'` → critical Tier
3. `requiresReasoning` → complex Tier
4. Task-Type Mapping
5. Default: medium

**Status:** ✅ Vollständig implementiert

---

## 7. Quota Manager (`src/lib/llm/quota.ts`)

### ProviderQuota

```typescript
export interface ProviderQuota {
  provider: LLMProviderType;

  // Token-based (Gemini)
  totalQuota?: number;
  usedQuota: number;
  remainingQuota?: number;

  // Session-based (Claude Code)
  sessionWindows?: {
    fiveHour: {
      requestsUsed: number;
      maxRequests?: number;
      windowStart: Date;
      windowEnd: Date;
    };
    sevenDay: {
      requestsUsed: number;
      maxRequests?: number;
      windowStart: Date;
      windowEnd: Date;
    };
  };

  resetDate?: Date;
  lastUpdated: Date;
}
```

### UsageStats

```typescript
export interface UsageStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTokensEstimated: number;
  totalDurationMs: number;
  averageDurationMs: number;
}
```

### Klasse: QuotaManager

#### recordUsage()

```typescript
async recordUsage(
  provider: LLMProviderType,
  promptTokens: number,
  completionTokens: number,
  durationMs: number,
  success: boolean
): Promise<void>
```

Zeichnet API-Nutzung auf.

**Speicherung:**
- Redis Key: `llm:quota:<provider>:<YYYY-MM>`
- TTL: 90 Tage
- Claude: Zusätzlich Session-Windows (5h/7d)

**Warnings:**
- 50%: Info
- 80%: Warning
- 95%: Critical

**Status:** ✅ Vollständig implementiert

---

#### getProviderQuota()

```typescript
async getProviderQuota(provider: LLMProviderType): Promise<ProviderQuota | null>
```

Holt Quota-Info für Provider.

**Claude:** Session-Windows (5h/7d Counter)
**Gemini:** Token-basierte Monthly Quota

**Status:** ✅ Vollständig implementiert

---

#### hasAvailableQuota()

```typescript
async hasAvailableQuota(
  provider: LLMProviderType,
  estimatedTokens: number = 1000
): Promise<boolean>
```

Prüft ob genug Quota verfügbar.

**Status:** ✅ Vollständig implementiert

---

#### getUsageComparison()

```typescript
async getUsageComparison(): Promise<{
  claude: UsageStats | null;
  gemini: UsageStats | null;
  openai: UsageStats | null;
  total: { requests: number; tokens: number; avgDuration: number };
}>
```

Vergleicht Nutzung aller Provider.

**Status:** ✅ Vollständig implementiert

---

## 8. Benchmark System (`src/lib/llm/benchmark.ts`)

### BenchmarkCategory

```typescript
export type BenchmarkCategory =
  | 'reasoning'      // Logical puzzles
  | 'coding'         // Code generation
  | 'creative'       // Creative writing
  | 'analysis'       // Data analysis
  | 'factual'        // Knowledge
  | 'conversational' // Natural conversation
  | 'technical'      // Documentation
  | 'multilingual';  // Translation
```

### BenchmarkTask

```typescript
export interface BenchmarkTask {
  id: string;
  category: BenchmarkCategory;
  title: string;
  prompt: string;
  expectedOutputType: 'code' | 'text' | 'structured';
  difficultyLevel: 1 | 2 | 3 | 4 | 5;
}
```

### Standard Benchmark Suite

7 vordefinierte Tasks:

| ID | Category | Difficulty | Title |
|----|----------|------------|-------|
| reasoning-1 | reasoning | 3 | Logical Puzzle |
| reasoning-2 | reasoning | 2 | Math Word Problem |
| coding-1 | coding | 4 | Algorithm Implementation |
| coding-2 | coding | 2 | Bug Fix |
| creative-1 | creative | 3 | Short Story |
| analysis-1 | analysis | 2 | Data Interpretation |
| factual-1 | factual | 2 | Blockchain Knowledge |
| technical-1 | technical | 3 | API Documentation |

### OpusEvaluation

```typescript
export interface OpusEvaluation {
  taskId: string;
  modelName: string;
  scores: {
    accuracy: number;       // 0-100
    coherence: number;      // 0-100
    completeness: number;   // 0-100
    creativity: number;     // 0-100
    efficiency: number;     // 0-100
  };
  overallScore: number;
  feedback: string;
  strengths: string[];
  weaknesses: string[];
}
```

### Klasse: BenchmarkRunner

#### runBenchmark()

```typescript
async runBenchmark(
  models: BenchmarkTest['models'],
  tasks: BenchmarkTask[] = BENCHMARK_TASKS,
  enableTools: boolean = true
): Promise<BenchmarkResult>
```

Führt vollständigen Benchmark durch.

**Ablauf:**
1. Alle Models auf allen Tasks ausführen
2. Responses mit Claude Opus evaluieren (anonymisiert)
3. Leaderboard berechnen
4. In Redis speichern (30 Tage)

**Opus Evaluation:**
- Anonymisierte Responses (kein Model-Name)
- Scoring in 5 Kategorien
- JSON-Output-Format

**Status:** ✅ Vollständig implementiert

---

#### getBenchmarkResult()

```typescript
async getBenchmarkResult(runId: string): Promise<BenchmarkResult | null>
```

Lädt Benchmark-Ergebnis aus Redis.

**Status:** ✅ Vollständig implementiert

---

#### listBenchmarkRuns()

```typescript
async listBenchmarkRuns(): Promise<Array<{ runId: string; timestamp: Date }>>
```

Listet alle gespeicherten Benchmark-Runs.

**Status:** ✅ Vollständig implementiert

---

## Environment Variables

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `LLM_ROUTING_STRATEGY` | `task-type` | Routing-Strategie |
| `LLM_ENABLE_FALLBACK` | `true` | Fallback bei Fehler |
| `LLM_PREFER_GEMINI` | `false` | Cost-Optimierung |
| `GEMINI_DEFAULT_MODEL` | `gemini-2.0-flash-exp` | Standard Gemini Model |
| `GEMINI_MONTHLY_QUOTA` | - | Token-Limit (optional) |
| `CLAUDE_MONTHLY_QUOTA` | - | Token-Limit (optional) |

---

## Bekannte Probleme

| ID | Problem | Priorität | Details |
|----|---------|-----------|---------|
| TASK-027 | Kein echter Token-Count | 🟡 Mittel | Nur Schätzung via char/4 |
| TASK-028 | Claude Model nicht wählbar | 🟡 Mittel | CLI nutzt User-Settings |
| TASK-029 | OpenAI Provider ungetestet | 🟢 Niedrig | Codex CLI selten installiert |
| TASK-030 | Quota-Limits unbekannt | 🟡 Mittel | Claude gibt Max nicht preis |

---

## Verwendungsbeispiele

### Einfacher LLM-Aufruf

```typescript
import { llmRouter } from './lib/llm/index.js';

const result = await llmRouter.execute({
  prompt: "What is the capital of France?",
  timeout: 30000,
});

if (result.success) {
  console.log(result.output);
}
```

### Mit Task-Kontext

```typescript
const result = await llmRouter.execute(
  {
    prompt: "Should we approve this marketing campaign?",
    systemPrompt: "You are the CEO agent...",
  },
  {
    taskType: 'vote',
    agentType: 'ceo',
    priority: 'critical',
    requiresReasoning: true,
  }
);
```

### Direkter Provider-Zugriff

```typescript
import { geminiProvider } from './lib/llm/gemini.js';

const available = await geminiProvider.isAvailable();
if (available) {
  const result = await geminiProvider.executeWithRetry({
    prompt: "Generate a tweet about crypto...",
    model: "gemini-2.5-flash",
  });
}
```

### Quota-Prüfung

```typescript
import { quotaManager } from './lib/llm/quota.js';

// Prüfen ob Quota verfügbar
const hasQuota = await quotaManager.hasAvailableQuota('gemini', 5000);

// Nutzungsvergleich
const comparison = await quotaManager.getUsageComparison();
console.log(`Total requests: ${comparison.total.requests}`);
```

### Benchmark ausführen

```typescript
import { benchmarkRunner, BENCHMARK_TASKS } from './lib/llm/benchmark.js';

const result = await benchmarkRunner.runBenchmark([
  { provider: 'claude', model: 'default', displayName: 'Claude Sonnet' },
  { provider: 'gemini', model: 'gemini-2.5-flash', displayName: 'Gemini Flash' },
]);

console.log('Leaderboard:');
result.leaderboard.forEach((entry, i) => {
  console.log(`${i+1}. ${entry.modelName}: ${entry.averageScore.toFixed(1)}`);
});
```

---

## Singleton Exports

```typescript
// Router
export const llmRouter = new LLMRouter();

// Providers
export const claudeProvider = new ClaudeProvider();
export const geminiProvider = new GeminiProvider();
export const openaiProvider = new OpenAIProvider();

// Managers
export const quotaManager = new QuotaManager();
export const benchmarkRunner = new BenchmarkRunner();
```
