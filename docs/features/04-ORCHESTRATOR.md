# Orchestrator - Detaillierte Feature-Dokumentation

> **Modul:** `src/orchestrator/`
> **Hauptdateien:** `api.ts`, `websocket.ts`, `health.ts`, `container.ts`, `scheduler.ts`
> **Status:** ⚠️ 80% Production-Ready
> **Letzte Überprüfung:** 2025-12-20

---

## Übersicht

Der Orchestrator ist der zentrale Kontrollpunkt des AITO-Systems. Er verwaltet Container, bietet die REST-API und koordiniert Events.

### Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                         Orchestrator                         │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    Express.js API                    │    │
│  │                  http://localhost:8080               │    │
│  │                                                      │    │
│  │  /health    /agents    /decisions    /events        │    │
│  │  /tasks     /domains   /settings     /benchmark     │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│  ┌───────────────────────┼───────────────────────────┐      │
│  │                       │                           │      │
│  ▼                       ▼                           ▼      │
│ [Container Mgmt]   [Health Monitor]   [Event Handler]      │
│  Start/Stop         Heartbeats         Redis Pub/Sub       │
│  Docker API         Liveness           Broadcast           │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    Scheduler                         │    │
│  │  Cron Jobs: Archive, Grooming, Health Checks        │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. REST API (`src/orchestrator/api.ts`)

### Server-Konfiguration

```typescript
const app = express();
const PORT = process.env.ORCHESTRATOR_PORT || 8080;

// Middleware
app.use(cors({ origin: '*' }));  // ⚠️ TASK-022: Needs restriction
app.use(express.json());
app.use(requestLogger);          // Duration tracking
app.use(errorHandler);           // JSON error responses
```

### Health Endpoints

