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

### TASK-108: Agent Status Service (Workspace/Issue Pollution reduzieren)
**Status:** 🟠 HOCH
**Entdeckt:** 2025-12-25
**Aufwand:** ~8h
**Planungsdokument:** [STATUS-SERVICE-PLAN.md](./STATUS-SERVICE-PLAN.md)

**Problem:**
Agents erzeugen massenhaft "Beweis"-Dateien und Issues um zu zeigen dass sie arbeiten:

*Workspace-Pollution:*
```
/SHIBC-CEO-001/ceo-loop-379-christmas-ops.md
/SHIBC-CEO-001/ceo-loop-383-christmas-status.md
/SHIBC-CMO-001/logs/loop_106.md
... (50+ Dateien pro Agent)
```

*GitHub Issue-Pollution:*
- 30+ "Proof/Certificate/Evidence" Issues
- 31 vage Epics ohne Substanz
- Buzzword-Spam: "governance" 65x, "institutional" 54x

**Ursache:**
Agents wollen dem Kollektiv zeigen "Ich arbeite!" - aber kein sauberer Kanal dafür.

**Lösung: Dedizierter Status-Service**

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Dashboard  │◄────│  Status Service │◄────│   Agents     │
│  (Next.js)  │ WS  │  (Node.js)      │ MCP │  (CEO, CMO,  │
│             │     │                 │     │   CTO, ...)  │
└─────────────┘     └────────┬────────┘     └──────────────┘
                             │
                    ┌────────▼────────┐
                    │   PostgreSQL    │
                    │  agent_status   │
                    │  agent_heartbeat│
                    └─────────────────┘
```

**Datenbank-Schema:**
```sql
CREATE TABLE agent_status (
  id SERIAL PRIMARY KEY,
  agent_type VARCHAR(10) NOT NULL,
  loop_number INTEGER NOT NULL,
  status_type VARCHAR(20) NOT NULL,       -- working, idle, blocked
  activity TEXT NOT NULL,                 -- "Executing webinar planning"
  details JSONB,
  issue_ref INTEGER,                      -- Optional: GitHub Issue #
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE agent_heartbeat (
  agent_type VARCHAR(10) PRIMARY KEY,
  loop_number INTEGER NOT NULL,
  last_seen TIMESTAMP DEFAULT NOW(),
  current_status VARCHAR(20) DEFAULT 'idle',
  current_activity TEXT
);
```

**MCP Tools:**
| Tool | Beschreibung |
|------|--------------|
| `post_status` | Agent postet aktuellen Status |
| `get_team_status` | Agent sieht Team-Status |
| `get_my_history` | Agent sieht eigene Historie |

**Implementation Phasen:**

| Phase | Aufgabe | Aufwand |
|-------|---------|---------|
| 1 | Status Service (Node.js + PostgreSQL + WebSocket) | 2-3h |
| 2 | Status MCP (`mcp-servers/status-mcp/`) | 1-2h |
| 3 | Agent Integration (`daemon.ts` Loop-Calls) | 1h |
| 4 | Dashboard (`AgentStatusBoard` Komponente) | 2h |
| 5 | Cleanup (alte Files/Issues löschen) | 1h |

**Erwartete Verbesserungen:**

| Bereich | Vorher | Nachher |
|---------|--------|---------|
| Loop-Dateien/Agent | ~50+ | 0 |
| "Proof" GitHub Issues | 30+ | 0 |
| Status-Sichtbarkeit | Keine | Real-time Dashboard |
| Uptime-Beweis | Manuell | Automatisch via API |

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
5. TASK-108 implementieren (Status Service - reduziert Issue/Workspace Spam)
6. TASK-104 planen (Woodpecker Setup)
