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
**Aufwand:** 20-30h

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

#### TASK-109.5: CTO State Machine Definitionen
**Aufwand:** 4h
- [ ] BUILD_PROJECT Workflow (13 States)
  - IDLE → ANALYZE_ISSUE → WRITE_SPEC (optional) → CREATE_PROJECT
  - → WRITE_CODE → RUN_TESTS → COMMIT_PUSH → DEPLOY_STAGING
  - → VERIFY_STAGING → DEPLOY_PROD → COMPLETE
- [ ] FIX_BUG Workflow (8 States)
- [ ] INFRASTRUCTURE_CHECK Workflow (5 States)

#### TASK-109.6: CMO State Machine Definitionen
**Aufwand:** 3h
- [ ] CAMPAIGN_EXECUTION Workflow
- [ ] CONTENT_CREATION Workflow
- [ ] SOCIAL_MEDIA_POST Workflow

#### TASK-109.7: Orchestrator Integration
**Aufwand:** 3h
- [ ] State Machines aus Issues erstellen
- [ ] Automatisches Triggern bei Issue-Assignment
- [ ] Monitoring für stuck/failed Machines

#### TASK-109.8: Dashboard UI
**Aufwand:** 4h
- [ ] State Machine Visualisierung
- [ ] Aktueller State pro Agent
- [ ] Transition History
- [ ] Manuelles Retry/Skip (Admin)

**Akzeptanzkriterien:**
- [ ] CTO erhält Issue #726 → State Machine startet automatisch
- [ ] CTO durchläuft alle States: Analyze → Spec → Build → Test → Deploy
- [ ] Bei Test-Failure: Automatischer Retry im WRITE_CODE State
- [ ] Dashboard zeigt aktuellen State und Projekt-Kontext
- [ ] Volle Audit-Trail aller Transitions

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

## Zusammenfassung

| Priorität | Tasks | Status |
|-----------|-------|--------|
| 🔴 KRITISCH | 0 | ✅ ALLE GEFIXT |
| 🟠 HOCH | 4 | OFFEN |
| 🟡 MITTEL | 2 | OFFEN |
| **GESAMT** | **6** | **OFFEN** |

**Nächste Schritte:**
1. ~~TASK-100 fixen (Backlog Grooming)~~ ✅ DONE
2. ~~TASK-101 fixen (Urgent Queue Consumer)~~ ✅ DONE
3. ~~TASK-102 verifizieren (CTO create_project)~~ ✅ DONE
4. ~~TASK-103 Agents Issue-Zuweisung~~ ✅ DONE (via TASK-100)
5. ~~TASK-108 implementieren (Status Service)~~ ✅ DONE (2025-12-25)
6. **TASK-109 implementieren (Agent State Machines)** ← NÄCHSTER TASK
7. TASK-104 planen (Woodpecker Setup)