#### `GET /health`
Einfacher Liveness-Check.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-20T10:00:00.000Z"
}
```

**Status:** ✅ Vollständig implementiert

---

#### `GET /ready`
Readiness-Check (alle Abhängigkeiten verfügbar).

**Prüft:**
- Database connectivity
- Redis connectivity

**Response:**
```json
{
  "ready": true,
  "checks": {
    "database": "ok",
    "redis": "ok"
  }
}
```

**Status:** ✅ Vollständig implementiert

---

#### `GET /health/full`
Detaillierte System-Health.

**Response:**
```json
{
  "status": "healthy",
  "uptime": 86400,
  "components": {
    "database": {
      "status": "healthy",
      "latency": 5
    },
    "redis": {
      "status": "healthy",
      "latency": 2
    },
    "agents": {
      "ceo": { "status": "active", "lastHeartbeat": "..." },
      "cmo": { "status": "active", "lastHeartbeat": "..." }
    }
  }
}
```

**Status:** ✅ Vollständig implementiert

---

### Agent Management

#### `GET /agents`
Liste aller Agenten mit Status.

**Response:**
```json
{
  "agents": [
    {
      "id": "abc-123",
      "type": "ceo",
      "name": "CEO Agent",
      "status": "active",
      "loopInterval": 1800,
      "lastHeartbeat": "2025-12-20T10:00:00.000Z",
      "containerStatus": "running"
    }
  ]
}
```

**Query-Parameter:**
| Parameter | Typ | Beschreibung |
|-----------|-----|--------------|
| `status` | `string` | Filter nach Status |

**Status:** ✅ Vollständig implementiert

---

#### `GET /agents/:type`
Details eines spezifischen Agenten.

**Parameter:**
| Name | Typ | Beschreibung |
|------|-----|--------------|
| `type` | `AgentType` | ceo, cmo, cto, cfo, coo, cco, dao |

**Response:**
```json
{
  "id": "abc-123",
  "type": "ceo",
  "name": "CEO Agent",
  "status": "active",
  "profilePath": "/profiles/ceo.md",
  "loopInterval": 1800,
  "lastHeartbeat": "2025-12-20T10:00:00.000Z",
  "loopCount": 42,
  "lastLoopAt": "2025-12-20T09:30:00.000Z",
  "currentFocus": "strategic planning",
  "containerStatus": "running",
  "containerId": "aito-ceo-abc123"
}
```

**Status:** ✅ Vollständig implementiert

---

#### `GET /agents/:type/history`
History-Einträge eines Agenten.

**Query-Parameter:**
| Parameter | Typ | Default | Beschreibung |
|-----------|-----|---------|--------------|
| `limit` | `number` | 50 | Max Einträge |

**Response:**
```json
{
  "history": [
    {
      "id": "hist-123",
      "actionType": "decision",
      "summary": "Approved marketing campaign",
      "createdAt": "2025-12-20T09:00:00.000Z"
    }
  ]
}
```

**Status:** ✅ Vollständig implementiert

---

#### `POST /agents/:type/start`
Startet einen Agent-Container.

**Response:**
```json
{
  "success": true,
  "message": "Agent ceo started",
  "containerId": "aito-ceo-abc123"
}
```

**Status:** ✅ Vollständig implementiert

---

#### `POST /agents/:type/stop`
Stoppt einen Agent-Container.

**Response:**
```json
{
  "success": true,
  "message": "Agent ceo stopped"
}
```

**Status:** ✅ Vollständig implementiert

---

#### `POST /agents/:type/restart`
Startet Agent-Container neu.

**Response:**
```json
{
  "success": true,
  "message": "Agent ceo restarted",
  "containerId": "aito-ceo-xyz789"
}
```

**Status:** ✅ Vollständig implementiert

---

### Event Management

#### `GET /events`
Letzte System-Events.

**Query-Parameter:**
| Parameter | Typ | Default | Beschreibung |
|-----------|-----|---------|--------------|
| `limit` | `number` | 100 | Max Einträge |
| `type` | `string` | - | Filter nach Event-Typ |

**Response:**
```json
{
  "events": [
    {
      "id": "evt-123",
      "eventType": "agent_started",
      "sourceAgent": "abc-123",
      "payload": { "agentType": "ceo" },
      "createdAt": "2025-12-20T10:00:00.000Z"
    }
  ]
}
```

**Status:** ✅ Vollständig implementiert

---

#### `GET /agents/:type/events`
Events eines spezifischen Agenten.

**Status:** ✅ Vollständig implementiert

---

### Decision Management

#### `GET /decisions`
Alle Decisions.

**Query-Parameter:**
| Parameter | Typ | Default | Beschreibung |
|-----------|-----|---------|--------------|
| `status` | `string` | - | Filter nach Status |
| `limit` | `number` | 50 | Max Einträge |
| `offset` | `number` | 0 | Pagination Offset |

**Response:**
```json
{
  "decisions": [
    {
      "id": "dec-123",
      "title": "Partner with Influencer",
      "status": "pending",
      "decisionType": "major",
      "proposedBy": "abc-123",
      "ceoVote": null,
      "daoVote": null,
      "createdAt": "2025-12-20T09:00:00.000Z"
    }
  ],
  "total": 15,
  "limit": 50,
  "offset": 0
}
```

**Status:** ✅ Vollständig implementiert

---

#### `GET /decisions/pending`
Nur ausstehende Decisions.

**Status:** ✅ Vollständig implementiert

---

#### `POST /decisions/:id/vote`
Abstimmung auf Decision.

**Body:**
```json
{
  "voterType": "ceo",
  "vote": "approve",
  "reason": "Good ROI expected"
}
```

**Response:**
```json
{
  "success": true,
  "decision": {
    "id": "dec-123",
    "ceoVote": "approve",
    "status": "pending"
  }
}
```

**Status:** ✅ Vollständig implementiert

---

#### `POST /decisions/:id/escalate`
Eskaliert Decision zu Human.

**Body:**
```json
{
  "reason": "CEO and DAO disagree"
}
```

**Status:** ✅ Vollständig implementiert

---

#### `POST /decisions/:id/resolve`
Manuelles Resolve durch Human.

**Body:**
```json
{
  "decision": "approve",
  "reason": "Approved after review"
}
```

**Status:** ✅ Vollständig implementiert

---

### Task Management

#### `GET /tasks`
Alle Tasks.

**Query-Parameter:**
| Parameter | Typ | Beschreibung |
|-----------|-----|--------------|
| `status` | `string` | Filter nach Status |
| `assignedTo` | `string` | Filter nach Agent |

**Status:** ✅ Vollständig implementiert

---

#### `POST /tasks`
Neue Task erstellen.

**Body:**
```json
{
  "title": "Create Twitter Post",
  "description": "Post about new partnership",
  "assignTo": "cmo",
  "priority": "high"
}
```

**Status:** ✅ Vollständig implementiert

---

### Domain Management

#### `GET /domains/whitelist`
Alle whitelisteten Domains.

**Response:**
```json
{
  "domains": [
    {
      "id": "dom-123",
      "domain": "coingecko.com",
      "category": "crypto_data",
      "description": "CoinGecko API",
      "isActive": true
    }
  ]
}
```

**Status:** ✅ Vollständig implementiert

---

#### `POST /domains/whitelist`
Domain hinzufügen.

**Body:**
```json
{
  "domain": "dexscreener.com",
  "category": "crypto_data",
  "description": "DEX analytics"
}
```

**Status:** ✅ Vollständig implementiert

---

#### `DELETE /domains/:domain`
Domain von Whitelist entfernen.

**Status:** ✅ Vollständig implementiert

---

#### `GET /domains/approval-requests`
Ausstehende Domain-Genehmigungen.

**Status:** ✅ Vollständig implementiert

---

#### `POST /domains/approval-requests/:id/approve`
Domain-Anfrage genehmigen.

**Status:** ✅ Vollständig implementiert

---

#### `POST /domains/approval-requests/:id/reject`
Domain-Anfrage ablehnen.

**Status:** ✅ Vollständig implementiert

---

### Settings Management

#### `GET /settings`
Alle System-Settings.

**Response:**
```json
{
  "settings": {
    "queue": {
      "delay_critical": 0,
      "delay_urgent": 5000
    },
    "agents": {
      "loop_interval_ceo": 1800
    },
    "llm": {
      "routing_strategy": "claude-only"
    }
  }
}
```

**Status:** ✅ Vollständig implementiert

---

#### `POST /settings/:category/:key`
Setting setzen.

**Body:**
```json
{
  "value": 1800,
  "description": "CEO loops every 30 minutes"
}
```

**Status:** ✅ Vollständig implementiert

---

### Benchmarking

#### `POST /benchmark/run`
Startet Benchmark-Run.

**Body:**
```json
{
  "models": ["claude-sonnet-4", "gemini-2.5-flash"],
  "tasks": ["text-generation", "code-writing", "reasoning"]
}
```

**Response:**
```json
{
  "runId": "bench-123",
  "status": "running"
}
```

**Status:** ✅ Vollständig implementiert

---

#### `GET /benchmark/runs`
Benchmark-History.

**Status:** ✅ Vollständig implementiert

---

#### `GET /benchmark/runs/:runId`
Benchmark-Run-Details.

**Status:** ✅ Vollständig implementiert

---

## 2. WebSocket Integration (`src/orchestrator/websocket.ts`)

### Zweck
Real-time Updates für Dashboard.

### Events

| Event | Payload | Beschreibung |
|-------|---------|--------------|
| `agent_status` | `{ agentType, status }` | Agent-Status-Änderung |
| `decision_vote` | `{ decisionId, vote }` | Neue Abstimmung |
| `worker_log` | `{ agentId, toolCalls }` | Worker-Aktivität |
| `event` | `Event` | Neues System-Event |

### Subscription

```javascript
const ws = new WebSocket('ws://localhost:8080/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'agent_status':
      updateAgentStatus(data.payload);
      break;
    case 'decision_vote':
      updateDecisionVotes(data.payload);
      break;
  }
};
```

**Status:** ✅ Vollständig implementiert

---

## 3. Health Monitoring (`src/orchestrator/health.ts`)

### Funktionen

#### `getSystemHealth(): Promise<SystemHealth>`
Aggregierte System-Health.

**Rückgabe:**
```typescript
interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    agents: Record<string, AgentHealth>;
  };
}
```

**Status-Bestimmung:**
- `healthy`: Alle Komponenten OK
- `degraded`: Einige Agents nicht erreichbar
- `unhealthy`: Database oder Redis down

**Status:** ✅ Vollständig implementiert

---

#### `isAlive(): boolean`
Einfacher Liveness-Check.

**Status:** ✅ Vollständig implementiert

---

#### `isReady(): Promise<boolean>`
Readiness-Check mit DB/Redis.

**Status:** ✅ Vollständig implementiert

---

## 4. Container Management (`src/orchestrator/container.ts`)

### Funktionen

#### `startAgent(type): Promise<ContainerInfo>`
Startet Agent-Container.

**Implementierung:**
```bash
docker compose up -d ${type}-agent
```

**Status:** ✅ Vollständig implementiert

---

#### `stopAgent(type): Promise<void>`
Stoppt Agent-Container.

**Implementierung:**
```bash
docker compose stop ${type}-agent
```

**Status:** ✅ Vollständig implementiert

---

#### `restartAgent(type): Promise<ContainerInfo>`
Startet Agent-Container neu.

**Status:** ✅ Vollständig implementiert

---

#### `getAgentContainerStatus(type): Promise<ContainerStatus>`
Container-Status abrufen.

**Status:** ✅ Vollständig implementiert

---

#### `listManagedContainers(): Promise<ContainerInfo[]>`
Alle verwalteten Container auflisten.

**Status:** ✅ Vollständig implementiert

---

## 5. Scheduler (`src/orchestrator/scheduler.ts`)

### Geplante Jobs

| Job | Intervall | Beschreibung |
|-----|-----------|--------------|
| `archive-processor` | 5 min | Archive-Queue verarbeiten |
| `backlog-groomer` | 1 h | Backlog aufräumen |
| `rag-refresh` | 30 min | RAG-Index aktualisieren |
| `health-check` | 1 min | Agent-Heartbeats prüfen |

### Funktionen

#### `getScheduledJobs(): ScheduledJob[]`
Alle geplanten Jobs auflisten.

**Status:** ✅ Vollständig implementiert

---

#### `pauseJob(jobId): void`
Job pausieren.

**Status:** ✅ Vollständig implementiert

---

#### `resumeJob(jobId): void`
Job fortsetzen.

**Status:** ✅ Vollständig implementiert

---

## Bekannte Probleme

| ID | Problem | Priorität |
|----|---------|-----------|
| TASK-022 | Keine API Authentication | 🔴 Kritisch |
| TASK-023 | Kein Rate Limiting | 🔴 Kritisch |
| TASK-024 | Keine Request Validation | 🟠 Hoch |
| TASK-025 | Unbounded Queries | 🟡 Mittel |
| TASK-026 | Fehlende Endpoints | 🟡 Mittel |

---

## Verwendungsbeispiele

### Agent starten
```bash
curl -X POST http://localhost:8080/agents/cmo/start
```

### Decision abfragen
```bash
curl http://localhost:8080/decisions/pending
```

### Vote abgeben
```bash
curl -X POST http://localhost:8080/decisions/dec-123/vote \
  -H "Content-Type: application/json" \
  -d '{"voterType": "ceo", "vote": "approve"}'
```

### Settings ändern
```bash
curl -X POST http://localhost:8080/settings/queue/delay_critical \
  -H "Content-Type: application/json" \
  -d '{"value": 0}'
```
