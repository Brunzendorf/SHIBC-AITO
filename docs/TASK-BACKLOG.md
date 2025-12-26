# AITO 3.0 - Task Backlog (Offene Tasks)

> **Stand:** 2025-12-25
> **Geschlossene Tasks:** [TASKS-CLOSED.md](./TASKS-CLOSED.md)

---

## Legende

| Status | Bedeutung |
|--------|-----------|
| 🔴 KRITISCH | System funktioniert nicht - sofort fixen |
| 🟠 HOCH | Wichtig für Production |
| 🟡 MITTEL | Sollte gemacht werden |

---

## 🟠 HOHE PRIORITÄT

---

### TASK-039: Low Coverage Files verbessern
**Status:** 🟠 HOCH (von früher)
**Aufwand:** 12h
**Problem:** Files mit <50% Test Coverage:
- `src/agents/daemon.ts` - 24.52%
- `src/lib/llm/gemini.ts` - 25%
- `src/lib/llm/openai.ts` - 25.44%
- `src/lib/data-fetcher.ts` - 39.42%

---

### TASK-104: Woodpecker CI/CD Setup fehlt
**Status:** 🟠 HOCH
**Entdeckt:** 2025-12-24
**Problem:**
- woodpecker-mcp ist implementiert
- ABER: Woodpecker selbst ist nicht aufgesetzt
- CTO kann keine Pipelines triggern

**Lösung:**
1. Woodpecker Server in docker-compose.yml hinzufügen
2. Woodpecker Agent konfigurieren
3. GitHub Integration einrichten
4. Erste Pipeline für AITO selbst erstellen

---

### TASK-105: Claude Execution Timeouts (5 Minuten)
**Status:** 🟠 HOCH
**Entdeckt:** 2025-12-24
**Problem:**
- Claude Loops erreichen oft 5-Minuten Timeout
- Prompt ist 11277 Zeichen lang
- Retries helfen nicht

**Symptome:**
```
Claude execution timed out after 300000ms
```

**Analyse:**
- Profile ist sehr lang (28KB für CTO)
- Viel Context (State, Kanban, RAG, Brand)
- Claude versucht zu viel auf einmal

**Lösung:**
- Prompt-Länge reduzieren
- Profile-Compression untersuchen
- Oder: Timeout erhöhen auf 10 Minuten

---

### TASK-109: Agent State Machines (Deterministische Workflows)
**Status:** 🟠 HOCH
**Entdeckt:** 2025-12-26
**Aufwand:** ~45h (13 Subtasks, 30 Workflows für 7 Agents)

**Problem:**
- Agents (besonders CTO) schreiben endlos Specs, aber bauen nichts
- Kein Durchsetzungsmechanismus für vollständige Task-Ausführung
- Context geht zwischen Loops verloren
- Agent "vergisst" unvollendete Tasks

**Lösung: Deterministische State Machines**
- Jeder Workflow ist eine Finite State Machine (FSM)
- State Machine pusht Redis Events an Agent
- Agent quittiert mit Completion-ACK
- State Machine geht zum nächsten Zustand
- Voller Projekt-Kontext bei jedem Trigger

**Architektur-Dokument:** `docs/architecture/AGENT-STATE-MACHINES.md`

**Subtasks:**

#### TASK-109.1: Database Schema
**Aufwand:** 2h
- [ ] Migration `010_state_machines.sql` erstellen
- [ ] Tabellen: `state_machines`, `state_transitions`, `state_machine_definitions`
- [ ] Indexes für Performance

#### TASK-109.2: State Machine Types
**Aufwand:** 2h
- [ ] `src/services/state-machine/types.ts` erstellen
- [ ] Interfaces: StateMachine, StateDefinition, MachineContext, StateTransition
- [ ] Event-Typen für Redis

#### TASK-109.3: State Machine Service
**Aufwand:** 8h
- [ ] `src/services/state-machine/index.ts` erstellen
- [ ] StateMachineService Klasse implementieren
- [ ] Methoden: create, transition, handleAck, getActive
- [ ] PostgreSQL Persistenz
- [ ] Redis pub/sub Integration
- [ ] Timeout-Handling mit Auto-Retry

#### TASK-109.4: Agent Daemon Integration
**Aufwand:** 4h
- [ ] Neuer Message-Typ: `state_task` in daemon.ts
- [ ] State-Context in Prompt injizieren
- [ ] `state_ack` Response-Handling
- [ ] Agent-Output zu ACK-Payload parsen

#### TASK-109.5: CEO State Machine Definitionen
**Aufwand:** 2h
- [ ] STRATEGIC_DECISION Workflow (7 States)
- [ ] INITIATIVE_LAUNCH Workflow (6 States)
- [ ] WEEKLY_REPORT Workflow (5 States)

