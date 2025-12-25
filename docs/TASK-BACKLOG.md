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
| 🟠 HOCH | 3 | OFFEN |
| 🟡 MITTEL | 2 | OFFEN |
| **GESAMT** | **5** | **OFFEN** |

**Nächste Schritte:**
1. ~~TASK-100 fixen (Backlog Grooming)~~ ✅ DONE
2. ~~TASK-101 fixen (Urgent Queue Consumer)~~ ✅ DONE
3. ~~TASK-102 verifizieren (CTO create_project)~~ ✅ DONE
4. ~~TASK-103 Agents Issue-Zuweisung~~ ✅ DONE (via TASK-100)
5. ~~TASK-108 implementieren (Status Service)~~ ✅ DONE (2025-12-25)
6. TASK-104 planen (Woodpecker Setup)
