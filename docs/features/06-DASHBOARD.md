# Dashboard - Detaillierte Feature-Dokumentation

> **Modul:** `dashboard/`
> **Framework:** Next.js 14 (App Router) + Material-UI
> **Hauptdateien:** `lib/api.ts`, `hooks/`, `app/`, `components/`
> **Status:** 85% Production-Ready
> **Letzte Überprüfung:** 2025-12-20

---

## Übersicht

Das Dashboard ist eine Next.js Web-Applikation zur Überwachung und Steuerung des AITO-Systems. Es kommuniziert mit dem Orchestrator via REST API und WebSocket für Real-time Updates.

### Architektur

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Dashboard (Next.js)                          │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                         App Router                             │  │
│  │                                                                │  │
│  │  / (Overview)    /agents     /decisions     /escalations      │  │
│  │  /workers        /domains    /events        /kanban           │  │
│  │  /network        /benchmarks /settings      /messages         │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                          │                                           │
│  ┌───────────────────────┼───────────────────────────────────────┐  │
│  │                       ▼                                        │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐    │  │
│  │  │   Hooks     │  │ Components  │  │      API Client      │    │  │
│  │  │  (SWR)      │  │   (MUI)     │  │    (REST + WS)       │    │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                          │                                           │
│                          ▼                                           │
│              ┌─────────────────────────────┐                        │
│              │    Orchestrator API         │                        │
│              │    http://localhost:8080    │                        │
│              └─────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. API Client (`dashboard/src/lib/api.ts`)