#### TASK-109.6: CMO State Machine Definitionen
**Aufwand:** 3h
- [ ] CAMPAIGN_EXECUTION Workflow (9 States)
- [ ] CONTENT_CREATION Workflow (6 States)
- [ ] SOCIAL_RESPONSE Workflow (5 States)
- [ ] MARKET_NEWSJACKING Workflow (7 States)

#### TASK-109.7: CTO State Machine Definitionen
**Aufwand:** 4h
- [ ] BUILD_PROJECT Workflow (13 States)
- [ ] FIX_BUG Workflow (8 States)
- [ ] INFRASTRUCTURE_CHECK Workflow (5 States)
- [ ] SECURITY_INCIDENT Workflow (9 States)

#### TASK-109.8: CFO State Machine Definitionen
**Aufwand:** 3h
- [ ] TREASURY_REPORT Workflow (6 States)
- [ ] PAYMENT_PROCESSING Workflow (9 States)
- [ ] BUDGET_ALLOCATION Workflow (6 States)
- [ ] FINANCIAL_AUDIT Workflow (6 States)

#### TASK-109.9: COO State Machine Definitionen
**Aufwand:** 3h
- [ ] OPERATIONAL_REPORT Workflow (6 States)
- [ ] PROCESS_OPTIMIZATION Workflow (7 States)
- [ ] INCIDENT_MANAGEMENT Workflow (7 States)
- [ ] AGENT_HEALTH_CHECK Workflow (6 States)
- [ ] CAPACITY_PLANNING Workflow (5 States)

#### TASK-109.10: CCO State Machine Definitionen
**Aufwand:** 3h
- [ ] COMPLIANCE_REVIEW Workflow (6 States)
- [ ] POLICY_UPDATE Workflow (8 States)
- [ ] RISK_ASSESSMENT Workflow (6 States)
- [ ] AUDIT_PREPARATION Workflow (5 States)
- [ ] CONTENT_MODERATION Workflow (6 States)

#### TASK-109.11: DAO State Machine Definitionen
**Aufwand:** 3h
- [ ] PROPOSAL_LIFECYCLE Workflow (10 States)
- [ ] GOVERNANCE_REPORT Workflow (5 States)
- [ ] DELEGATE_MANAGEMENT Workflow (5 States)
- [ ] TREASURY_PROPOSAL Workflow (6 States)
- [ ] COMMUNITY_PULSE Workflow (6 States)

#### TASK-109.12: Orchestrator Integration
**Aufwand:** 3h
- [ ] State Machines aus Issues erstellen
- [ ] Automatisches Triggern bei Issue-Assignment
- [ ] Monitoring für stuck/failed Machines
- [ ] Scheduled Trigger für periodische Workflows

#### TASK-109.13: Dashboard UI
**Aufwand:** 4h
- [ ] State Machine Visualisierung (Flow-Diagramm)
- [ ] Aktueller State pro Agent
- [ ] Transition History Timeline
- [ ] Manuelles Retry/Skip (Admin)
- [ ] Workflow-Statistiken

**Akzeptanzkriterien:**
- [ ] Alle 7 Agents haben definierte Workflows (30 total)
- [ ] CTO erhält Issue → BUILD_PROJECT State Machine startet automatisch
- [ ] CMO erhält Campaign → CAMPAIGN_EXECUTION State Machine startet
- [ ] Bei Failure: Automatischer Retry im vorherigen State
- [ ] Scheduled Workflows (Treasury Report, Health Check) laufen periodisch
- [ ] Dashboard zeigt aktuellen State aller Agents
- [ ] Volle Audit-Trail aller Transitions in PostgreSQL
- [ ] Agents können nicht "steckenbleiben" - Timeout-Handling

---

## 🟡 MITTLERE PRIORITÄT

---

### TASK-106: RAG fetch failed Errors
**Status:** 🟡 MITTEL
**Entdeckt:** 2025-12-24
**Problem:**
- `RAG search failed, continuing without context`
- `fetch failed` Error in archive-worker

**Symptome:**
```
{"error":"fetch failed","msg":"RAG search failed, continuing without context"}
```

**Lösung:**
- Qdrant Verbindung prüfen
- Ollama Embedding Service prüfen
- Network zwischen Containern prüfen

---

### TASK-107: Event Logging UUID Fehler
**Status:** 🟡 MITTEL
**Entdeckt:** 2025-12-24
**Problem:**
- `eventRepo.log()` erwartet UUID für `sourceAgent`
- Aber "backlog-groomer" und "orchestrator" sind keine UUIDs
- Führt zu: `invalid input syntax for type uuid: "backlog-groomer"`

**Symptome:**
```
{"error":"invalid input syntax for type uuid: \"backlog-groomer\""}
```

