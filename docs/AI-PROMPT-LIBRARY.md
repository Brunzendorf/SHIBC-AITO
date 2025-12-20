# AI Prompt Library - AITO Development Guide

> **Zweck:** Strukturierte Prompts für AI-Assistenten zur Arbeit am AITO-Projekt
> **Verwendung:** Kopiere den passenden Prompt-Block und passe die `[PLACEHOLDER]` an
> **Letzte Aktualisierung:** 2025-12-20

---

## Inhaltsverzeichnis

1. [Projekt-Onboarding](#1-projekt-onboarding)
2. [Feature-Implementierung](#2-feature-implementierung)
3. [Bug-Fixing](#3-bug-fixing)
4. [Code-Review](#4-code-review)
5. [Dokumentation](#5-dokumentation)
6. [Testing](#6-testing)
7. [Refactoring](#7-refactoring)
8. [Modul-spezifische Prompts](#8-modul-spezifische-prompts)

---

## 1. Projekt-Onboarding

### 1.1 Projekt verstehen

```
Ich arbeite am AITO-Projekt (AI Team Orchestrator für Shiba Classic).

Bitte lies folgende Dokumentation um das Projekt zu verstehen:
1. docs/README.md - Dokumentationsübersicht
2. docs/AITO-3.0-COMPLETE.md - Vollständige Systemdoku
3. docs/ARCHITECTURE.md - Architektur-Übersicht
4. CLAUDE.md - Projekt-Instruktionen

Fasse danach die Kernkonzepte zusammen:
- Was macht das System?
- Welche Komponenten gibt es?
- Wie kommunizieren Agents?
```

### 1.2 Codebase erkunden

```
Erkunde die AITO-Codebase und erstelle eine Übersicht:

1. Lies src/agents/daemon.ts - Agent-Hauptlogik
2. Lies src/orchestrator/api.ts - REST API
3. Lies src/workers/worker.ts - MCP Worker
4. Lies dashboard/src/lib/api.ts - Dashboard API Client

Zeige mir die wichtigsten Funktionen und wie sie zusammenhängen.
```

---

## 2. Feature-Implementierung

### 2.1 Neues Feature planen

```
Ich möchte folgendes Feature implementieren: [FEATURE_BESCHREIBUNG]

Bitte:
1. Lies die relevante Dokumentation:
   - docs/features/[RELEVANTES_MODUL].md
   - docs/TASK-BACKLOG.md (falls bereits als Task erfasst)

2. Analysiere den bestehenden Code in:
   - [RELEVANTE_DATEIEN]

3. Erstelle einen Implementierungsplan:
   - Welche Dateien müssen geändert werden?
   - Welche neuen Dateien brauchen wir?
   - Gibt es Breaking Changes?
   - Welche Tests werden benötigt?

4. Nach der Implementierung:
   - docs/features/[MODUL].md aktualisieren
   - docs/FEATURE-REFERENCE.md ergänzen
   - Falls neuer Task: docs/TASK-BACKLOG.md aktualisieren
```

### 2.2 Feature aus Backlog umsetzen

```
Setze Task [TASK-XXX] aus docs/TASK-BACKLOG.md um.

Schritte:
1. Lies docs/TASK-BACKLOG.md und finde TASK-XXX
2. Lies die referenzierte Datei und verstehe das Problem
3. Lies die zugehörige Feature-Dokumentation in docs/features/
4. Implementiere den Fix/das Feature
5. Schreibe Tests
6. Aktualisiere die Dokumentation:
   - Status in TASK-BACKLOG.md auf "erledigt" setzen
   - Feature-Doku aktualisieren falls nötig
```

### 2.3 API-Endpoint hinzufügen

```
Füge einen neuen API-Endpoint hinzu: [ENDPOINT_BESCHREIBUNG]

Referenz-Dokumentation:
- docs/features/04-ORCHESTRATOR.md - API-Patterns
- docs/API.md - Endpoint-Übersicht

Implementierung:
1. Endpoint in src/orchestrator/api.ts hinzufügen
2. Types in relevanter Datei definieren
3. Dashboard API-Client erweitern: dashboard/src/lib/api.ts
4. Hook erstellen falls nötig: dashboard/src/hooks/

Dokumentation aktualisieren:
- docs/features/04-ORCHESTRATOR.md
- docs/API.md
- docs/features/06-DASHBOARD.md (falls Dashboard-Integration)
```

### 2.4 Agent-Action hinzufügen

```
Füge eine neue Agent-Action hinzu: [ACTION_NAME]

Referenz:
- docs/features/02-AGENT-SYSTEM.md - Action-Typen
- src/agents/daemon.ts - processAction()

Implementierung:
1. Action-Type in src/lib/types.ts definieren
2. Handler in src/agents/daemon.ts:processAction() hinzufügen
3. Profile-Dokumentation in profiles/*.md erweitern
4. Tests in tests/daemon.test.ts hinzufügen

Dokumentation:
- docs/features/02-AGENT-SYSTEM.md aktualisieren
- Action zur Liste hinzufügen mit Signatur und Beispiel
```

---

## 3. Bug-Fixing

### 3.1 Bug analysieren und fixen

```
Analysiere und fixe folgenden Bug: [BUG_BESCHREIBUNG]

Schritte:
1. Reproduziere das Problem (wenn möglich)
2. Lies relevante Logs/Fehlermeldungen
3. Finde die Ursache im Code
4. Prüfe docs/TASK-BACKLOG.md ob Bug bereits erfasst
5. Implementiere den Fix
6. Schreibe Regression-Test
7. Aktualisiere TASK-BACKLOG.md falls dort gelistet
```

### 3.2 Race Condition fixen

```
Fixe eine Race Condition in: [DATEI/FUNKTION]

Referenz:
- docs/features/02-AGENT-SYSTEM.md - Concurrency-Patterns
- TASK-001, TASK-002 in docs/TASK-BACKLOG.md

Analyse:
1. Identifiziere shared state
2. Finde concurrent access points
3. Wähle Locking-Strategie (Mutex, Semaphore, Queue)

Implementierung:
1. Atomic operations verwenden
2. Redis MULTI/EXEC für Transaktionen
3. Tests für concurrent scenarios
```

---

## 4. Code-Review

### 4.1 Änderungen reviewen

```
Reviewe die Änderungen in: [DATEIEN/PR]

Prüfe:
1. Code-Qualität und TypeScript-Typen
2. Error Handling (null checks, try/catch)
3. Security (keine Secrets geloggt, Input-Validation)
4. Performance (keine unbounded queries, caching)
5. Dokumentation aktualisiert?
6. Tests vorhanden?

Referenz für Standards:
- docs/features/ für Modul-Patterns
- CLAUDE.md für Projekt-Konventionen
```

### 4.2 Security-Review

```
Führe ein Security-Review durch für: [BEREICH]

Checklist (basierend auf TASK-BACKLOG.md):
- [ ] Keine Secrets in Logs (TASK-035)
- [ ] Input-Validation (TASK-024)
- [ ] Rate Limiting (TASK-023)
- [ ] Authentication (TASK-022)
- [ ] Domain Whitelist enforced (TASK-018)
- [ ] Token-Masking (TASK-014)

Referenz:
- docs/TASK-BACKLOG.md - Security-Tasks markiert mit ⚠️
```

---

## 5. Dokumentation

### 5.1 Feature-Dokumentation aktualisieren

```
Aktualisiere die Dokumentation für: [FEATURE/MODUL]

Dateien:
- docs/features/[01-06]-[MODUL].md - Detaillierte Doku
- docs/FEATURE-REFERENCE.md - Übersicht
- docs/README.md - Falls neue Doku-Datei

Format für Feature-Doku:
- Funktions-Signatur
- Parameter mit Types
- Rückgabe-Wert
- Beispiel-Code
- Bekannte Probleme (mit TASK-ID)
- Status (% Production-Ready)
```

### 5.2 Neuen Task dokumentieren

```
Dokumentiere einen neuen Task/Bug in docs/TASK-BACKLOG.md:

Format:
#### TASK-XXX: [Titel]
**Status:** [🐛 BUG | ⚠️ SECURITY | 🔧 IMPROVEMENT | ✨ FEATURE]
**Priorität:** [🔴 KRITISCH | 🟠 HOCH | 🟡 MITTEL | 🟢 NIEDRIG]
**Aufwand:** [Xh]
**Datei:** [Pfad:Zeile]

**Problem:**
[Beschreibung]

**Fix:**
[Lösungsvorschlag]

Aktualisiere auch die Zusammenfassung am Ende der Datei.
```

### 5.3 API-Dokumentation erweitern

```
Dokumentiere API-Endpoint in docs/API.md und docs/features/04-ORCHESTRATOR.md:

Format:
#### `[METHOD] /[endpoint]`
[Beschreibung]

**Query-Parameter:**
| Parameter | Typ | Default | Beschreibung |
|-----------|-----|---------|--------------|

**Body:**
```json
{
  "field": "type"
}
```

**Response:**
```json
{
  "field": "value"
}
```

**Status:** ✅ Implementiert
```

---

## 6. Testing

### 6.1 Unit-Tests schreiben

```
Schreibe Unit-Tests für: [FUNKTION/MODUL]

Referenz:
- Existierende Tests in tests/
- Vitest als Test-Framework

Test-Kategorien:
1. Happy Path - Normaler Ablauf
2. Edge Cases - Grenzwerte, leere Arrays
3. Error Cases - Fehlerhafte Inputs
4. Async - Timeouts, Race Conditions

Datei: tests/[modul].test.ts
```

### 6.2 Integration-Test schreiben

```
Schreibe Integration-Test für: [WORKFLOW]

Setup:
- Docker Compose für DB/Redis
- Test-Fixtures für Agents

Test-Flow:
1. Setup: DB/Redis initialisieren
2. Action: [Workflow ausführen]
3. Assert: Erwartetes Ergebnis prüfen
4. Cleanup: Test-Daten entfernen
```

---

## 7. Refactoring

### 7.1 Code refactoren

```
Refactore: [CODE_BEREICH]

Ziel: [VERBESSERUNG]

Schritte:
1. Verstehe aktuellen Code vollständig
2. Schreibe Tests für aktuelles Verhalten (falls nicht vorhanden)
3. Refactore in kleinen Schritten
4. Tests nach jedem Schritt ausführen
5. Dokumentation aktualisieren

WICHTIG: Keine funktionalen Änderungen - nur Struktur!
```

### 7.2 Performance optimieren

```
Optimiere Performance in: [BEREICH]

Analyse:
1. Identifiziere Bottleneck
2. Messe aktuelle Performance
3. Implementiere Optimierung
4. Messe erneut

Häufige Patterns:
- Caching mit Redis (TTL beachten)
- Lazy Loading statt eager
- Pagination für große Listen
- Index auf DB-Spalten
```

---

## 8. Modul-spezifische Prompts

### 8.1 Database Layer

```
Arbeite am Database Layer:

Dokumentation: docs/features/01-DATABASE-LAYER.md
Code: src/lib/db.ts, src/lib/repositories/

Patterns:
- Repository-Pattern für alle DB-Zugriffe
- Prepared Statements gegen SQL Injection
- Transaktionen mit client.query('BEGIN'/'COMMIT')
- Volatile State für temporäre Daten (TTL)
```

### 8.2 Agent System

```
Arbeite am Agent System:

Dokumentation: docs/features/02-AGENT-SYSTEM.md
Code: src/agents/

Kernkonzepte:
- daemon.ts - Agent-Lifecycle
- claude.ts - LLM-Integration
- profile.ts - Markdown-Profile laden
- state.ts - Redis State Management
- initiative.ts - Autonome Vorschläge
- workspace.ts - Git-Operations
```

### 8.3 Worker System

```
Arbeite am Worker System:

Dokumentation: docs/features/03-WORKER-SYSTEM.md
Code: src/workers/

Kernkonzepte:
- spawner.ts - Worker starten
- worker.ts - MCP-Tool-Ausführung
- Domain Whitelist für Security
- DRY_RUN Mode für Tests
```

### 8.4 Orchestrator

```
Arbeite am Orchestrator:

Dokumentation: docs/features/04-ORCHESTRATOR.md
Code: src/orchestrator/

Kernkonzepte:
- api.ts - Express REST API
- websocket.ts - Real-time Updates
- health.ts - System-Health
- container.ts - Docker-Management
- scheduler.ts - Cron Jobs
```

### 8.5 LLM System

```
Arbeite am LLM System:

Dokumentation: docs/features/05-LLM-SYSTEM.md
Code: src/lib/llm/

Kernkonzepte:
- router.ts - Provider-Auswahl
- claude-provider.ts - Claude CLI
- gemini.ts - Gemini CLI
- models.ts - Model-Tiers
- quota.ts - Usage Tracking
- benchmark.ts - Model-Vergleich
```

### 8.6 Dashboard

```
Arbeite am Dashboard:

Dokumentation: docs/features/06-DASHBOARD.md
Code: dashboard/src/

Kernkonzepte:
- lib/api.ts - API Client
- hooks/ - SWR Data Fetching
- app/ - Next.js Pages
- components/ - React Components
```

---

## Quick Reference: Dokumentations-Dateien

| Modul | Feature-Doku | Code |
|-------|--------------|------|
| Database | `docs/features/01-DATABASE-LAYER.md` | `src/lib/db.ts` |
| Agents | `docs/features/02-AGENT-SYSTEM.md` | `src/agents/` |
| Workers | `docs/features/03-WORKER-SYSTEM.md` | `src/workers/` |
| Orchestrator | `docs/features/04-ORCHESTRATOR.md` | `src/orchestrator/` |
| LLM | `docs/features/05-LLM-SYSTEM.md` | `src/lib/llm/` |
| Dashboard | `docs/features/06-DASHBOARD.md` | `dashboard/src/` |

---

## Checkliste nach Feature-Implementierung

```
Nach Abschluss eines Features/Fixes:

[ ] Code implementiert und getestet
[ ] TypeScript-Typen korrekt
[ ] Error Handling vorhanden
[ ] Keine Security-Issues
[ ] docs/features/[MODUL].md aktualisiert
[ ] docs/FEATURE-REFERENCE.md aktualisiert (falls neues Feature)
[ ] docs/TASK-BACKLOG.md aktualisiert (falls Task geschlossen)
[ ] Tests geschrieben
[ ] CHANGELOG.md ergänzt (falls major change)
```

---

## Standard-Workflow für Feature-Implementierung

### Der 7-Phasen-Workflow

Jede Feature-Implementierung folgt diesem strukturierten Ablauf:

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: PLANEN                                                │
│  ─────────────────                                              │
│  • Task/Feature-Anforderung verstehen                          │
│  • Scope definieren                                            │
│  • Abhängigkeiten identifizieren                               │
│  • Grobe Aufwandsschätzung                                     │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: DOKUMENTATION FINDEN                                  │
│  ─────────────────────────────                                  │
│  • docs/TASK-BACKLOG.md - Ist Task bereits erfasst?            │
│  • docs/features/[MODUL].md - Wie funktioniert das Modul?      │
│  • docs/FEATURE-REFERENCE.md - Was gibt es bereits?            │
│  • Relevanten Code identifizieren                              │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 3: ANALYSIEREN                                           │
│  ────────────────────                                           │
│  • Bestehenden Code lesen und verstehen                        │
│  • Patterns und Konventionen erkennen                          │
│  • Potenzielle Probleme identifizieren                         │
│  • Implementierungsplan erstellen                              │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 4: IMPLEMENTIEREN                                        │
│  ───────────────────────                                        │
│  • Code schreiben (kleine Commits!)                            │
│  • TypeScript-Typen korrekt                                    │
│  • Error Handling einbauen                                     │
│  • Security beachten                                           │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 5: TESTEN                                                │
│  ───────────────                                                │
│  • Unit-Tests schreiben/aktualisieren                          │
│  • Manuell testen (curl, Dashboard, etc.)                      │
│  • Edge Cases prüfen                                           │
│  • npm run test / npm run typecheck                            │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 6: DOKUMENTATION AKTUALISIEREN                           │
│  ────────────────────────────────────                           │
│  • docs/features/[MODUL].md aktualisieren                      │
│  • docs/FEATURE-REFERENCE.md ergänzen                          │
│  • API.md falls neuer Endpoint                                 │
│  • Inline-Kommentare wo nötig                                  │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 7: FINALISIEREN & ISSUE ABHAKEN                          │
│  ─────────────────────────────────────                          │
│  • docs/TASK-BACKLOG.md: Task als ✅ erledigt markieren        │
│  • GitHub Issue schließen (falls vorhanden)                    │
│  • Commit mit TASK-ID: "feat: ... (TASK-XXX)"                  │
│  • PR erstellen falls nötig                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Master-Prompt für Feature-Implementierung

Verwende diesen Prompt für jede Feature-Anfrage:

```
Implementiere: [FEATURE/TASK_BESCHREIBUNG]

Folge dem 7-Phasen-Workflow:

## PHASE 1: PLANEN
- Was genau soll umgesetzt werden?
- Welche Komponenten sind betroffen?

## PHASE 2: DOKUMENTATION FINDEN
Lies folgende Dateien:
- docs/TASK-BACKLOG.md - Prüfe ob als Task erfasst
- docs/features/[RELEVANTES_MODUL].md - Modul-Dokumentation
- docs/FEATURE-REFERENCE.md - Feature-Übersicht

## PHASE 3: ANALYSIEREN
- Lies den relevanten Quellcode
- Verstehe bestehende Patterns
- Erstelle Implementierungsplan

## PHASE 4: IMPLEMENTIEREN
- Schreibe den Code
- Halte dich an bestehende Konventionen
- Kleine, atomare Änderungen

## PHASE 5: TESTEN
- Schreibe/aktualisiere Tests
- Führe npm run test aus
- Teste manuell

## PHASE 6: DOKUMENTATION AKTUALISIEREN
- Update docs/features/[MODUL].md
- Update weitere relevante Docs

## PHASE 7: FINALISIEREN
- Markiere Task in docs/TASK-BACKLOG.md als erledigt
- Erstelle Commit mit TASK-ID im Message
- Fasse zusammen was gemacht wurde
```

---

## Task-Abhaken Format

Wenn ein Task aus dem Backlog erledigt ist, ändere das Format:

**Vorher:**
```markdown
#### TASK-022: Keine Authentication
**Status:** ⚠️ SECURITY
**Aufwand:** 6h
```

**Nachher:**
```markdown
#### ✅ TASK-022: Keine Authentication [ERLEDIGT]
**Status:** ⚠️ SECURITY → ✅ FIXED
**Aufwand:** 6h
**Erledigt:** 2025-12-20
**Commit:** abc123 - feat: Add API authentication
```

---

## Beispiel: Kompletter Workflow

```
User: "Implementiere TASK-003 (Parser null-check)"

=== PHASE 1: PLANEN ===
Task: Parser-Output nicht robust - fehlender null-check
Scope: Kleine Änderung in daemon.ts
Aufwand: ~1h

=== PHASE 2: DOKUMENTATION FINDEN ===
✓ docs/TASK-BACKLOG.md gelesen - TASK-003 gefunden
✓ docs/features/02-AGENT-SYSTEM.md gelesen - Parser-Sektion
✓ Datei: src/agents/daemon.ts:701-731

=== PHASE 3: ANALYSIEREN ===
Problem:
- parseClaudeOutput() kann null zurückgeben
- Kein null-check vor Zugriff auf parsed.stateUpdates
- Runtime Error: "Cannot read property of null"

Lösung:
- Optional chaining: parsed?.stateUpdates

=== PHASE 4: IMPLEMENTIEREN ===
Edit: src/agents/daemon.ts
- Zeile 705: if (parsed.stateUpdates) → if (parsed?.stateUpdates)
- Zeile 710: if (parsed.messages) → if (parsed?.messages)
- Zeile 715: if (parsed.actions) → if (parsed?.actions)

=== PHASE 5: TESTEN ===
✓ npm run typecheck - OK
✓ npm run test - OK
✓ Manueller Test mit leerem Claude Output - OK

=== PHASE 6: DOKUMENTATION ===
✓ docs/features/02-AGENT-SYSTEM.md - "Bekannte Probleme" aktualisiert

=== PHASE 7: FINALISIEREN ===
✓ docs/TASK-BACKLOG.md - TASK-003 als erledigt markiert
✓ Commit: "fix: Add null-check to parseClaudeOutput (TASK-003)"

Zusammenfassung:
- Parser ist jetzt robust gegen null-Rückgabe
- 3 Zeilen geändert
- Tests bestanden
- Dokumentation aktualisiert
- TASK-003 geschlossen
```

---

## Quick-Prompts für häufige Aufgaben

### Bug fixen (schnell)

```
Fixe TASK-[XXX] aus docs/TASK-BACKLOG.md.

Workflow: Doku lesen → Code analysieren → Fix implementieren →
         Testen → Doku updaten → Task abhaken → Commit
```

### Feature hinzufügen (kurz)

```
Implementiere: [FEATURE]
Modul: [agents/workers/orchestrator/dashboard/llm/database]

Workflow: Planen → docs/features/[MODUL].md lesen →
         Implementieren → Testen → Doku updaten → Commit
```

### Code Review

```
Review die Änderungen in [DATEIEN].
Prüfe: Types, Error Handling, Security, Tests, Doku-Updates.
Referenz: docs/features/ für Patterns.
```

### Nach Session fortsetzen

```
Lies docs/TASK-BACKLOG.md und zeige:
1. Welche Tasks sind noch offen?
2. Was wurde zuletzt bearbeitet?
3. Was sollte als nächstes angegangen werden?
```