### Basis-Konfiguration

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}
```

### fetchApi()

```typescript
async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<ApiResponse<T>>
```

Generische Fetch-Funktion mit Error-Handling und **Retry-Logic (TASK-027)**.

**Besonderheiten:**
- Unwrapped Orchestrator Response-Format: `{success: true, data: T}`
- Automatische JSON Content-Type Header
- Error-Text aus Response bei Fehler

**Retry-Konfiguration (TASK-027):**
```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};
```

**Retry-Logik:**
- Exponential Backoff mit Jitter (bis 25%)
- Network Errors werden immer retried
- POST/PUT/DELETE nur bei 5xx Errors (idempotenz)
- 401/403 werden nicht retried (Auth-Errors)
- `retried` Counter in Response für Debugging

**Status:** ✅ TASK-027 erledigt (2025-12-20)

---

### Health API

| Funktion | Endpoint | Beschreibung |
|----------|----------|--------------|
| `getHealth()` | `GET /health` | Simple Liveness |
| `getHealthFull()` | `GET /health/full` | Detaillierter Status |

**HealthFull Interface:**
```typescript
interface HealthFull {
  status: string;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    docker: ComponentHealth;
    agents: AgentsHealth;
  };
  uptime: number;
}
```

**Status:** ✅ Vollständig implementiert

---

### Agent API

| Funktion | Endpoint | Beschreibung |
|----------|----------|--------------|
| `getAgents()` | `GET /agents` | Alle Agents |
| `getAgent(type)` | `GET /agents/:type` | Agent-Details |
| `startAgent(type)` | `POST /agents/:type/start` | Agent starten |
| `stopAgent(type)` | `POST /agents/:type/stop` | Agent stoppen |
| `restartAgent(type)` | `POST /agents/:type/restart` | Agent neustarten |
| `sendMessageToAgent()` | `POST /agents/:type/message` | Message senden |

**Agent Interface:**
```typescript
interface Agent {
  id: string;
  type: string;
  name: string;
  status: string;
  profilePath: string;
  loopInterval: number;
  containerId?: string;
  containerStatus?: ContainerStatus | null;
  createdAt: string;
  updatedAt: string;
}
```

**Status:** ✅ Vollständig implementiert

---

### Decision API

| Funktion | Endpoint | Beschreibung |
|----------|----------|--------------|
| `getAllDecisions(limit, offset)` | `GET /decisions` | Alle Decisions |
| `getPendingDecisions()` | `GET /decisions/pending` | Offene Decisions |
| `getEscalatedDecisions()` | `GET /decisions/escalated` | Eskalierte |
| `submitHumanDecision(id, decision)` | `POST /decisions/:id/human-decision` | Human-Entscheidung |

**Decision Interface:**
```typescript
interface Decision {
  id: string;
  title: string;
  description?: string;
  proposedBy: string;
  decisionType: string;
  status: string;
  vetoRound: number;
  ceoVote?: string;
  daoVote?: string;
  cLevelVotes?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
```

**Status:** ✅ Vollständig implementiert

---

### Worker API

| Funktion | Endpoint | Beschreibung |
|----------|----------|--------------|
| `getWorkerExecutions(limit, agent, includeDryRun)` | `GET /workers` | Worker-Logs |
| `getWorkerExecution(taskId)` | `GET /workers/:taskId` | Einzelner Worker |
| `getWorkerStats()` | `GET /workers/stats/summary` | Statistiken |

**WorkerExecution Interface:**
```typescript
interface WorkerExecution {
  timestamp: string;
  taskId: string;
  parentAgent: string;
  servers: string[];
  task?: string;
  toolsUsed?: string[];
  success: boolean;
  duration: number;
  error?: string;
  result?: string;
  dryRun?: boolean;
}
```

**Status:** ✅ Vollständig implementiert

---

### Domain API

| Funktion | Endpoint | Beschreibung |
|----------|----------|--------------|
| `getDomainApprovals(status)` | `GET /domain-approvals` | Alle Requests |
| `getPendingDomainApprovals()` | `GET /domain-approvals?status=pending` | Offene |
| `approveDomainRequest(id)` | `POST /domain-approvals/:id/approve` | Genehmigen |
| `rejectDomainRequest(id)` | `POST /domain-approvals/:id/reject` | Ablehnen |
| `getWhitelist()` | `GET /whitelist` | Whitelist |
| `addToWhitelist(domain, category)` | `POST /whitelist` | Hinzufügen |
| `removeFromWhitelist(domain)` | `DELETE /whitelist/:domain` | Entfernen |

**Status:** ✅ Vollständig implementiert

---

### Kanban API

| Funktion | Endpoint | Beschreibung |
|----------|----------|--------------|
| `getBacklogIssues()` | `GET /backlog/issues` | GitHub Issues |
| `getBacklogStats()` | `GET /backlog/stats` | Statistiken |

**KanbanIssue Interface:**
```typescript
interface KanbanIssue {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  status: 'backlog' | 'ready' | 'in_progress' | 'review' | 'done' | 'blocked';
  priority?: 'critical' | 'high' | 'medium' | 'low';
  effort?: 'xs' | 's' | 'm' | 'l' | 'xl';
  assignee?: string;
  epicNumber?: number;
  isEpic?: boolean;
  html_url?: string;
}
```

**Status:** ✅ Vollständig implementiert

---

### Benchmark API

| Funktion | Endpoint | Beschreibung |
|----------|----------|--------------|
| `getBenchmarkTasks()` | `GET /benchmarks/tasks` | Task-Suite |
| `getBenchmarkRuns(limit)` | `GET /benchmarks/runs` | History |
| `getBenchmarkRun(runId)` | `GET /benchmarks/runs/:runId` | Details |
| `getLatestBenchmark()` | `GET /benchmarks/latest` | Letzter Run |
| `getBenchmarkLeaderboard()` | `GET /benchmarks/leaderboard` | Leaderboard |
| `runBenchmark(request)` | `POST /benchmarks/run` | Neuen Run starten |

**Status:** ✅ Vollständig implementiert

---

### Settings API

| Funktion | Endpoint | Beschreibung |
|----------|----------|--------------|
| `getAllSettings()` | `GET /settings` | Alle Settings |
| `getSettingsByCategory(cat)` | `GET /settings/:category` | Kategorie |
| `updateSetting(cat, key, value)` | `PUT /settings/:category/:key` | Ändern |
| `getQueueDelays()` | `GET /settings/queue/delays` | Queue-Delays |
| `getAgentIntervals()` | `GET /settings/agents/intervals` | Loop-Intervalle |
| `getLLMConfig()` | `GET /settings/llm/config` | LLM-Konfiguration |

**Status:** ✅ Vollständig implementiert

---

### Focus & Initiatives API

| Funktion | Endpoint | Beschreibung |
|----------|----------|--------------|
| `getFocusSettings()` | `GET /focus` | Focus-Parameter |
| `updateFocusSettings(settings)` | `POST /focus` | Focus ändern |
| `getInitiatives()` | `GET /initiatives` | Initiative-Liste |

**FocusSettings Interface:**
```typescript
interface FocusSettings {
  revenueFocus: number;     // 0-100
  communityGrowth: number;  // 0-100
  marketingVsDev: number;   // 0-100
  riskTolerance: number;    // 0-100
  timeHorizon: number;      // 0-100
  updatedAt?: string;
  updatedBy?: string;
}
```

**Status:** ✅ Vollständig implementiert

---

## 2. Hooks

### useApi() - Generischer Hook

```typescript
function useApi<T>(
  endpoint: string | null,
  options?: SWRConfiguration
): SWRResponse<T>
```

Basiert auf SWR für automatisches Caching und Revalidation.

**Default-Optionen:**
```typescript
const defaultOptions: SWRConfiguration = {
  refreshInterval: 5000,      // Auto-refresh alle 5s
  revalidateOnFocus: true,
  dedupingInterval: 2000,
};
```

**Status:** ✅ Vollständig implementiert

---

### useAgents()

```typescript
function useAgents(): SWRResponse<Agent[]>
function useAgent(type: string | null): SWRResponse<AgentDetail>
function useAgentEvents(agentId: string | null, limit?: number): SWRResponse<Event[]>
function useAgentHistory(type: string | null, limit?: number): SWRResponse<AgentHistory[]>
```

**Status:** ✅ Vollständig implementiert

---

### useHealth()

```typescript
function useHealth(): SWRResponse<HealthFull>
```

**Status:** ✅ Vollständig implementiert

---

### useDecisions()

```typescript
function usePendingDecisions(): SWRResponse<Decision[]>
function usePendingEscalations(): SWRResponse<Escalation[]>
```

**Status:** ✅ Vollständig implementiert

---

### useDomains()

```typescript
function usePendingDomainCount(): { count: number }
```

**Status:** ✅ Vollständig implementiert

---

### useWorkers()

```typescript
function useWorkers(limit?: number, agent?: string): SWRResponse<WorkerExecution[]>
function useWorkerStats(): SWRResponse<WorkerStats>
```

**Status:** ✅ Vollständig implementiert

---

### useSettings()

```typescript
function useSettings(): {
  settings: AllSettings | undefined;
  isLoading: boolean;
  isError: boolean;
  refresh: () => void;
}

async function saveSetting(category: string, key: string, value: unknown): Promise<void>
```

**Status:** ✅ Vollständig implementiert

---

### useWebSocket()

```typescript
function useWebSocket(): {
  connected: boolean;
  agents: AgentNode[];
  links: AgentLink[];
  messages: WSMessage[];
}
```

Real-time Updates via WebSocket.

**Message Types:**
| Type | Beschreibung |
|------|--------------|
| `agent_status` | Agent-Status-Änderung |
| `worker_log` | Worker-Aktivität |
| `agent_message` | Inter-Agent-Kommunikation |
| `system_event` | System-Events |

**Reconnection:**
- Automatische Reconnection nach 3s bei Disconnect
- Retry bei Connection-Fehler nach 5s

**Status:** ✅ Vollständig implementiert

---

### useBenchmarks()

```typescript
function useBenchmarks(): SWRResponse<BenchmarkResult[]>
function useLatestBenchmark(): SWRResponse<BenchmarkResult>
```

**Status:** ✅ Vollständig implementiert

---

## 3. Pages (App Router)

### `/` - Overview Dashboard

**Komponenten:**
- `SummaryCards`: Agents, Decisions, Events Counts
- `HealthWidget`: System-Health Überblick
- `RecentActivity`: Letzte Events
- `FocusPanel`: Focus-Slider-Einstellungen
- `InitiativesPanel`: Agent-Initiativen
- `AgentGrid`: Agent-Status Cards

**Status:** ✅ Vollständig implementiert

---

### `/agents` - Agent-Übersicht

**Features:**
- Agent-Grid mit Status-Karten
- Start/Stop/Restart Buttons
- Container-Status Anzeige
- Loop-Interval Anzeige

**Status:** ✅ Vollständig implementiert

---

### `/agents/[type]` - Agent-Detail

**Features:**
- Agent-State Anzeige
- History-Timeline
- Events-Liste
- Container-Logs (geplant)

**Status:** ⚠️ 80% - Logs fehlen

---

### `/messages` - Human-to-Agent Messaging

**Features:**
- Agent-Auswahl Dropdown
- Nachricht mit Priorität senden
- Broadcast an alle Agents
- Message-History

**Status:** ✅ Vollständig implementiert

---

### `/workers` - Worker-Logs

**Features:**
- Ausführungs-History
- Filter nach Agent
- DryRun-Filter Toggle
- Server-Usage Statistiken
- Duration Tracking

**Status:** ✅ Vollständig implementiert

---

### `/decisions` - Decision-Management

**Features:**
- Pending Decisions Liste
- Vote-Status Anzeige
- Human-Decision Submit
- Decision-History

**Status:** ✅ Vollständig implementiert

---

### `/escalations` - Human Escalations

**Features:**
- Eskalierte Decisions
- Response-Formular
- Escalation-History

**Status:** ✅ Vollständig implementiert

---

### `/events` - Event-Log

**Features:**
- System-Events Liste
- Filter nach Type
- Auto-Refresh

**Status:** ✅ Vollständig implementiert

---

### `/domains` - Domain Whitelist

**Features:**
- Pending Approval Requests
- Approve/Reject Actions
- Whitelist Management
- Category Filter
- Domain hinzufügen/entfernen

**Status:** ✅ Vollständig implementiert

---

### `/kanban` - GitHub Kanban Board

**Features:**
- 6 Spalten (Backlog, Ready, In Progress, Review, Done, Blocked)
- Priority-Farbcodierung
- Effort-Badges
- Agent-Zuordnung
- Epic-Highlighting
- Direkt-Links zu GitHub Issues

**Spalten-Konfiguration:**
```typescript
const COLUMNS = [
  { id: 'backlog', label: 'Backlog', color: '#666666' },
  { id: 'ready', label: 'Ready', color: '#0E8A16' },
  { id: 'in_progress', label: 'In Progress', color: '#FFA500' },
  { id: 'review', label: 'Review', color: '#1D76DB' },
  { id: 'done', label: 'Done', color: '#2ECC71' },
  { id: 'blocked', label: 'Blocked', color: '#D93F0B' },
];
```

**Status:** ✅ Vollständig implementiert

---

### `/network` - Agent Network Visualisierung

**Features:**
- Real-time Agent-Status via WebSocket
- Kommunikationslinien zwischen Agents
- Status-Farbcodierung (active/inactive/busy/error)
- Message-Flow Animation

**Status:** ✅ Vollständig implementiert

---

### `/benchmarks` - LLM Benchmark Dashboard

**Features:**
- Leaderboard Anzeige
- Run-History
- Category-Scores
- Response-Details mit Opus-Evaluation
- Neuen Benchmark starten

**Status:** ✅ Vollständig implementiert

---

### `/settings` - System-Einstellungen

**Kategorien:**

| Tab | Beschreibung |
|-----|--------------|
| Queue Delays | Priority-basierte Task-Delays |
| Agent Intervals | Loop-Intervalle pro Agent |
| LLM Routing | Routing-Strategie, Fallback, Gemini-Preference |
| Feedback | Notification-Settings |
| Initiative | Cooldown, Max per Day |

**Features:**
- Tab-basierte Navigation
- Live-Preview von Werten
- Einzelne Settings speichern
- "Save All" pro Kategorie
- Success/Error Snackbar

**Status:** ✅ Vollständig implementiert

---

## 4. Layout & Navigation

### DashboardLayout

```typescript
function DashboardLayout({ children }: { children: ReactNode })
```

**Features:**
- Responsive Sidebar (260px Desktop, Drawer Mobile)
- Navigation mit Badges für Pending Items
- System-Status Anzeige mit Health-Dialog
- Connection-Indicator im AppBar

**Navigation Items:**
| Label | Route | Badge |
|-------|-------|-------|
| Overview | `/` | - |
| Kanban | `/kanban` | - |
| Network | `/network` | - |
| Agents | `/agents` | - |
| Messages | `/messages` | - |
| Workers | `/workers` | - |
| Benchmarks | `/benchmarks` | - |
| Domains | `/domains` | Pending Count |
| Decisions | `/decisions` | Pending Count |
| Escalations | `/escalations` | Pending Count |
| Events | `/events` | - |
| Settings | `/settings` | - |

**Status:** ✅ Vollständig implementiert

---

## 5. Common Components

### Loading

```typescript
function Loading(): JSX.Element
```

Zentrierter CircularProgress Spinner.

**Status:** ✅ Vollständig implementiert

---

### ErrorDisplay

```typescript
function ErrorDisplay({ error }: { error: string }): JSX.Element
```

Alert mit Error-Message und optionalem Retry-Button.

**Status:** ✅ Vollständig implementiert

---

### ErrorBoundary (TASK-027)

```typescript
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState>
```

React Error Boundary um Component-Errors abzufangen.

**Props:**
```typescript
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;       // Custom Fallback-UI
  onError?: (error, info) => void;  // Error-Callback
}
```

**Features:**
- Fängt JavaScript-Errors in Child-Components
- Zeigt Retry-Button zum Reset
- Zeigt Error-Details im Development-Mode
- Collapsible Stack-Trace Anzeige
- HOC verfügbar: `withErrorBoundary(Component)`

**Integration:**
- Umschließt `children` in `DashboardLayout.tsx`
- Verhindert dass ein Error die ganze Page crasht

**Beispiel:**
```tsx
<ErrorBoundary fallback={<CustomError />}>
  <RiskyComponent />
