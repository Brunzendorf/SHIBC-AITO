# AITO Dashboard - Web Interface für Agent Management

## Übersicht

Ein durchdachtes Web Dashboard für das AITO Agent System. Nicht "schnell", sondern nachhaltig und erweiterbar.

## Kontext

Das AITO System hat bereits eine umfangreiche REST API (20+ Endpoints). Das Dashboard soll diese visualisieren und Interaktion ermöglichen.

## Bestehende API Endpoints

### Health & Status
| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/health` | GET | Quick health check |
| `/ready` | GET | Readiness probe |
| `/health/full` | GET | Detaillierter Status aller Komponenten |

### Agent Management
| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/agents` | GET | Liste aller Agents mit Status |
| `/agents/:type` | GET | Details eines Agents |
| `/agents/:type/start` | POST | Agent starten |
| `/agents/:type/stop` | POST | Agent stoppen |
| `/agents/:type/restart` | POST | Agent neustarten |
| `/agents/:type/health` | GET | Agent Health Details |

### Events & History
| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/events` | GET | Globale Event-Liste |
| `/events/agent/:id` | GET | Events eines Agents |
| `/containers` | GET | Container-Status via Portainer |

### Tasks & Decisions
| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/tasks/agent/:id` | GET | Tasks eines Agents |
| `/tasks` | POST | Neuen Task erstellen |
| `/decisions/pending` | GET | Offene Entscheidungen |
| `/decisions/:id` | GET | Entscheidungs-Details |

### Human Escalation
| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/escalations/pending` | GET | Offene Eskalationen |
| `/escalate` | POST | Neue Eskalation erstellen |
| `/escalations/:id/respond` | POST | Auf Eskalation antworten |

### Scheduler
| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/scheduler/jobs` | GET | Geplante Jobs |

## Funktionale Anforderungen

### 1. Dashboard Overview (Priorität: HOCH)
- [ ] System Health Widget (DB, Redis, Portainer Status)
- [ ] Agent Grid mit Status-Karten (7 Agents)
- [ ] Ressourcen-Verbrauch (Memory, CPU pro Agent)
- [ ] Aktive Tasks Counter
- [ ] Pending Decisions Counter
- [ ] Pending Escalations Counter (mit Alert)

### 2. Agent Detail View (Priorität: HOCH)
- [ ] Agent Info (Name, Type, Profile, Loop Interval)
- [ ] Current State (aus agent_state Tabelle)
- [ ] Recent History (aus agent_history Tabelle)
- [ ] Events Timeline
- [ ] Start/Stop/Restart Buttons
- [ ] Container Logs (letzte N Zeilen)

### 3. Decision Center (Priorität: HOCH)
- [ ] Liste offener Entscheidungen
- [ ] Entscheidungs-Details mit Kontext
- [ ] Veto-Status (CEO/DAO/C-Level)
- [ ] Approve/Reject Interface
- [ ] Decision History

### 4. Escalation Interface (Priorität: KRITISCH)
- [ ] Prominent Alert für offene Eskalationen
- [ ] Eskalations-Details mit vollem Kontext
- [ ] Response-Formular
- [ ] Timeout-Countdown
- [ ] Eskalations-History

### 5. Event Log (Priorität: MITTEL)
- [ ] Filterbarer Event Stream
- [ ] Filter nach Agent, Event-Type, Zeitraum
- [ ] Event Details Modal
- [ ] Export-Funktion

### 6. Task Management (Priorität: MITTEL)
- [ ] Task-Liste pro Agent
- [ ] Task-Status Tracking
- [ ] Manuelles Task erstellen
- [ ] Task-History

### 7. Realtime Updates (Priorität: HOCH)
- [ ] WebSocket oder Server-Sent Events
- [ ] Live Agent Status Updates
- [ ] Notification bei neuen Escalations
- [ ] Toast Messages für wichtige Events

## Nicht-Funktionale Anforderungen

### Technologie-Stack Optionen

**Option A: Statisches HTML + Vanilla JS**
- Pro: Keine Build-Tools, einfach zu deployen
- Contra: Weniger Struktur bei wachsender Komplexität
- Beispiel: `SHIBA Classic/aito-system/dashboard/index.html`

