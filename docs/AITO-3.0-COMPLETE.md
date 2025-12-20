# AITO 3.0 - Vollständige Systemdokumentation

> **AI Team Orchestrator** - Autonomes Multi-Agent System für Shiba Classic ($SHIBC)

---

## Inhaltsverzeichnis

1. [Architektur-Übersicht](#1-architektur-übersicht)
2. [Agent System](#2-agent-system)
3. [Worker System](#3-worker-system)
4. [Kommunikation & Events](#4-kommunikation--events)
5. [LLM Integration](#5-llm-integration)
6. [GitHub Integration](#6-github-integration)
7. [RAG System](#7-rag-system)
8. [Dashboard](#8-dashboard)
9. [Datenbank](#9-datenbank)
10. [Konfiguration](#10-konfiguration)
11. [MCP Server](#11-mcp-server)
12. [Bekannte Probleme](#12-bekannte-probleme)
13. [Verbesserungspotential](#13-verbesserungspotential)

---

## 1. Architektur-Übersicht

```
┌─────────────────────────────────────────────────────────────────┐
│                         Dashboard (Next.js)                      │
│                     http://localhost:3000                        │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST API + WebSocket
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Orchestrator (Express)                      │
│                     http://localhost:8080                        │
│  • API Server  • WebSocket  • Scheduler  • Container Manager     │
└────────────────────────────┬────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   PostgreSQL   │    │     Redis      │    │    Qdrant     │
│   (Daten)      │    │   (Pub/Sub)    │    │   (Vektoren)  │
└───────────────┘    └───────────────┘    └───────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Agent Container                          │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │
│  │ CEO │ │ DAO │ │ CMO │ │ CTO │ │ CFO │ │ COO │ │ CCO │       │
│  └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘       │
│     └───────┴───────┴───────┴───────┴───────┴───────┘           │
│                             │                                    │
│                             ▼                                    │
│                      MCP Workers                                 │
│              (Telegram, Filesystem, Fetch, etc.)                 │
└─────────────────────────────────────────────────────────────────┘
```

### Komponenten

| Komponente | Port | Beschreibung |
|------------|------|--------------|
| Orchestrator | 8080 | API, Scheduler, Container-Management |
| Dashboard | 3000 | Web UI für Monitoring und Kontrolle |
| PostgreSQL | 5432 | Persistente Daten (Agents, Decisions, Events) |
| Redis | 6379 | Pub/Sub, Caching, Task Queues |
| Qdrant | 6333 | Vektor-Datenbank für RAG |
| Ollama | 11434 | Lokale Embeddings (bge-m3) |
| Portainer | 9000 | Container-Management API |

---

## 2. Agent System

### 2.1 Agent-Typen

| Agent | Loop-Intervall | Tier | Zuständigkeit |
|-------|----------------|------|---------------|
| **CEO** | 30 min | head | Strategische Koordination, Veto-Recht |
| **DAO** | 4 Stunden | head | Governance, Token-Entscheidungen |
| **CMO** | 2 Stunden | clevel | Marketing, Social Media, Brand |
| **CTO** | 1 Stunde | clevel | Technische Entwicklung |
| **CFO** | 4 Stunden | clevel | Treasury, Tokenomics |
| **COO** | 1 Stunde | clevel | Operations, Prozesse |
| **CCO** | 12 Stunden | clevel | Compliance, Legal |

### 2.2 Agent Daemon (`src/agents/daemon.ts`)

Der Daemon ist der Kern jedes Agents:

```
┌─────────────────────────────────────────┐
│              Agent Loop                  │
├─────────────────────────────────────────┤
│ 1. Profil laden (DB → Markdown Fallback)│
│ 2. Nachrichten prüfen (Redis)           │
│ 3. Task Queue abrufen                   │
│ 4. Kanban Issues laden                  │
│ 5. RAG Kontext aufbauen                 │
│ 6. Claude Code ausführen                │
│ 7. Actions verarbeiten                  │
│ 8. State speichern                      │
│ 9. Schlafen bis zum nächsten Trigger    │
└─────────────────────────────────────────┘
```

### 2.3 Task-Limit (NEU)

**Max 2 gleichzeitige In-Progress Issues pro Agent!**

```typescript
// daemon.ts:593-604
const MAX_CONCURRENT_TASKS = 2;
if (currentInProgress >= MAX_CONCURRENT_TASKS) {
  pendingTasks = []; // Fokus auf aktuelle Arbeit
}
```

### 2.4 Priority Sorting (NEU)

Tasks werden nach Priorität sortiert:

```
critical → urgent → high → normal → low → operational
```

### 2.5 Verfügbare Actions

| Action | Beschreibung |
|--------|--------------|
| `spawn_worker` | MCP Worker für externe Tools starten |
| `operational` | Operative Aktivität loggen |
| `decision` | Entscheidung zur Abstimmung vorlegen |
| `alert` | Dringende Benachrichtigung |
| `propose_initiative` | Neue Initiative vorschlagen |
| `create_task` | Task an anderen Agent zuweisen |
| `create_pr` | Pull Request erstellen |
| `merge_pr` | PR mergen (CTO) |
| `close_pr` | PR ablehnen (CTO) |
| `claim_issue` | Issue als in-progress markieren (NEU) |
| `complete_issue` | Issue als done/review markieren (NEU) |
| `update_issue` | Kommentar zu Issue hinzufügen |
| `request_human_action` | Menschliche Aktion anfordern |

---

## 3. Worker System

### 3.1 MCP Worker Architektur

Workers sind kurzlebige Claude Code Sessions mit dynamischer MCP-Server-Konfiguration.

```
Agent                    Worker                  MCP Server
  │                        │                         │
  │  spawn_worker(task)    │                         │
  ├───────────────────────>│                         │
  │                        │  MCP Tool Call          │
  │                        ├────────────────────────>│
  │                        │  Tool Response          │
  │                        │<────────────────────────┤
  │  worker_result         │                         │
  │<───────────────────────┤                         │
```

### 3.2 Verfügbare MCP Server

| Server | Tools | Agenten |
|--------|-------|---------|
| `telegram` | Nachrichten senden/empfangen | CMO, COO |
| `filesystem` | Dateien lesen/schreiben | Alle |
| `fetch` | HTTP Requests | Alle außer DAO |
| `etherscan` | Blockchain-Daten | DAO, CFO |
| `directus` | CMS Content | CTO |
| `imagen` | Bildgenerierung (Google) | CEO, CMO, CTO |

### 3.3 Backlog Groomer (`src/workers/backlog-groomer.ts`)

Läuft alle 3 Stunden:
- Duplikat-Erkennung via RAG (Schwellwert: 0.85)
- Issue-Gruppierung zu Epics (Schwellwert: 0.70)
- Effort/Revenue-Validierung
- CEO-Priorisierung basierend auf Marktdaten

---

## 4. Kommunikation & Events

### 4.1 Redis Channels

| Channel | Empfänger | Zweck |
|---------|-----------|-------|
| `channel:broadcast` | Alle Agents | Allgemeine Broadcasts |
| `channel:head` | CEO + DAO | Head-Level Entscheidungen |
| `channel:clevel` | C-Level Agents | C-Level Kommunikation |
| `channel:agent:<uuid>` | Spezifischer Agent | Direkte Nachrichten |
| `channel:orchestrator` | Orchestrator | Workspace Updates, RAG |
| `channel:worker:logs` | Dashboard | Worker Tool Calls |

### 4.2 Message Types

| Type | Trigger AI | Beschreibung |
|------|------------|--------------|
| `task` | ✅ | Task-Zuweisung |
| `task_queued` | ✅ | Wake-up Signal |
| `decision` | ✅ | Entscheidung zur Abstimmung |
| `vote` | ✅ | Abstimmung |
| `alert` | ✅ | Dringende Benachrichtigung |
| `worker_result` | ✅ | Worker-Ergebnis |
| `pr_approved_by_rag` | ✅ | PR Qualitätsprüfung bestanden |
| `status_request` | ❌ | Status-Anfrage |
| `status_response` | ❌ | Status-Antwort |

### 4.3 Decision Voting System

```
┌─────────────────────────────────────────────────────────────┐
│                    Decision Tiers                            │
├─────────────────────────────────────────────────────────────┤
│ operational  → Keine Genehmigung (auto-execute)             │
│ minor        → CEO Vote only, 4h Timeout, auto-approve      │
│ major        → CEO + DAO, 24h Timeout, escalate on timeout  │
│ critical     → CEO + DAO + Human, 48h Timeout, escalate     │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 Event Types

```typescript
type EventType =
  | 'agent_started' | 'agent_stopped' | 'agent_error'
  | 'task_created' | 'task_completed'
  | 'decision_proposed' | 'decision_voted' | 'decision_resolved'
  | 'escalation_created' | 'escalation_resolved'
  | 'initiative_created' | 'human_action_requested'
  | 'pr_created' | 'pr_merged' | 'pr_rejected'
  | 'issue_claimed' | 'issue_completed';  // NEU
```

---

## 5. LLM Integration

### 5.1 Router Strategien

| Strategie | Beschreibung |
|-----------|--------------|
| `claude-only` | Nur Claude Code CLI (Standard) |
| `task-type` | Routing nach Task-Komplexität |
| `agent-role` | Routing nach Agent-Typ |
| `load-balance` | Lastverteilung zwischen Providern |
| `gemini-prefer` | Gemini bevorzugen (Kostenoptimierung) |

### 5.2 Model Tiers

| Tier | Model | Komplexität |
|------|-------|-------------|
| simple | gemini-2.5-flash-lite | spawn_worker |
| medium | gemini-2.5-flash | create_task |
| complex | gemini-2.5-flash | propose_decision |
| critical | gemini-2.5-pro | critical_decision |

### 5.3 Claude Code Integration

AITO nutzt **Claude Code CLI**, NICHT die API:

```typescript
// Kein ANTHROPIC_API_KEY benötigt!
const result = await executeClaude({
  prompt: loopPrompt,
  systemPrompt,
  mcpConfigPath: '/tmp/mcp-worker-xyz.json',
  timeout: 300000,
});
```

---

## 6. GitHub Integration

### 6.1 Issue Workflow (NEU)

```
┌──────────┐    claim_issue    ┌─────────────┐   complete_issue   ┌──────────┐
│  ready   │ ─────────────────>│ in-progress │ ─────────────────> │   done   │
└──────────┘                   └─────────────┘                    └──────────┘
                                     │
                                     │ complete_issue(setToReview: true)
                                     ▼
                               ┌──────────┐
                               │  review  │
                               └──────────┘
```

### 6.2 Initiative System

Agents generieren proaktiv Arbeit:

```typescript
// Beispiel CMO Initiative
{
  title: "Twitter Activation Campaign",
  description: "Launch viral Twitter campaign",
  priority: "high",
  effort: 3,
  revenueImpact: 8,
  suggestedAssignee: "cmo",
  tags: ["marketing", "social"]
}
```

### 6.3 Duplikat-Check (VERBESSERT)

```typescript
// 1. Redis Cache prüfen (schnell)
// 2. GitHub Issue-Suche mit Keywords
// 3. Fuzzy-Matching mit Jaccard-Index (>80% = Duplikat)
```

---

## 7. RAG System

### 7.1 Konfiguration

| Parameter | Wert |
|-----------|------|
| Vector DB | Qdrant |
| Embedding Model | bge-m3 (Ollama) |
| Dimensionen | 1024 |
| Chunk Size | 500 Tokens |
| Chunk Overlap | 50 Tokens |

### 7.2 Content Types

- `project_doc` - README, Design Docs
- `decision` - Entscheidungs-Records
- `agent_output` - Agent Actions
- `directus_content` - CMS Content
- `api_usage` - API Pattern Learning

### 7.3 PR Quality Gate

PRs werden vor Merge von RAG evaluiert:

1. Semantische Analyse der Änderungen
2. Pattern-Matching gegen bekannte Good/Bad Practices
3. Approval/Rejection mit Begründung

---

## 8. Dashboard

### 8.1 Seiten

| Route | Beschreibung |
|-------|--------------|
| `/` | Overview mit Status-Cards |
| `/agents` | Agent Grid |
| `/agents/[type]` | Agent Detail |
| `/kanban` | Backlog Kanban Board |
| `/decisions` | Entscheidungs-Liste |
| `/escalations` | Eskalationen |
| `/events` | Event Audit Log |
| `/messages` | Agent Nachrichten |
| `/workers` | MCP Worker Logs |
| `/domains` | Domain Whitelist |
| `/network` | Agent Netzwerk Visualisierung |
| `/benchmarks` | LLM Benchmark Ergebnisse |
| `/settings` | System Konfiguration |

### 8.2 WebSocket Events

- Agent Status Updates
- Worker Tool Call Logs
- Decision Votes
- Real-time Messages

---

## 9. Datenbank

### 9.1 Tabellen

| Tabelle | Zweck |
|---------|-------|
| `agents` | Agent Registry |
| `agent_state` | Persistenter State mit TTL |
| `agent_history` | Action History (RAG Source) |
| `decisions` | Voting System |
| `tasks` | Work Items |
| `events` | Audit Log |
| `escalations` | Human Escalations |
| `domain_whitelist` | Approved Domains |
| `domain_approvals` | Domain Requests |
| `profiles` | Agent Profiles (DB Backup) |
| `system_settings` | System Konfiguration |

### 9.2 Settings Kategorien

| Kategorie | Keys |
|-----------|------|
| `queue` | delay_critical, delay_urgent, delay_high, delay_normal, delay_low, delay_operational |
| `agents` | loop_interval_ceo, loop_interval_cmo, ... |
| `llm` | routing_strategy, enable_fallback, prefer_gemini, gemini_default_model |
| `feedback` | operational_notify_ceo, broadcast_decisions, targeted_feedback |
| `initiative` | cooldown_hours, max_per_day, only_on_scheduled |

---

## 10. Konfiguration

### 10.1 Environment Variables (Essential)

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `POSTGRES_URL` | required | DB Connection |
| `REDIS_URL` | redis://localhost:6379 | Redis Connection |
| `LLM_ROUTING_STRATEGY` | claude-only | LLM Router |
| `DRY_RUN` | false | Test-Modus |
| `GITHUB_TOKEN` | optional | Git Operations |

### 10.2 Was in DB sein SOLLTE (TODO)

Diese Configs sind noch hardcoded und sollten in `system_settings` migriert werden:

| Config | Aktueller Ort | Status |
|--------|---------------|--------|
| Agent Loop Intervals | `config.ts:138-179` | ⚠️ Hardcoded |
| Queue Delays | `daemon.ts:47-54` | ✅ In DB |
| LLM Settings | `config.ts:182-187` | ⚠️ Env + DB |
| Decision Timeouts | `config.ts:71-73` | ⚠️ Hardcoded |
| Escalation Timeouts | `config.ts:66-68` | ⚠️ Hardcoded |
| Max Concurrent Tasks | `daemon.ts:594` | ⚠️ Hardcoded |

---

## 11. MCP Server

### 11.1 Konfiguration

```json
// .claude/mcp_servers.json
{
  "telegram": "npx @chaindead/telegram-mcp",
  "etherscan": "npx etherscan-mcp",
  "directus": "npx @directus/content-mcp@latest",
  "filesystem": "npx @anthropic-ai/mcp-server-filesystem /app/workspace",
  "fetch": "npx @anthropic-ai/mcp-server-fetch",
  "imagen": "node /app/mcp-servers/imagen-mcp/dist/index.js"
}
```

### 11.2 Agent Server Access

| Agent | Server |
|-------|--------|
| CEO | filesystem, fetch, imagen |
| DAO | filesystem, etherscan |
| CMO | telegram, fetch, filesystem, imagen |
| CTO | directus, filesystem, fetch |
| CFO | etherscan, filesystem |
| COO | telegram, filesystem |
| CCO | filesystem, fetch |

---

## 12. Bekannte Probleme

### 12.1 Kritisch

| Problem | Ort | Impact |
|---------|-----|--------|
| **Gemini Quota Erschöpfung** | Gemini Free Tier | 1500 req/day Limit |
| **Market Data Halluzination** | Agents | Falsche Preise/Daten |
| **Timeout Race Conditions** | Decision Timeouts | Single-Process Map |

### 12.2 Mittel

| Problem | Ort | Impact |
|---------|-----|--------|
| **Hardcoded Configs** | config.ts | Restart für Änderungen |
| **MCP Server Cold Start** | Workers | npx langsam beim ersten Call |
| **Large File Handling** | RAG | >500 Token Chunks verlieren Kontext |

### 12.3 Niedrig

| Problem | Ort | Impact |
|---------|-----|--------|
| **Kanban Status Sync** | Dashboard | Cache kann stale sein |
| **Agent State TTL** | Redis | Manchmal nicht getriggert |

---

## 13. Verbesserungspotential

### 13.1 Kurzfristig (Quick Wins)

1. **Alle Configs in DB** - Agent Intervals, Timeouts, etc.
2. **Settings von DB laden** - Agents sollten Settings aus DB lesen
3. **Bessere Error Messages** - Spezifischere Fehlermeldungen
4. **Dashboard Settings Live-Reload** - Änderungen ohne Restart

### 13.2 Mittelfristig

1. **Token Budgeting** - Tägliches Token-Limit pro Agent
2. **Distributed Scheduler** - Mehrere Orchestrator-Instanzen
3. **Prometheus Metrics** - Vollständiges Monitoring
4. **Test Coverage** - Mehr Tests für Daemon, Profile, Events

### 13.3 Langfristig

1. **HyDE für RAG** - Hypothetical Document Embeddings
2. **Agent Benchmarking** - Performance-Tracking pro Agent
3. **Multi-Tenant** - Mehrere Projekte in einem AITO
4. **WebSocket Cluster** - Redis Adapter für Multi-Instance

---

## Anhang: API Endpoints

### Health
```
GET  /health       → Liveness
GET  /ready        → Readiness
GET  /health/full  → Full Status
```

### Agents
```
GET  /agents                    → List
GET  /agents/:type              → Detail
POST /agents/:type/restart      → Restart
POST /agents/:type/start        → Start
POST /agents/:type/stop         → Stop
```

### Decisions
```
GET  /decisions                 → List
GET  /decisions/pending         → Pending only
POST /decisions/:id/vote        → Cast vote
```

### Settings
```
GET  /settings                  → All settings
GET  /settings/:category        → By category
PUT  /settings/:category/:key   → Update setting
```

---

*Dokumentation generiert am: 2024-12-20*
*AITO Version: 3.0*