</ErrorBoundary>

// Oder als HOC:
const SafeComponent = withErrorBoundary(RiskyComponent);
```

**Status:** ✅ TASK-027 erledigt (2025-12-20)

---

### EmptyState

```typescript
function EmptyState({ message }: { message: string }): JSX.Element
```

Placeholder für leere Listen.

**Status:** ✅ Vollständig implementiert

---

## Environment Variables

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` | Orchestrator API URL |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:8080/ws` | WebSocket URL |

---

## Theme

```typescript
// dashboard/src/theme/theme.ts
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#ffd700', // Gold
    },
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
  },
});
```

**Status:** ✅ Vollständig implementiert

---

## Bekannte Probleme

| ID | Problem | Priorität | Details |
|----|---------|-----------|---------|
| TASK-031 | Kein Authentication | 🔴 Kritisch | Dashboard ist öffentlich |
| TASK-032 | Keine Agent-Logs | 🟡 Mittel | Container-Logs nicht abrufbar |
| TASK-033 | Keine Pagination | 🟡 Mittel | Listen laden alles |
| TASK-034 | WS Reconnection UI | 🟢 Niedrig | Kein visuelles Feedback |
| TASK-035 | Mobile Optimierung | 🟢 Niedrig | Einige Komponenten zu breit |

---

## Entwicklung

### Installation

```bash
cd dashboard
npm install
```

### Development Server

```bash
npm run dev
# http://localhost:3000
```

### Build

```bash
npm run build
npm start
```

### Type Check

```bash
npm run typecheck
```

### Lint

```bash
npm run lint
```

---

## Verwendungsbeispiele

### API Call mit Hook

```typescript
import { useAgents } from '@/hooks/useAgents';