**Option B: React/Next.js**
- Pro: Komponenten-Struktur, TypeScript, SSR möglich
- Contra: Build-Prozess, mehr Setup
- Beispiel: `SHIBA Classic/ai-ceo-dashboard/`

**Option C: Vue.js + Vite**
- Pro: Leichtgewichtig, schneller Start
- Contra: Weiteres Framework im Stack

**Empfehlung:** Option B (Next.js) - Konsistent mit shiba-classic-website

### Design Requirements
- Dark Mode (konsistent mit bestehendem Dashboard)
- Responsive (Desktop + Tablet)
- Accessibility (WCAG 2.1 AA)
- Shiba Classic Branding (Gold/Dunkel Theme)

### Performance
- Initial Load < 3s
- API Response Caching
- Lazy Loading für History/Events
- Pagination für Listen (50 items default)

### Security
- CORS konfiguriert für Frontend Domain
- Rate Limiting auf API
- Optional: Basic Auth oder API Key

## Datenquellen

### Postgres Tabellen
| Tabelle | Beschreibung |
|---------|--------------|
| `agents` | Agent Definitionen |
| `agent_state` | Persistenter State pro Agent |
| `agent_history` | Aktions-History mit Summary |
| `events` | Event Log |
| `decisions` | Entscheidungen + Veto Status |
| `tasks` | Task Queue |
| `escalations` | Human Escalations |

### Redis
| Key Pattern | Beschreibung |
|-------------|--------------|
| `agent:status:{id}` | Live Status |
| `channel:*` | Pub/Sub für WebSocket |

## UI Mockup

```
┌──────────────────────────────────────────────────────────────┐
│  🤖 AITO Dashboard                    [🔔 2] [Settings]     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│  │ System  │ │ Agents  │ │ Pending │ │ Escal.  │            │
│  │ HEALTHY │ │  7/7 ✅ │ │ Dec: 0  │ │ ⚠️ 1    │            │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘            │
│                                                              │
│  AGENTS                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ 👔 CEO   │ │ 🏛️ DAO   │ │ 📢 CMO   │ │ 💻 CTO   │        │
│  │ active   │ │ init     │ │ active   │ │ active   │        │
│  │ 24MB     │ │ 24MB     │ │ 26MB     │ │ 24MB     │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│  │ 💰 CFO   │ │ ⚙️ COO   │ │ 📋 CCO   │                     │
│  │ ready    │ │ oper.    │ │ active   │                     │
│  │ 24MB     │ │ 25MB     │ │ 24MB     │                     │
│  └──────────┘ └──────────┘ └──────────┘                     │
│                                                              │
│  RECENT ACTIVITY                                   [View All]│
│  ───────────────────────────────────────────────────────────│
│  09:40 CTO  decision  Codebase analysiert                   │
│  09:40 CFO  decision  7 Agent-Profile gefunden              │
│  09:40 CMO  decision  Marketing-Infra existiert nicht       │
│  09:40 CCO  decision  KRITISCH: Keine Compliance-Doku       │
│  09:40 DAO  decision  Governance konfiguriert               │
└──────────────────────────────────────────────────────────────┘
```

## Akzeptanzkriterien

- [ ] Dashboard zeigt alle 7 Agents mit Live-Status
- [ ] Agent Details sind einsehbar (State, History)
- [ ] Escalations können beantwortet werden
- [ ] Events/History sind filterbar
- [ ] Responsive auf Desktop und Tablet
- [ ] Dark Mode funktioniert
- [ ] API-Fehler werden benutzerfreundlich angezeigt

## Implementierungs-Phasen

| Phase | Beschreibung |
|-------|--------------|
| 1 | Setup + Dashboard Overview |
| 2 | Agent Detail View |
| 3 | Decision + Escalation Center |
| 4 | Event Log + Task Management |
| 5 | Realtime Updates (WebSocket) |
| 6 | Polish + Testing |

## Referenzen

- Bestehendes Dashboard: `SHIBA Classic/aito-system/dashboard/index.html`
- AI CEO Dashboard: `SHIBA Classic/ai-ceo-dashboard/`
- Orchestrator API: `SHIBC-AITO/src/orchestrator/api.ts`
