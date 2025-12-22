# Feature: Project Planning Dashboard

## Overview

Multi-Project Portfolio Management System for AITO Agents. Ermöglicht die Planung, Koordination und Ressourcenverteilung von Agent-Initiativen.

## Inspiration & Best Practices

Basierend auf Recherche von:
- [Project Portfolio Management Guide](https://www.projectmanager.com/guides/project-portfolio-management)
- [PMO Dashboard Examples](https://triskellsoftware.com/blog/pmo-dashboards/)
- [Multiple Project Dashboard Guide](https://www.wrike.com/blog/multiple-project-dashboard/)
- [SVAR React Gantt](https://svar.dev/react/gantt/) - Open Source, React 19 kompatibel

---

## Feature-Komponenten

### 1. Portfolio Overview Dashboard (`/projects`)

**Headline-Statistiken:**
- Aktive Projekte (nach Status)
- Gesamtfortschritt aller Projekte
- Token-Budget verbraucht vs. verfügbar
- Nächste Deadlines

**Projekt-Karten:**
```
┌─────────────────────────────────────────────────┐
│ 🎯 Q1 Marketing Campaign                   CEO  │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 65%        │
│                                                 │
│ Phase: Execution    Due: 2025-01-15            │
│ Budget: 50K Tokens  Used: 32K (64%)            │
│                                                 │
│ Tasks: 12/18 done   Agents: CMO, CCO, CTO      │
└─────────────────────────────────────────────────┘
```

### 2. Dependency & Complexity View (`/projects/flow`)

**Keine Zeitschätzungen!** AI arbeitet nicht in "Stunden" oder "Tagen".

**Stattdessen: Token-Budget & Story Points**

```
┌─────────────────────────────────────────────────────────────┐
│  Complexity-based Planning (nicht Zeit-basiert!)           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Story Points = Komplexität (nicht Zeit!)                   │
│  ─────────────────────────────────────────                  │
│  XS (1 SP) = ~2.000 Tokens   (trivial, 1 Datei)            │
│  S  (2 SP) = ~5.000 Tokens   (einfach, wenige Dateien)     │
│  M  (3 SP) = ~15.000 Tokens  (mittel, mehrere Komponenten) │
│  L  (5 SP) = ~40.000 Tokens  (komplex, viele Abhängigkeiten)│
│  XL (8 SP) = ~100.000 Tokens (sehr komplex, Refactoring)   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Dependency Flow (statt Gantt):**
```
┌──────────────────────────────────────────────────────────────┐
│                    Voting Feature Flow                        │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     │
│  │ Smart       │────►│ Voting UI   │────►│ Announcement│     │
│  │ Contract    │     │             │     │             │     │
│  ├─────────────┤     ├─────────────┤     ├─────────────┤     │
│  │ CTO         │     │ CTO         │     │ CMO         │     │
│  │ L (5 SP)    │     │ M (3 SP)    │     │ S (2 SP)    │     │
│  │ ~40K Tokens │     │ ~15K Tokens │     │ ~5K Tokens  │     │
│  │ ████████░░  │     │ ░░░░░░░░░░  │     │ ░░░░░░░░░░  │     │
│  │ 80%         │     │ BLOCKED     │     │ BLOCKED     │     │
│  └─────────────┘     └─────────────┘     └─────────────┘     │
│                                                               │
│  Total: 10 SP | ~60K Tokens | 3 Dependencies                 │
└──────────────────────────────────────────────────────────────┘
```

**Vorteile:**
- Keine sinnlosen Zeitschätzungen
- Token = echte Ressource die wir tracken
- Story Points = Komplexität, nicht Dauer
- Fokus auf Dependencies, nicht auf Kalender

### 3. Kalender View (`/projects/calendar`)

**Geplante Events:**
- Social Media Posts (Twitter, Telegram)
- AMAs & Community Events
- Release Deadlines
- Milestones

**Kalender-Ansichten:**
- Monatsansicht (Grid)
- Wochenansicht (Detailed)
- Agenda (Liste kommender Events)

**Farbcodierung nach Agent:**
```
CEO: #FFD700 (Gold)
CMO: #E74C3C (Rot)
CTO: #3498DB (Blau)
CFO: #2ECC71 (Grün)
COO: #F39C12 (Orange)
CCO: #1ABC9C (Türkis)
DAO: #9B59B6 (Lila)
```

### 4. Resource Allocation (`/projects/resources`)

**Token-Budget-Verteilung:**
```
┌─────────────────────────────────────────────────┐
│ Tägliches Token-Budget: 1,000,000               │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                 │
│ Marketing Campaign    ████████░░░  35%  350K    │
│ Dev Sprint           ██████░░░░░  25%  250K    │
│ Community Building   █████░░░░░░  20%  200K    │
│ Research & Analysis  ███░░░░░░░░  12%  120K    │
│ Reserve              ██░░░░░░░░░   8%   80K    │
└─────────────────────────────────────────────────┘
```

**Prioritäts-basierte Verteilung:**
- Critical: 40% des verfügbaren Budgets
- High: 30%
- Medium: 20%
- Low: 10%

**Agent-Workload:**
```
Agent Utilization This Week
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CMO  ████████████████████░░░  85%  ⚠️ High
CTO  █████████████████░░░░░░  70%
CCO  ████████████░░░░░░░░░░░  50%
CFO  ████████░░░░░░░░░░░░░░░  35%
COO  ██████████████████████░  90%  🔥 Critical
DAO  ██████░░░░░░░░░░░░░░░░░  25%
```

---

---

## Persistenz-Strategie

### PostgreSQL = Point of Truth

Alle persistenten Daten in der Datenbank:

```
┌─────────────────────────────────────────────────────────────┐
│                      PostgreSQL                              │
├─────────────────────────────────────────────────────────────┤
│  projects              │ Projekte & Metadaten               │
│  project_phases        │ Phasen pro Projekt                 │
│  project_tasks         │ Tasks innerhalb Phasen             │
│  scheduled_events      │ Kalender-Events                    │
│  resource_allocations  │ Budget-Verteilung (täglich)        │
└─────────────────────────────────────────────────────────────┘
```

### Redis = Cache + Real-time

Nur für Performance-Optimierung und Echtzeit-Updates:

```
┌─────────────────────────────────────────────────────────────┐
│                        Redis                                 │
├─────────────────────────────────────────────────────────────┤
│  cache:projects:list      │ Dashboard-Liste (5min TTL)      │
│  cache:events:upcoming    │ Nächste 7 Tage (1h TTL)         │
│  cache:resources:today    │ Heutige Allocation (1h TTL)     │
│  channel:project:updates  │ Pub/Sub für Live-Updates        │
└─────────────────────────────────────────────────────────────┘
```

### GitHub Issues = Optional Sync

- Import von Issues als Tasks (einmalig oder periodisch)
- Kein Dual-Storage: Entweder GitHub ODER lokale Tasks
- Epic-Issues können als Projekte importiert werden

### Datenfluß

```
                    ┌─────────────┐
                    │   GitHub    │
                    │   Issues    │
                    └──────┬──────┘
                           │ (optional sync)
                           ▼
┌──────────────┐    ┌─────────────┐    ┌──────────────┐
│   Dashboard  │◄───│  PostgreSQL │───►│    Redis     │
│   (Read)     │    │  (Source)   │    │   (Cache)    │
└──────┬───────┘    └──────▲──────┘    └──────────────┘
       │                   │
       │                   │
       ▼                   │
┌──────────────┐           │
│   API        │───────────┘
│   (Write)    │
└──────────────┘
```

---

## Datenmodell

### Project (Projekt/Initiative)
```typescript
interface Project {
  id: string;
  title: string;
  description: string;
  status: 'planning' | 'active' | 'paused' | 'completed' | 'cancelled';
  priority: 'critical' | 'high' | 'medium' | 'low';

  // Timeline
  startDate: string;        // ISO date
  targetDate: string;       // ISO date
  actualEndDate?: string;

  // Ownership
  owner: AgentType;         // Primary responsible agent
  collaborators: AgentType[];

  // Progress
  progress: number;         // 0-100
  phases: ProjectPhase[];

  // Resources
  tokenBudget: number;      // Allocated tokens
  tokensUsed: number;       // Consumed tokens
  budgetPriority: number;   // 1-10, for resource allocation

  // Links
  githubIssue?: string;     // Link to Epic/Issue
  initiativeId?: string;    // Link to Initiative

  // Metadata
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface ProjectPhase {
  id: string;
  name: string;
  status: 'pending' | 'active' | 'completed';
  startDate: string;
  endDate: string;
  tasks: ProjectTask[];
}

interface ProjectTask {
  id: string;
  title: string;
  assignee: AgentType;
  status: 'todo' | 'in_progress' | 'review' | 'done';
  dueDate?: string;
  dependencies?: string[];  // Task IDs
  githubIssue?: number;
}
```

### ScheduledEvent (Kalender-Eintrag)
```typescript
interface ScheduledEvent {
  id: string;
  projectId?: string;
  title: string;
  description?: string;
  type: 'post' | 'ama' | 'release' | 'milestone' | 'meeting' | 'deadline';

  // Timing
  scheduledAt: string;      // ISO datetime
  duration?: number;        // Minutes
  isAllDay: boolean;
  recurring?: RecurringRule;

  // Assignment
  agent: AgentType;

  // Platform (for posts)
  platform?: 'twitter' | 'telegram' | 'discord' | 'website';

  // Status
  status: 'scheduled' | 'published' | 'cancelled';

  // Content (for posts)
  content?: string;
  mediaUrls?: string[];
}

interface RecurringRule {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;         // Every N days/weeks/months
  daysOfWeek?: number[];    // 0-6 for weekly
  until?: string;           // End date
}
```

### ResourceAllocation
```typescript
interface ResourceAllocation {
  date: string;             // ISO date
  totalBudget: number;      // Daily token budget

  allocations: {
    projectId: string;
    projectTitle: string;
    priority: number;
    allocatedTokens: number;
    usedTokens: number;
  }[];

  agentWorkload: {
    agent: AgentType;
    tasksCount: number;
    utilizationPercent: number;
    projects: string[];
  }[];
}
```

---

## API Endpoints

### Projects
```
GET    /api/projects                    # Liste aller Projekte
GET    /api/projects/:id                # Projekt-Details
POST   /api/projects                    # Neues Projekt erstellen
PUT    /api/projects/:id                # Projekt aktualisieren
DELETE /api/projects/:id                # Projekt löschen

GET    /api/projects/:id/tasks          # Tasks eines Projekts
POST   /api/projects/:id/tasks          # Task hinzufügen
PUT    /api/projects/:id/tasks/:taskId  # Task aktualisieren

GET    /api/projects/stats              # Portfolio-Statistiken
```

### Calendar/Events
```
GET    /api/events                      # Alle Events (mit date range filter)
GET    /api/events/upcoming             # Kommende Events (nächste 7 Tage)
POST   /api/events                      # Event erstellen
PUT    /api/events/:id                  # Event aktualisieren
DELETE /api/events/:id                  # Event löschen

GET    /api/events/calendar/:year/:month # Events für Kalenderansicht
```

### Resources
```
GET    /api/resources/allocation        # Aktuelle Ressourcenverteilung
GET    /api/resources/workload          # Agent-Workload
PUT    /api/resources/allocation        # Budget neu verteilen
GET    /api/resources/history           # Historische Nutzung
```

---

## UI Components

### Neue Dependencies
```json
{
  "@svar/react-gantt": "^2.3.0",  // Open Source Gantt Chart
  "date-fns": "^3.0.0"            // Date manipulation (evtl. schon vorhanden)
}
```

### Komponenten-Struktur
```
dashboard/src/
├── app/(dashboard)/
│   └── projects/
│       ├── page.tsx              # Portfolio Overview
│       ├── timeline/
│       │   └── page.tsx          # Gantt/Timeline View
│       ├── calendar/
│       │   └── page.tsx          # Calendar View
│       ├── resources/
│       │   └── page.tsx          # Resource Allocation
│       └── [id]/
│           └── page.tsx          # Project Detail
│
├── components/projects/
│   ├── ProjectCard.tsx           # Projekt-Karte
│   ├── ProjectList.tsx           # Projekt-Liste
│   ├── ProjectTimeline.tsx       # Gantt-Komponente
│   ├── ProjectCalendar.tsx       # Kalender-Komponente
│   ├── ResourceChart.tsx         # Budget-Verteilung
│   ├── AgentWorkload.tsx         # Agent-Auslastung
│   ├── EventDialog.tsx           # Event erstellen/bearbeiten
│   └── PhaseProgress.tsx         # Phasen-Fortschritt
│
└── lib/
    └── projects-api.ts           # API-Client
```

---

## Navigation Update

Neue Einträge in DashboardLayout:
```typescript
const NAV_ITEMS = [
  // ... existing items
  {
    icon: <CalendarMonthIcon />,
    label: 'Projects',
    href: '/projects',
    children: [
      { label: 'Overview', href: '/projects' },
      { label: 'Timeline', href: '/projects/timeline' },
      { label: 'Calendar', href: '/projects/calendar' },
      { label: 'Resources', href: '/projects/resources' },
    ],
  },
];
```

---

## Implementierungs-Phasen

### Phase 1: Grundgerüst (MVP)
- [ ] Datenmodell & DB-Schema
- [ ] API Endpoints (CRUD)
- [ ] Portfolio Overview Page
- [ ] Project Detail Page
- [ ] Navigation Update

### Phase 2: Timeline & Calendar
- [ ] Gantt Chart Integration (SVAR)
- [ ] Timeline View mit Projekten & Tasks
- [ ] Calendar View (Monats-Grid)
- [ ] Event CRUD

### Phase 3: Resource Management
- [ ] Token-Budget Tracking
- [ ] Agent Workload Visualization
- [ ] Budget Allocation UI
- [ ] Priority-basierte Verteilung

### Phase 4: Integration
- [ ] GitHub Issues Sync
- [ ] Initiative → Project Conversion
- [ ] Agent Auto-Scheduling
- [ ] Notifications für Deadlines

---

## Beispiel: Marketing-Projekt

```yaml
Project:
  title: "Q1 2025 Marketing Push"
  owner: CMO
  collaborators: [CCO, CTO]
  priority: high
  startDate: 2025-01-01
  targetDate: 2025-03-31
  tokenBudget: 500000

  phases:
    - name: "Preparation"
      status: completed
      tasks:
        - "Create content calendar" (CCO, done)
        - "Design templates" (CCO, done)

    - name: "Execution"
      status: active
      tasks:
        - "Weekly Twitter threads" (CMO, in_progress)
        - "Telegram announcements" (CMO, in_progress)
        - "AMA Sessions" (CEO, todo)

    - name: "Analysis"
      status: pending
      tasks:
        - "Engagement metrics" (CFO)
        - "Campaign report" (CMO)

  events:
    - "Twitter Thread: Tokenomics" @ 2025-01-08 10:00
    - "AMA with CEO" @ 2025-01-15 18:00
    - "Telegram Announcement" @ 2025-01-20 12:00
```

---

## Antworten auf Fragen

### 1. Automatisch vs. Manuell
**Primär automatisch** - Agents managen Projekte autonom:
- Agents erstellen Projekte aus Initiatives
- Agents planen Events (Posts, AMAs) selbst
- Dashboard erlaubt manuelles Eingreifen/Korrigieren
- Menschen können Projekte/Tasks auch manuell anlegen

### 2. Token-Budget (Claude Code Max Account)
**€200/Monat** = Session-basiert (5h pro Session, wöchentliches Limit)

Da kein direktes Token-API gibt, arbeiten wir mit **Schätzwerten**:

```typescript
// Approximierte Token-Kosten pro Aktivität
const TOKEN_ESTIMATES = {
  agent_loop: 5000,        // Ein Loop-Durchlauf
  worker_task: 2000,       // MCP Worker Task
  image_generation: 1000,  // Imagen API (separat, nicht Claude)
  decision_process: 8000,  // Voting/Decision mit mehreren Agents
};

// Tägliches Budget (geschätzt)
const DAILY_TOKEN_BUDGET = 500_000;  // ~15M/Monat
```

**Dashboard-Steuerung:**
- Max-Budget pro Tag konfigurierbar
- Prioritäts-basierte Verteilung
- Drosselung wenn Budget erschöpft
- Warnung bei 80% Verbrauch

### 3. Kalender-Posts
**Ja, automatisches Posting** via Cronjob:

```
┌─────────────────────────────────────────────────────────────┐
│                    Event Scheduler                          │
├─────────────────────────────────────────────────────────────┤
│  1. Cronjob läuft jede Minute                              │
│  2. Prüft: SELECT * FROM scheduled_events                   │
│            WHERE scheduled_at <= NOW()                      │
│            AND status = 'scheduled'                         │
│  3. Für jeden fälligen Event:                              │
│     → Spawne MCP Worker (telegram/twitter)                 │
│     → Setze status = 'published'                           │
│     → Logge execution_result                               │
└─────────────────────────────────────────────────────────────┘
```

**Aktuell verfügbare Kanäle:**
- ✅ Telegram (MCP Server aktiv)
- ❌ Twitter (noch kein MCP Server)

### 4. GitHub Sync
**Optional, einweg-Import:**
- Epic-Issues → Projekte
- Issues → Tasks
- Kein Dual-Storage (entweder GitHub ODER lokal)
- Manueller Import-Trigger im Dashboard

---

## Critical Path / Dependencies

### Warum wichtig?
> "Bevor der CMO ein Voting ankündigt, muss der CTO den Voting-Mechanismus entwickelt und getestet haben!"

### Dependency-Tracking in der DB

```sql
-- project_tasks hat dependencies Array
dependencies UUID[] DEFAULT '{}'  -- Task IDs die vorher fertig sein müssen

-- Beispiel:
INSERT INTO project_tasks (title, assignee, dependencies) VALUES
  ('Voting Smart Contract', 'cto', '{}'),                    -- Task A
  ('Voting UI implementieren', 'cto', '{task-a-uuid}'),      -- Task B, depends on A
  ('Voting Announcement', 'cmo', '{task-a-uuid, task-b-uuid}'); -- Task C, depends on A+B
```

### Visualisierung im Gantt-Chart

```
         Woche 1        Woche 2        Woche 3
    ─────────────────────────────────────────────
CTO │████████████│────►│████████│
    │ Smart      │     │ UI     │
    │ Contract   │     │        │
    └────────────┘     └────┬───┘
                            │ dependency
                            ▼
CMO │░░░░░░░░░░░░│░░░░░░░░░░│████████│
    │ BLOCKED    │ BLOCKED  │Announce│
    └────────────┴──────────┴────────┘

Legende:
████ = Aktiv
░░░░ = Blocked (warten auf Dependency)
────► = Dependency-Pfeil
```

### Validierung vor Ausführung

```typescript
async function canExecuteTask(taskId: string): Promise<{
  canExecute: boolean;
  blockedBy: string[];
}> {
  const task = await db.getTask(taskId);
  const blockedBy: string[] = [];

  for (const depId of task.dependencies) {
    const dep = await db.getTask(depId);
    if (dep.status !== 'done') {
      blockedBy.push(dep.title);
    }
  }

  return {
    canExecute: blockedBy.length === 0,
    blockedBy,
  };
}
```

### Dashboard-Anzeige

```
┌─────────────────────────────────────────────────────────────┐
│ 🔴 Task: "Voting Announcement"                              │
│ ────────────────────────────────────────────────────────────│
│ Status: BLOCKED                                             │
│ Assignee: CMO                                               │
│                                                             │
│ ⚠️ Wartet auf:                                              │
│   • CTO: "Voting Smart Contract" (in_progress, 60%)        │
│   • CTO: "Voting UI implementieren" (todo)                 │
│                                                             │
│ Frühester Start: Nach Abschluss aller Dependencies         │
└─────────────────────────────────────────────────────────────┘
```

---

## Event Scheduler (Cronjob)

Neuer Cronjob in `src/orchestrator/scheduler.ts`:

```typescript
// Schedule event execution - runs every minute
export function scheduleEventExecution(): void {
  const cronExpression = '* * * * *'; // Every minute

  cron.schedule(cronExpression, async () => {
    // Get due events
    const dueEvents = await db.query(`
      SELECT * FROM scheduled_events
      WHERE scheduled_at <= NOW()
        AND status = 'scheduled'
      ORDER BY scheduled_at
      LIMIT 10
    `);

    for (const event of dueEvents) {
      try {
        await executeScheduledEvent(event);
      } catch (err) {
        await markEventFailed(event.id, err);
      }
    }
  });
}

async function executeScheduledEvent(event: ScheduledEvent): Promise<void> {
  switch (event.event_type) {
    case 'post':
      await executePost(event);
      break;
    case 'ama':
      await executeAMA(event);
      break;
    // ... other types
  }
}

async function executePost(event: ScheduledEvent): Promise<void> {
  const worker = await spawnWorker({
    task: `Post to ${event.platform}: ${event.content}`,
    servers: [event.platform], // 'telegram' or 'twitter'
    timeout: 60000,
  });

  await db.updateEvent(event.id, {
    status: worker.success ? 'published' : 'failed',
    executed_at: new Date(),
    execution_result: worker,
  });
}
```