**Lösung:**
- System-Agenten in DB anlegen mit festen UUIDs
- Oder: `sourceAgent` auf nullable setzen für System-Events

---

### TASK-110: daemon.ts Refactoring (2889 Zeilen → Module)
**Status:** 🟡 MITTEL
**Entdeckt:** 2025-12-26
**Aufwand:** 8-12h

**Problem:**
- `src/agents/daemon.ts` hat **2889 Zeilen** - viel zu groß
- Schwer zu testen, warten und verstehen
- Viele verschiedene Verantwortlichkeiten vermischt

**Vorgeschlagene Aufteilung:**

| Neues Modul | Zeilen (ca.) | Verantwortlichkeit |
|-------------|--------------|---------------------|
| `daemon-core.ts` | ~300 | DaemonConfig, start(), stop(), Lifecycle |
| `message-handler.ts` | ~400 | handleMessage(), shouldTriggerAI(), message queue |
| `loop-executor.ts` | ~600 | runLoop(), prompt building, AI execution |
| `action-executor.ts` | ~400 | executeActionWithRetry(), spawn_worker, tools |
| `state-machine-handler.ts` | ~250 | buildStateMachinePrompt(), sendStateAck(), parseStateOutput() |
| `worker-state-extractor.ts` | ~200 | extractAndSaveWorkerState() |
| `initiative-handler.ts` | ~200 | runAIInitiativeGeneration() |
| `stream-handlers.ts` | ~300 | setupStreamConsumers(), Redis stream logic |

**Aufgaben:**
- [ ] Module-Struktur planen
- [ ] Shared interfaces definieren
- [ ] daemon-core.ts extrahieren (Lifecycle)
- [ ] message-handler.ts extrahieren
- [ ] loop-executor.ts extrahieren
- [ ] action-executor.ts extrahieren
- [ ] state-machine-handler.ts extrahieren
- [ ] Tests für jedes Modul anpassen
- [ ] Imports in allen abhängigen Files updaten

**Akzeptanzkriterien:**
- [ ] Kein File > 500 Zeilen
- [ ] Klare Separation of Concerns
- [ ] Alle Tests passieren
- [ ] Keine Circular Dependencies

---

### TASK-111: Test Suite reparieren + State Machine Tests
**Status:** 🟡 MITTEL
**Entdeckt:** 2025-12-26
**Aufwand:** 4-6h

**Problem:**
- 6 Tests schlagen fehl (2 Test-Dateien)
- Keine Tests für neue State Machine Funktionalität (TASK-109)

**Fehlgeschlagene Tests:**
1. `src/agents/claude.test.ts` (1 Fehler)
   - `executeClaudeAgent > should execute claude with correct arguments`
   - mockSpawn Expectations stimmen nicht mehr

2. `src/agents/session-pool.test.ts` (5 Fehler)
   - `injectProfile > should send profile prompt on first injection`
   - `sendMessage > should send message and receive response`
   - `stop > should send /exit and kill process`
   - Stream/Session Mock-Probleme

**Aufgaben:**
- [ ] claude.test.ts Fehler fixen (spawn arguments anpassen)
- [ ] session-pool.test.ts Fehler fixen (Stream Mocks korrigieren)
- [ ] Neue Tests für State Machine Service schreiben:
  - [ ] StateMachineService Unit Tests
  - [ ] Daemon state_task handling Tests
  - [ ] parseStateOutput() Tests
  - [ ] sendStateAck() Tests
- [ ] Integration Tests für State Machine Workflow

**Akzeptanzkriterien:**
- [ ] Alle 1256 Tests passieren (0 Fehler)
- [ ] State Machine Service hat >80% Coverage
- [ ] Daemon state_task Integration getestet

---

## Zusammenfassung

| Priorität | Tasks | Status |
|-----------|-------|--------|
| 🔴 KRITISCH | 0 | ✅ ALLE GEFIXT |
| 🟠 HOCH | 4 | OFFEN |
| 🟡 MITTEL | 4 | OFFEN |
| **GESAMT** | **8** | **OFFEN** |

**Nächste Schritte:**
1. ~~TASK-100 fixen (Backlog Grooming)~~ ✅ DONE
2. ~~TASK-101 fixen (Urgent Queue Consumer)~~ ✅ DONE
3. ~~TASK-102 verifizieren (CTO create_project)~~ ✅ DONE
4. ~~TASK-103 Agents Issue-Zuweisung~~ ✅ DONE (via TASK-100)
5. ~~TASK-108 implementieren (Status Service)~~ ✅ DONE (2025-12-25)
6. **TASK-109 implementieren (Agent State Machines)** ← NÄCHSTER TASK
7. TASK-104 planen (Woodpecker Setup)