function AgentList() {
  const { data: agents, isLoading, error } = useAgents();

  if (isLoading) return <Loading />;
  if (error) return <ErrorDisplay error={error.message} />;

  return (
    <ul>
      {agents?.map(agent => (
        <li key={agent.id}>{agent.name}: {agent.status}</li>
      ))}
    </ul>
  );
}
```

### Direkter API-Aufruf

```typescript
import { sendMessageToAgent } from '@/lib/api';

async function sendMessage() {
  const result = await sendMessageToAgent('ceo', 'Please review the proposal', 'high');
  if (result.error) {
    console.error(result.error);
  } else {
    console.log('Message sent:', result.data);
  }
}
```

### WebSocket Integration

```typescript
import { useWebSocket } from '@/hooks/useWebSocket';

function NetworkView() {
  const { connected, agents, links, messages } = useWebSocket();

  return (
    <div>
      <span>Status: {connected ? 'Connected' : 'Disconnected'}</span>
      <div>Agents: {agents.length}</div>
      <div>Active Links: {links.length}</div>
    </div>
  );
}
```

### Settings ändern

```typescript
import { useSettings, saveSetting } from '@/hooks/useSettings';

function SettingsForm() {
  const { settings, refresh } = useSettings();

  const handleSave = async () => {
    await saveSetting('llm', 'routing_strategy', 'gemini-prefer');
    refresh();
  };

  return (
    <button onClick={handleSave}>
      Switch to Gemini-Prefer
    </button>
  );
}
```
