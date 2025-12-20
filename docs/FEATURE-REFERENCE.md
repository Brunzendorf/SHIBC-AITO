# AITO 3.0 - Vollständige Feature-Referenz

> **Stand:** 2025-12-20
> **Version:** 3.0
> **Letzte Überprüfung:** Vollständiges Code-Review durchgeführt

---

## Inhaltsverzeichnis

1. [System-Übersicht](#1-system-übersicht)
2. [Datenbank-Layer](#2-datenbank-layer)
3. [Agent-System](#3-agent-system)
4. [Worker-System](#4-worker-system)
5. [Orchestrator](#5-orchestrator)
6. [LLM-System](#6-llm-system)
7. [Utilities](#7-utilities)
8. [Dashboard](#8-dashboard)
9. [Profiles](#9-profiles)
10. [Konfiguration](#10-konfiguration)

---

## 1. System-Übersicht

### Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│                         DASHBOARD (Next.js)                      │
│                    http://localhost:3000                         │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ REST API / WebSocket
┌─────────────────────────────────▼───────────────────────────────┐
│                         ORCHESTRATOR                             │
│                    http://localhost:8080                         │
│  • Container Management  • Event Bus  • Health Monitoring       │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ Redis Pub/Sub
┌─────────────────────────────────▼───────────────────────────────┐
│                         AGENT LAYER                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │   CEO   │ │   DAO   │ │   CMO   │ │   CTO   │ │   CFO   │   │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘   │
│       │           │           │           │           │         │
│  ┌────▼───────────▼───────────▼───────────▼───────────▼────┐   │
│  │                    MCP WORKERS                           │   │
│  │  [Telegram] [Fetch] [Filesystem] [Etherscan] [Directus] │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────┐
│                      PERSISTENCE LAYER                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  PostgreSQL  │  │    Redis     │  │    Qdrant    │          │
│  │   (State)    │  │  (Pub/Sub)   │  │    (RAG)     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### Technologie-Stack

| Komponente | Technologie | Zweck |
|------------|-------------|-------|
| Agents | TypeScript + Claude Code CLI | Autonome AI-Entscheidungen |
| Orchestrator | Express.js | Container-Management, API |
| Dashboard | Next.js 14 + TailwindCSS | Web-UI |
| Database | PostgreSQL 15 + pgvector | Persistenz + Vektor-Suche |
| Message Queue | Redis 7 | Pub/Sub, Task-Queues |
| Vector DB | Qdrant | RAG-System |
| Embeddings | Ollama (bge-m3) | Lokale Embeddings |
| Container | Docker + Docker Compose | Deployment |

---

## 2. Datenbank-Layer

**Datei:** `src/lib/db.ts`
**Schema:** `docker/init-db.sql`

### 2.1 Agent Repository

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `findAll()` | Alle Agenten auflisten | ✅ |
| `findById(id)` | Agent nach UUID | ✅ |
| `findByType(type)` | Agent nach Typ (ceo, cmo, etc.) | ✅ |
| `create(agent)` | Neuen Agent registrieren | ✅ |
| `updateStatus(id, status)` | Status ändern (active/inactive/error) | ✅ |
| `updateHeartbeat(id)` | Heartbeat-Timestamp aktualisieren | ✅ |

### 2.2 State Repository (Persistent Memory)

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `get<T>(agentId, key)` | State-Wert abrufen (typsicher) | ✅ |
| `set(agentId, key, value)` | State-Wert speichern | ✅ |
| `getAll(agentId)` | Alle States eines Agenten | ✅ |
| `delete(agentId, key)` | State löschen | ✅ |
| `deleteStale(agentId)` | Alte volatile Daten entfernen (>1h) | ✅ |

**Volatile State Handling:**
- Keys mit Präfix `market_`, `price_`, `treasury_` haben 1h TTL
- Automatische Bereinigung verhindert Halluzinationen
- `extractAndSaveWorkerState()` in daemon.ts extrahiert Daten aus Worker-Results

### 2.3 History Repository (RAG Source)

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `add(entry)` | Aktion zur History hinzufügen | ✅ |
| `getRecent(agentId, limit)` | Letzte N Aktionen | ✅ |
| `search(agentId, embedding)` | Semantische Suche | ✅ |

### 2.4 Decision Repository (Voting System)

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `create(decision)` | Neue Decision erstellen | ✅ |
| `findById(id)` | Decision-Details | ✅ |
| `findPending()` | Ausstehende Decisions | ✅ |
| `findEscalated()` | Eskalierte Decisions | ✅ |
| `updateVote(id, voterType, vote)` | CEO/DAO Abstimmung | ✅ |
| `updateCLevelVotes(id, votes)` | C-Level Abstimmungen | ✅ |
| `updateStatus(id, status)` | Status ändern | ✅ |
| `incrementVetoRound(id)` | Veto-Runden zählen | ✅ |
| `setHumanDecision(id, decision)` | Manuelle Entscheidung | ✅ |
| `findAll(pagination)` | Alle mit Paginierung | ✅ |

### 2.5 Task Repository

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `create(task)` | Task erstellen | ✅ |
| `findByAgent(agentId)` | Tasks eines Agenten | ✅ |
| `findByStatus(status)` | Tasks nach Status filtern | ✅ |
| `updateStatus(id, status)` | Task-Status ändern | ✅ |

### 2.6 Event Repository (Audit Log)

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `log(event)` | Event registrieren | ✅ |
| `getRecent(limit)` | Letzte Events | ✅ |
| `getByAgent(agentId)` | Events eines Agenten | ✅ |
| `getByType(type)` | Events nach Typ | ✅ |

### 2.7 Settings Repository

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `getAll()` | Alle Einstellungen | ✅ |
| `getByCategory(category)` | Settings nach Kategorie | ✅ |
| `get(category, key)` | Einzelne Setting | ✅ |
| `getValue<T>(category, key)` | Mit Typ-Casting | ✅ |
| `set(category, key, value)` | Setting speichern | ✅ |
| `delete(category, key)` | Setting löschen | ✅ |
| `getQueueDelays()` | Priority-basierte Delays | ✅ |
| `getAgentLoopIntervals()` | Loop-Intervale | ✅ |
| `getLLMSettings()` | LLM-Routing-Config | ✅ |
| `getDecisionTimeouts()` | Decision-Timeouts | ✅ |
| `getEscalationTimeouts()` | Eskalations-Timeouts | ✅ |
| `getTaskSettings()` | Max-Concurrent-Tasks | ✅ |
| `getWorkspaceSettings()` | PR-Workflow-Settings | ✅ |
| `getFeedbackSettings()` | Feedback-Routing | ✅ |
| `getInitiativeSettings()` | Initiative-Cooldowns | ✅ |

### 2.8 Domain Whitelist Repository

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `getAll()` | Alle whitelisteten Domains | ✅ |
| `getAllDomains()` | Nur Domain-Strings | ✅ |
| `getByCategory(category)` | Domains nach Kategorie | ✅ |
| `isDomainWhitelisted(domain)` | Domain validieren | ✅ |
| `add(domain, category, desc)` | Domain hinzufügen | ✅ |
| `remove(domain)` | Domain deaktivieren | ✅ |

### 2.9 Domain Approval Requests

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `create(request)` | Genehmigungsanfrage erstellen | ✅ |
| `getPending()` | Ausstehende Anfragen | ✅ |
| `getAll(pagination)` | Alle mit Paginierung | ✅ |
| `getById(id)` | Einzelne Anfrage | ✅ |
| `hasPendingRequest(domain)` | Check ob existiert | ✅ |
| `approve(id, reviewedBy, notes)` | Genehmigen + Whitelist | ✅ |
| `reject(id, reviewedBy, notes)` | Ablehnen | ✅ |
| `autoApprove(id)` | Automatische Genehmigung | ✅ |

### 2.10 LLM Usage Repository

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `log(entry)` | LLM-Nutzung protokollieren | ✅ |
| `getMonthlyStats()` | Monatliche Statistiken | ✅ |
| `getByAgent(agentId)` | Nutzung pro Agent | ✅ |

### 2.11 Worker Execution Repository

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `log(execution)` | Worker-Task protokollieren | ✅ |
| `getByAgent(agentId)` | Worker-Aufrufe pro Agent | ✅ |
| `getRecent(limit)` | Letzte Ausführungen | ✅ |

### 2.12 Benchmark Repository

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `create(run)` | Benchmark-Run erstellen | ✅ |
| `getByRunId(id)` | Run-Details | ✅ |
| `updateResults(id, results)` | Ergebnisse speichern | ✅ |
| `setStatus(id, status)` | Status aktualisieren | ✅ |
| `getRecent(limit)` | Letzte Runs | ✅ |

---

## 3. Agent-System

### 3.1 Agent Daemon

**Datei:** `src/agents/daemon.ts`

#### Lifecycle Management

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `start()` | Agent-Startup mit allen Initialisierungen | ✅ |
| `stop()` | Graceful Shutdown | ✅ |
| `getHealthStatus()` | Health-Check-Daten | ✅ |
| `loadSettingsFromDB()` | Settings aus DB laden | ✅ |

#### Message Handling

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `subscribeToEvents()` | Redis-Channels abonnieren | ✅ |
| `handleMessage(msg, channel)` | Messages verarbeiten | ✅ |
| `shouldTriggerAI(msg)` | Entscheiden ob AI nötig | ✅ |
| `handleSimpleMessage(msg)` | Messages ohne AI | ✅ |
| `sendStatusResponse(to)` | Status-Response senden | ✅ |

#### Loop Execution

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `runLoop(trigger, data?)` | Hauptschleife ausführen | ✅ |
| `scheduleLoop()` | Cron-basiertes Scheduling | ✅ |
| `intervalToCron(seconds)` | Interval zu Cron-Expression | ✅ |
| `runAIInitiativeGeneration()` | AI-getriebene Initiatives | ✅ |

#### Action Processing

| Action Type | Beschreibung | Status |
|-------------|--------------|--------|
| `create_task` | Task für anderen Agent erstellen | ✅ |
| `propose_decision` | Decision mit Tier vorschlagen | ✅ |
| `operational` | Sofortige Ausführung (kein Approval) | ✅ |
| `vote` | CEO/DAO Abstimmung | ✅ |
| `alert` | Alert an Orchestrator | ✅ |
| `spawn_worker` | MCP-Worker spawnen | ✅ |
| `create_pr` | Pull Request erstellen | ✅ |
| `merge_pr` | PR nach Review mergen | ✅ |
| `claim_pr` | PR zum Review claimen | ✅ |
| `close_pr` | PR mit Feedback ablehnen | ✅ |
| `request_human_action` | GitHub Issue für Human | ✅ |
| `update_issue` | Issue-Kommentar hinzufügen | ✅ |
| `claim_issue` | Issue claimen (in-progress) | ✅ |
| `complete_issue` | Issue abschließen | ✅ |
| `propose_initiative` | Eigenständig Initiative vorschlagen | ✅ |

#### State Auto-Extraction

| Extraktions-Typ | Regex/Pattern | Status |
|-----------------|---------------|--------|
| Preis-Extraktion | `\$?([\d.]+(?:e[+-]?\d+)?)\s*(?:usd)?` | ✅ |
| Fear & Greed Index | `(?:index\|score)[:\s]*(\d+)` | ✅ |
| ETH Balance | `([\d,.]+)\s*ETH` | ✅ |
| USD Value | `\$([\d,.]+)` | ✅ |
| Holder Count | `([\d,]+)\s*(?:holder\|address)` | ✅ |
| Telegram Members | `([\d,]+)\s*(?:member\|subscriber)` | ✅ |

### 3.2 Claude Code Wrapper

**Datei:** `src/agents/claude.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `executeClaudeCode(session)` | Basis-Claude-Ausführung | ✅ |
| `executeClaudeCodeWithRetry(session)` | Mit exponential Backoff | ✅ |
| `executeClaudeCodeWithMCP(session)` | Mit native MCP-Server | ✅ |
| `executeClaudeAgent(config)` | Mit benanntem Agent | ✅ |
| `executeOllamaFallback(prompt)` | Ollama wenn Claude unavailable | ✅ |
| `isClaudeAvailable()` | CLI-Check mit Retries | ✅ |
| `getKanbanIssuesForAgent(type)` | Redis-basiertes Issue-Fetching | ✅ |
| `buildLoopPrompt(...)` | Komplexe Loop-Prompts bauen | ✅ |
| `parseClaudeOutput(output)` | JSON aus Claude-Output parsen | ✅ |

**Retry-Konfiguration:**
- Max Retries: 3
- Initial Delay: 5000ms
- Max Delay: 60000ms
- Retryable Errors: overloaded, rate_limit, timeout, 503, 502, 529

### 3.3 Profile Loader

**Datei:** `src/agents/profile.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `loadProfile(path, type)` | DB-First mit File-Fallback | ✅ |
| `loadProfileFromDatabase(type)` | Profil aus DB | ✅ |
| `loadProfileFromFile(path)` | Markdown-Parsing | ✅ |
| `loadBaseProfile()` | Gemeinsame Basis cachen | ✅ |
| `generateSystemPrompt(profile)` | System-Prompt generieren | ✅ |

**Profil-Sektionen:**
- Identity (Name, Codename, Department)
- Mission Statement
- Core Responsibilities
- Decision Authority
- Key Metrics
- Communication Style
- Guiding Principles

### 3.4 State Management

**Datei:** `src/agents/state.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `get<T>(key)` | Typsicheres State-Abrufen | ✅ |
| `set<T>(key, value)` | State speichern | ✅ |
| `delete(key)` | State löschen | ✅ |
| `getAll()` | Alle States | ✅ |
| `clear()` | Alle States löschen | ✅ |

**Standard State Keys:**
- `LOOP_COUNT` - Loop-Zähler
- `ERROR_COUNT` - Fehler-Zähler
- `SUCCESS_COUNT` - Erfolgs-Zähler
- `LAST_LOOP_AT` - Timestamp
- `CURRENT_FOCUS` - Aktuelle Fokus-Area
- `PENDING_TASKS` - Queue
- `COMPLETED_TASKS` - Abgeschlossene

### 3.5 Git Workspace

**Datei:** `src/agents/workspace.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `initialize(agentType)` | Git-Clone mit Filter | ✅ |
| `hasUncommittedChanges()` | Check für Änderungen | ✅ |
| `getChangedFiles()` | Liste geänderter Dateien | ✅ |
| `commitAndCreatePR(...)` | Commit → Push → PR | ✅ |
| `commitAndPushDirect(...)` | Direct-Push (bypass PR) | ✅ |
| `mergePullRequest(prNumber)` | PR mergen | ✅ |
| `closePullRequest(prNumber, reason)` | PR ablehnen | ✅ |

**PR-Kategorien:**
- `status` - Routine-Updates (auto-merge möglich)
- `content` - Inhaltliche Änderungen (C-Level Review)
- `strategic` - Strategische Änderungen (CEO Review)

### 3.6 Initiative System

**Datei:** `src/agents/initiative.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `runInitiativePhase(agentType)` | Periodische Initiative-Generierung | ✅ |
| `getInitiativePromptContext(type)` | Kontext für Prompts | ✅ |
| `buildInitiativeGenerationPrompt(type)` | Generierungs-Prompts | ✅ |
| `createInitiativeFromProposal(...)` | Agent-Proposal → GitHub Issue | ✅ |
| `createGitHubIssue(initiative)` | Issue erstellen | ✅ |
| `createHumanActionRequest(...)` | Manuelle Aufgabe-Issue | ✅ |
| `addIssueComment(number, comment, type)` | Kommentar hinzufügen | ✅ |
| `claimIssue(number, agentType)` | Issue claimen | ✅ |
| `completeIssue(number, agentType, review?, comment?)` | Issue abschließen | ✅ |
| `updateIssueStatus(number, status, agentType?)` | Status-Übergang | ✅ |
| `wasInitiativeCreated(initiative)` | Duplikat-Check | ✅ |
| `calculateSimilarity(a, b)` | Jaccard-Similarity | ✅ |

**Agent-spezifische Fokus-Bereiche:**
- **CEO:** Roadmap, Partnerships, Team-Produktivität
- **CMO:** Twitter-Wachstum, Viral-Content, Influencer
- **CFO:** Finanz-Optimierung, Burn-Rate, Runway
- **CTO:** Tech-Schulden, Infrastructure, Security
- **COO:** Prozess-Optimierung, Effizienz, Automation
- **CCO:** Compliance, Risk-Management, Verträge
- **DAO:** Community-Voting, Governance, Dezentralisierung

---

## 4. Worker-System

### 4.1 Worker Spawner

**Datei:** `src/workers/spawner.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `spawnWorker(...)` | Synchrone Worker-Execution | ✅ |
| `spawnWorkerAsync(...)` | Background-Worker + Redis-Publish | ✅ |
| `getActiveWorkerCount()` | Concurrent-Worker-Count | ✅ |
| `validateServerAccess(agentType, servers)` | Server-Whitelist-Check | ✅ |

**Server-Access pro Agent:**

| Agent | Erlaubte MCP-Server |
|-------|---------------------|
| CEO | filesystem, fetch |
| DAO | filesystem, etherscan |
| CMO | telegram, fetch, filesystem |
| CTO | directus, filesystem, fetch |
| CFO | etherscan, filesystem |
| COO | telegram, filesystem |
| CCO | filesystem, fetch |

**Limits:**
- `MAX_CONCURRENT_WORKERS`: 3 pro Agent

### 4.2 MCP Worker

**Datei:** `src/workers/worker.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `executeWorker(task)` | Worker-Hauptschleife | ✅ |
| `generateDynamicMCPConfig(servers)` | Per-Task MCP-Config | ✅ |
| `loadMCPConfig()` | Base-Config laden | ✅ |
| `getAPIsForTask(task)` | Relevante APIs finden | ✅ |
| `generateAPIPrompt(apis)` | API-Docs in Prompt | ✅ |
| `getWhitelistForPromptAsync()` | Whitelist für Prompt | ✅ |
| `createDomainApprovalRequest(...)` | Approval-Request erstellen | ✅ |
| `extractBlockedUrl(error)` | URL aus Error extrahieren | ✅ |
| `getDryRunInstructions()` | DRY_RUN-Mode-Guidance | ✅ |
| `logToolCalls(calls)` | Tool-Activity zu Redis | ✅ |

**DRY-RUN Mode:**
- Aktiviert via `DRY_RUN=true`
- Write-Operations werden simuliert
- Read-Operations sind real
- Dashboard zeigt "[DRY-RUN]" Prefix

### 4.3 Archive Worker

**Datei:** `src/workers/archive-worker.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `queueForArchive(item)` | Loop-Summaries queuen | ✅ |
| `processArchiveQueue()` | Batch-Verarbeitung | ✅ |
| `getQueueLength()` | Queue-Größe | ✅ |
| `getArchiveStats()` | Statistiken | ✅ |
| `runArchiveWorker()` | Periodische Verarbeitung | ✅ |

**Archive-Aktionen:**
- `DISCARD` - Nicht signifikant, verwerfen
- `INDEX` - In RAG indexieren
- `UPDATE` - Bestehendes Item updaten
- `INVALIDATE` - Altes Item als ungültig markieren
- `CONSOLIDATE` - Mehrere Items zusammenfassen

### 4.4 Backlog Groomer

**Datei:** `src/workers/backlog-groomer.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `runBacklogGrooming()` | Automatisches Backlog-Refresh | ✅ |
| `getBacklogStats()` | Statistiken nach Status | ✅ |

**Grooming-Logik:**
- Stale Issues (>14 Tage) schließen
- Labels aktualisieren
- Priority rebalancieren
- Ready-Status promoten
- Agent-Assignments vorschlagen

---

## 5. Orchestrator

### 5.1 REST API

**Datei:** `src/orchestrator/api.ts`

#### Health Endpoints

| Endpoint | Methode | Beschreibung | Status |
|----------|---------|--------------|--------|
| `/health` | GET | Liveness-Probe | ✅ |
| `/ready` | GET | Readiness-Probe | ✅ |
| `/health/full` | GET | Detaillierte System-Health | ✅ |

#### Agent Management

| Endpoint | Methode | Beschreibung | Status |
|----------|---------|--------------|--------|
| `/agents` | GET | Alle Agenten mit Container-Status | ✅ |
| `/agents/:type` | GET | Agent-Details | ✅ |
| `/agents/:type/history` | GET | Agent-History | ✅ |
| `/agents/:type/start` | POST | Agent starten | ✅ |
| `/agents/:type/stop` | POST | Agent stoppen | ✅ |
| `/agents/:type/restart` | POST | Agent neustarten | ✅ |
| `/agents/:type/health` | GET | Agent-Health | ✅ |

#### Event Management

| Endpoint | Methode | Beschreibung | Status |
|----------|---------|--------------|--------|
| `/events` | GET | Letzte Events | ✅ |
| `/agents/:type/events` | GET | Agent-spezifische Events | ✅ |

#### Decision Management

| Endpoint | Methode | Beschreibung | Status |
|----------|---------|--------------|--------|
| `/decisions` | GET | Alle Decisions | ✅ |
| `/decisions/pending` | GET | Ausstehende | ✅ |
| `/decisions/:id/vote` | POST | Abstimmung | ✅ |
| `/decisions/:id/escalate` | POST | Eskalation | ✅ |
| `/decisions/:id/resolve` | POST | Manuelles Resolve | ✅ |

#### Task Management

| Endpoint | Methode | Beschreibung | Status |
|----------|---------|--------------|--------|
| `/tasks` | GET | Alle Tasks | ✅ |
| `/tasks` | POST | Neue Task | ✅ |
| `/tasks/:id/complete` | POST | Task-Abschluss | ✅ |

#### Domain Management

| Endpoint | Methode | Beschreibung | Status |
|----------|---------|--------------|--------|
| `/domains/whitelist` | GET | Whitelistete Domains | ✅ |
| `/domains/whitelist` | POST | Domain hinzufügen | ✅ |
| `/domains/:domain` | DELETE | Domain entfernen | ✅ |
| `/domains/approval-requests` | GET | Pending Requests | ✅ |
| `/domains/approval-requests/:id/approve` | POST | Genehmigen | ✅ |
| `/domains/approval-requests/:id/reject` | POST | Ablehnen | ✅ |

#### Settings

| Endpoint | Methode | Beschreibung | Status |
|----------|---------|--------------|--------|
| `/settings` | GET | Alle System-Settings | ✅ |
| `/settings/:category/:key` | POST | Setting setzen | ✅ |

#### Benchmarking

| Endpoint | Methode | Beschreibung | Status |
|----------|---------|--------------|--------|
| `/benchmark/run` | POST | Benchmark starten | ✅ |
| `/benchmark/runs` | GET | Benchmark-History | ✅ |
| `/benchmark/runs/:runId` | GET | Run-Details | ✅ |

### 5.2 WebSocket Integration

**Datei:** `src/orchestrator/websocket.ts`

| Feature | Beschreibung | Status |
|---------|--------------|--------|
| Event-Streaming | Live-Events zu Dashboard | ✅ |
| Worker-Log-Updates | MCP-Tool-Aktivität | ✅ |
| Decision-Votes | Live-Voting-Sync | ✅ |
| Agent-Status | Status-Updates | ✅ |

### 5.3 Health Monitoring

**Datei:** `src/orchestrator/health.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `getSystemHealth()` | Gesamt-Status | ✅ |
| `isAlive()` | Basis-Prüfung | ✅ |
| `isReady()` | Ready-Status | ✅ |
| `getAgentHealth(type)` | Per-Agent-Health | ✅ |

**Monitored Components:**
- Database connectivity
- Redis connectivity
- Agent heartbeats
- Container status

### 5.4 Container Management

**Datei:** `src/orchestrator/container.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `startAgent(type)` | Container starten | ✅ |
| `stopAgent(type)` | Container stoppen | ✅ |
| `restartAgent(type)` | Container neustarten | ✅ |
| `getAgentContainerStatus(type)` | Status abrufen | ✅ |
| `listManagedContainers()` | Alle Container | ✅ |

---

## 6. LLM-System

### 6.1 LLM Router

**Datei:** `src/lib/llm/router.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `execute(request, context?)` | Task an besten Provider routen | ✅ |
| `checkAvailability()` | Provider-Status prüfen | ✅ |

**Routing-Strategien:**
- `claude-only` - Nur Claude verwenden
- `task-type` - Basierend auf Task-Typ
- `agent-role` - Basierend auf Agent
- `gemini-prefer` - Gemini bevorzugen (kosteneffizient)

**Task-basiertes Routing:**
| Task-Typ | Provider |
|----------|----------|
| Einfache Tasks (spawn_worker, operational) | Gemini |
| Komplexe Tasks (propose_decision, vote) | Claude |
| Reasoning-Tasks | Claude (erzwungen) |

### 6.2 Claude Provider

**Datei:** `src/lib/llm/claude-provider.ts`

| Feature | Beschreibung | Status |
|---------|--------------|--------|
| CLI-Wrapper | Claude Code CLI | ✅ |
| Retry-Logik | Exponential Backoff | ✅ |
| Token-Counting | Input/Output Tokens | ✅ |
| Cost-Berechnung | USD pro Request | ✅ |

### 6.3 Gemini Provider

**Datei:** `src/lib/llm/gemini.ts`

| Feature | Beschreibung | Status |
|---------|--------------|--------|
| API-Integration | Gemini API Direct | ✅ |
| Streaming-Support | Streaming Responses | ✅ |
| Cost-Optimization | Günstigere Alternative | ✅ |

### 6.4 Quota Management

**Datei:** `src/lib/llm/quota.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `trackUsage(provider, tokens, cost)` | Nutzung tracken | ✅ |
| `getQuotaStatus(provider)` | Aktueller Stand | ✅ |
| `isWithinQuota(provider)` | Limit-Check | ✅ |
| `resetMonthly()` | Monatliches Reset | ✅ |

### 6.5 Benchmarking

**Datei:** `src/lib/llm/benchmark.ts`

| Feature | Beschreibung | Status |
|---------|--------------|--------|
| Task-Library | 10+ Standard-Tasks | ✅ |
| Multi-Model-Comparison | Claude vs Gemini vs OpenAI | ✅ |
| Leaderboard | Ranking nach Performance | ✅ |
| Cost-Analyse | Kosten pro Task | ✅ |

---

## 7. Utilities

### 7.1 Redis Integration

**Datei:** `src/lib/redis.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `publisher.publish(channel, msg)` | Message publizieren | ✅ |
| `subscriber.subscribe(channel)` | Channel abonnieren | ✅ |
| `setAgentStatus(id, status)` | Agent-Status setzen | ✅ |
| `getAgentStatus(id)` | Status abrufen | ✅ |
| `getAllAgentStatuses()` | Bulk-Query | ✅ |
| `pushTask(agentType, task)` | Task in Queue | ✅ |
| `popTask(agentType)` | Task aus Queue | ✅ |
| `getTaskCount(agentType)` | Queue-Länge | ✅ |
| `acquireLock(key, ttl)` | Distributed Lock | ✅ |
| `releaseLock(key)` | Lock freigeben | ✅ |

**Channels:**
- `channel:broadcast` - All-Agent-Messages
- `channel:head` - CEO/DAO
- `channel:clevel` - C-Level
- `channel:orchestrator` - Workspace/RAG-Updates
- `channel:worker:logs` - MCP-Tool-Logging
- `channel:agent:{id}` - Direkte Messages

### 7.2 RAG System

**Datei:** `src/lib/rag.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `initialize()` | Collection-Setup | ✅ |
| `indexDocument(doc)` | Dokument indexieren | ✅ |
| `indexDecision(decision)` | Decision indexieren | ✅ |
| `indexAgentOutput(output)` | Agent-Output speichern | ✅ |
| `indexAPIUsage(pattern)` | API-Pattern lernen | ✅ |
| `search(query, limit)` | Semantische Suche | ✅ |
| `searchAPIPatterns(task)` | API-Pattern-Suche | ✅ |
| `reviewPRContent(pr)` | PR-Qualität-Review | ✅ |
| `buildContext(results, maxTokens)` | Context bauen | ✅ |
| `deleteBySource(source)` | Alte Indexe löschen | ✅ |
| `getStats()` | Index-Statistiken | ✅ |

**Konfiguration:**
- Embeddings: Ollama bge-m3
- Vector-DB: Qdrant
- Collection: `aito_knowledge`
- Dimensions: 1024

### 7.3 Configuration

**Datei:** `src/lib/config.ts`

| Config-Bereich | Variablen | Status |
|----------------|-----------|--------|
| Database | `POSTGRES_URL` | ✅ |
| Redis | `REDIS_URL` | ✅ |
| GitHub | `GITHUB_TOKEN`, `GITHUB_ORG`, `GITHUB_REPO` | ✅ |
| Ollama | `OLLAMA_URL` | ✅ |
| Qdrant | `QDRANT_URL` | ✅ |
| LLM | `LLM_ROUTING_STRATEGY`, `LLM_PREFER_GEMINI` | ✅ |
| Workspace | `WORKSPACE_SKIP_PR`, `WORKSPACE_AUTO_COMMIT` | ✅ |
| Safety | `DRY_RUN` | ✅ |

### 7.4 Triage System

**Datei:** `src/lib/triage.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `suggestAgentForIssue(issue)` | Agent-Vorschlag | ✅ |
| `triageIssues(issues)` | Batch-Triage | ✅ |
| `formatTriageForCEO(triage)` | CEO-Zusammenfassung | ✅ |

**Agent-Keywords:**
- **CMO:** marketing, social, twitter, content, brand
- **CTO:** code, technical, infrastructure, security
- **CFO:** treasury, budget, financial, cost
- **COO:** process, efficiency, operations
- **CCO:** compliance, legal, regulation

### 7.5 Logger

**Datei:** `src/lib/logger.ts`

| Funktion | Beschreibung | Status |
|----------|--------------|--------|
| `createLogger(component)` | Pro-Component Logger | ✅ |
| Structured Logging | JSON-Format | ✅ |
| Severity-Levels | debug, info, warn, error | ✅ |

---

## 8. Dashboard

### 8.1 Pages

**Verzeichnis:** `dashboard/src/app/`

| Page | Route | Beschreibung | Status |
|------|-------|--------------|--------|
| Home | `/` | Dashboard-Übersicht | ✅ |
| Agents | `/agents` | Agent-Grid | ✅ |
| Agent Detail | `/agents/[type]` | Agent-Details | ✅ |
| Decisions | `/decisions` | Decision-Queue | ✅ |
| Events | `/events` | Event-Log | ✅ |
| Escalations | `/escalations` | Eskalations-Management | ✅ |
| Workers | `/workers` | Worker-Activity | ✅ |
| Domains | `/domains` | Domain-Whitelist | ✅ |
| Network | `/network` | Agent-Netzwerk-Viz | ✅ |
| Kanban | `/kanban` | Kanban-Board | ✅ |
| Benchmarks | `/benchmarks` | LLM-Benchmarks | ✅ |
| Settings | `/settings` | System-Einstellungen | ✅ |

### 8.2 Components

| Component | Beschreibung | Status |
|-----------|--------------|--------|
| `DashboardLayout` | Gemeinsames Layout | ✅ |
| `SummaryCards` | KPI-Cards | ✅ |
| `HealthWidget` | Health-Status | ✅ |
| `RecentActivity` | Activity-Feed | ✅ |
| `InitiativesPanel` | Initiatives-Übersicht | ✅ |
| `FocusPanel` | Focus-Area-Management | ✅ |
| `AgentGrid` | Grid-View | ✅ |
| `AgentCard` | Individual-Card | ✅ |
| `Loading` | Loading-State | ✅ |
| `ErrorDisplay` | Error-Handling | ✅ |
| `EmptyState` | Keine-Daten-View | ✅ |

### 8.3 Hooks

| Hook | Beschreibung | Status |
|------|--------------|--------|
| `useApi` | Base-API-Client | ✅ |
| `useHealth` | Health-Updates | ✅ |
| `useAgents` | Agent-List & Details | ✅ |
| `useWorkers` | Worker-Activity | ✅ |
| `useDecisions` | Decision-Queue | ✅ |
| `useDomains` | Domain-Whitelist | ✅ |
| `useSettings` | Settings-Management | ✅ |
| `useEvents` | Event-Feed | ✅ |
| `useBenchmarks` | Benchmark-Results | ✅ |
| `useWebSocket` | WebSocket-Connection | ✅ |

---

## 9. Profiles

### 9.1 Agent-Profile-Struktur

**Verzeichnis:** `profiles/`

| Profil | Beschreibung | Loop-Interval |
|--------|--------------|---------------|
| `base.md` | Gemeinsame Basis (Merge) | - |
| `ceo.md` | Chief Executive Officer | 30min |
| `dao.md` | DAO Agent | 4h |
| `cmo.md` | Chief Marketing Officer | 2h |
| `cto.md` | Chief Technology Officer | 1h |
| `cfo.md` | Chief Financial Officer | 4h |
| `coo.md` | Chief Operations Officer | 1h |
| `cco.md` | Chief Compliance Officer | 12h |

### 9.2 Profil-Sektionen

```markdown
## Identity
- Name, Codename, Department
- Reports To, Manages

## Mission
- Kernauftrag

## Core Responsibilities
- Hauptaufgaben (nummeriert)

## Decision Authority
- Solo-Entscheidungen (Minor)
- CEO-Approval (Major)
- DAO-Vote (Critical)

## Key Metrics
- Erfolgsmessung

## Communication Style
- Ton und Stil

## Guiding Principles
- Leitprinzipien

## Loop Schedule
- Interval-Konfiguration

## Startup Prompt
- Initiales Prompt

## MCP Workers
- Verfügbare Server
```

---

## 10. Konfiguration

### 10.1 Environment Variables

**Datei:** `.env.example`

```bash
# Database
POSTGRES_URL=postgres://aito:password@localhost:5432/aito

# Redis
REDIS_URL=redis://localhost:6379

# GitHub
GITHUB_TOKEN=ghp_xxx
GITHUB_ORG=og-shibaclassic
GITHUB_REPO=shibc-workspace

# Ollama
OLLAMA_URL=http://localhost:11434

# Qdrant
QDRANT_URL=http://localhost:6333

# LLM
LLM_ROUTING_STRATEGY=claude-only
LLM_PREFER_GEMINI=false
LLM_ENABLE_FALLBACK=false

# Workspace
WORKSPACE_SKIP_PR=false
WORKSPACE_AUTO_COMMIT=true
WORKSPACE_USE_PR=true
WORKSPACE_AUTO_MERGE=false

# Safety
DRY_RUN=false

# Agents
AGENT_TYPE=ceo
AGENT_ID=auto
LOOP_ENABLED=true
LOOP_INTERVAL=3600
```

### 10.2 Database Settings

**Tabelle:** `system_settings`

| Kategorie | Key | Default | Beschreibung |
|-----------|-----|---------|--------------|
| queue | delay_critical | 0 | Immediate |
| queue | delay_urgent | 5000 | 5 Sekunden |
| queue | delay_high | 30000 | 30 Sekunden |
| queue | delay_normal | 120000 | 2 Minuten |
| queue | delay_low | 300000 | 5 Minuten |
| queue | delay_operational | 600000 | 10 Minuten |
| agents | loop_interval_ceo | 1800 | 30 Minuten |
| agents | loop_interval_dao | 14400 | 4 Stunden |
| agents | loop_interval_cmo | 7200 | 2 Stunden |
| agents | loop_interval_cto | 3600 | 1 Stunde |
| agents | loop_interval_cfo | 14400 | 4 Stunden |
| agents | loop_interval_coo | 3600 | 1 Stunde |
| agents | loop_interval_cco | 43200 | 12 Stunden |
| llm | routing_strategy | "claude-only" | LLM-Routing |
| llm | enable_fallback | false | Fallback aktivieren |
| llm | prefer_gemini | false | Gemini bevorzugen |
| decisions | timeout_minor | 14400000 | 4 Stunden |
| decisions | timeout_major | 86400000 | 24 Stunden |
| decisions | timeout_critical | 172800000 | 48 Stunden |
| escalation | timeout_critical | 14400 | 4 Stunden |
| escalation | timeout_high | 43200 | 12 Stunden |
| escalation | timeout_normal | 86400 | 24 Stunden |
| tasks | max_concurrent_per_agent | 2 | Max parallele Tasks |
| workspace | auto_commit | true | Auto-Commit |
| workspace | use_pr | true | PR-Workflow |
| workspace | auto_merge | false | Auto-Merge |
| workspace | skip_pr | false | PR überspringen |
| feedback | operational_notify_ceo | true | CEO benachrichtigen |
| feedback | broadcast_decisions | true | Broadcast Results |
| feedback | targeted_feedback | true | Targeted Feedback |
| initiative | cooldown_hours | 4 | Cooldown |
| initiative | max_per_day | 3 | Max pro Tag |
| initiative | only_on_scheduled | true | Nur bei Scheduled |

### 10.3 MCP Server Configuration

**Datei:** `.claude/mcp_servers.json`

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

---

## Appendix: Feature-Status-Übersicht

| Modul | Features | Status | Completion |
|-------|----------|--------|------------|
| Database Layer | 70+ Funktionen | ✅ Stabil | 95% |
| Agent Daemon | 40+ Funktionen | ✅ Stabil | 90% |
| Claude Wrapper | 10+ Funktionen | ✅ Stabil | 95% |
| Profile Loader | 10+ Funktionen | ✅ Stabil | 95% |
| State Management | 5 Funktionen | ✅ Stabil | 100% |
| Workspace/Git | 10+ Funktionen | ✅ Stabil | 85% |
| Initiative System | 15+ Funktionen | ✅ Stabil | 90% |
| Worker Spawner | 5 Funktionen | ✅ Stabil | 95% |
| MCP Worker | 10+ Funktionen | ⚠️ Teilweise | 75% |
| Archive Worker | 5 Funktionen | ✅ Stabil | 90% |
| Orchestrator API | 30+ Endpoints | ⚠️ Teilweise | 80% |
| WebSocket | 5 Features | ✅ Stabil | 90% |
| LLM Router | 5 Funktionen | ✅ Stabil | 95% |
| LLM Providers | 3 Provider | ✅ Stabil | 90% |
| RAG System | 10+ Funktionen | ✅ Stabil | 90% |
| Dashboard Pages | 12 Pages | ⚠️ Teilweise | 70% |
| Dashboard Hooks | 10 Hooks | ✅ Stabil | 90% |

**Gesamtstatus:** ~85% Production-Ready
