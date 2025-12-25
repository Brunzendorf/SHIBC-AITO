# Agent Status Service - Planungsdokument

## Problem

Agents erzeugen massenhaft "Beweis"-Dateien und -Issues:

### Workspace-Pollution:
```
/SHIBC-CEO-001/ceo-loop-379-christmas-ops.md
/SHIBC-CEO-001/ceo-loop-383-christmas-status.md
/SHIBC-CEO-001/ceo-loop-386-christmas-status.md
/SHIBC-CMO-001/logs/loop_106.md
/SHIBC-CMO-001/logs/loop_107.md
...
```

### GitHub Issue-Pollution:
- 30+ "Proof/Certificate/Evidence" Issues
- 31 vage Epics
- 65x "governance", 54x "institutional" Buzzwords

### Ursache:
Agents wollen dem Kollektiv zeigen: "Ich arbeite!"
Aber es gibt keinen sauberen Kanal dafür.

---

## Lösung: Dedizierter Status-Service

### Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                      Dashboard (Next.js)                     │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Agent Status Board                                  │    │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │    │
│  │  │ CEO │ │ CMO │ │ CTO │ │ CFO │ │ COO │ │ CCO │   │    │
│  │  │ 🟢  │ │ 🟡  │ │ 🟢  │ │ 🔵  │ │ 🟢  │ │ 🔵  │   │    │
│  │  │Loop │ │Loop │ │Loop │ │Loop │ │Loop │ │Loop │   │    │
│  │  │#392 │ │#156 │ │#203 │ │#89  │ │#155 │ │#67  │   │    │
│  │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘   │    │
│  │                                                      │    │
│  │  Current Activities:                                 │    │
│  │  CEO: "Executing Q1 2026 webinar planning"          │    │
│  │  CMO: "Generating holiday campaign graphics"         │    │
│  │  CTO: "Building status SDK widget"                   │    │
│  └─────────────────────────────────────────────────────┘    │
└───────────────────────────┬─────────────────────────────────┘
                            │ WebSocket / REST
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Status Service (Node.js)                  │
│                                                              │
│  REST API:                    MCP Server:                    │
│  POST /status                 Tool: post_status              │
│  GET  /status/:agent          Tool: get_team_status          │
│  GET  /status/all             Tool: get_my_history           │
│  GET  /history/:agent                                        │
│  WS   /ws/status-feed                                        │
│                                                              │
│  Storage: PostgreSQL (agent_status table)                    │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   ┌─────────┐         ┌─────────┐         ┌─────────┐
   │   CEO   │         │   CMO   │         │   CTO   │
   │  Agent  │         │  Agent  │         │  Agent  │
   │         │         │         │         │         │
   │ MCP:    │         │ MCP:    │         │ MCP:    │
   │ status  │         │ status  │         │ status  │
   └─────────┘         └─────────┘         └─────────┘
```

---

## Status Service Spezifikation

### 1. Datenmodell

```sql
CREATE TABLE agent_status (
  id SERIAL PRIMARY KEY,
  agent_type VARCHAR(10) NOT NULL,        -- ceo, cmo, cto, etc.
  loop_number INTEGER NOT NULL,
  status_type VARCHAR(20) NOT NULL,       -- working, idle, blocked, completed
  activity TEXT NOT NULL,                  -- Was macht der Agent gerade?
  details JSONB,                           -- Zusätzliche strukturierte Daten
  issue_ref INTEGER,                       -- Optional: Referenz auf GitHub Issue
  created_at TIMESTAMP DEFAULT NOW(),

  INDEX idx_agent_status_agent (agent_type),
  INDEX idx_agent_status_created (created_at DESC)
);

CREATE TABLE agent_heartbeat (
  agent_type VARCHAR(10) PRIMARY KEY,
  loop_number INTEGER NOT NULL,
  last_seen TIMESTAMP DEFAULT NOW(),
  current_status VARCHAR(20) DEFAULT 'idle',
  current_activity TEXT
);
```

### 2. MCP Server Interface

```typescript
// mcp-servers/status-mcp/src/index.ts

const tools = {
  // Agent postet seinen Status
  post_status: {
    description: "Post your current status to the team dashboard",
    parameters: {
      status: {
        type: "string",
        enum: ["working", "idle", "blocked", "completed"],
        description: "Current status"
      },
      activity: {
        type: "string",
        description: "What you are currently doing (1-2 sentences)"
      },
      issue_number: {
        type: "number",
        description: "Optional: GitHub issue you're working on"
      },
      details: {
        type: "object",
        description: "Optional: Additional structured data"
      }
    }
  },

  // Agent sieht Team-Status
  get_team_status: {
    description: "Get current status of all agents",
    parameters: {}
  },

  // Agent sieht eigene Historie
  get_my_history: {
    description: "Get your recent status history",
    parameters: {
      limit: { type: "number", default: 10 }
    }
  }
};
```

### 3. REST API Endpoints

```
POST /api/status
  Body: { agent, loop, status, activity, issue?, details? }
  → Speichert Status, sendet WebSocket-Update

GET /api/status
  → Aktueller Status aller Agents (aus heartbeat table)

GET /api/status/:agent
  → Aktueller Status + letzte 10 Einträge eines Agents

GET /api/history/:agent?limit=50&since=2025-01-01
  → Status-Historie mit Pagination

WS /api/ws/status-feed
  → Real-time Updates für Dashboard
```

### 4. Dashboard Integration

```tsx
// dashboard/src/components/AgentStatusBoard.tsx

interface AgentStatus {
  agent: string;
  loop: number;
  status: 'working' | 'idle' | 'blocked' | 'completed';
  activity: string;
  lastSeen: Date;
  issue?: number;
}

function AgentStatusBoard() {
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);

  useEffect(() => {
    // WebSocket connection for real-time updates
    const ws = new WebSocket('/api/ws/status-feed');
    ws.onmessage = (event) => {
      const update = JSON.parse(event.data);
      setStatuses(prev => updateAgent(prev, update));
    };
  }, []);

  return (
    <div className="grid grid-cols-6 gap-4">
      {statuses.map(agent => (
        <AgentCard
          key={agent.agent}
          status={agent.status}
          loop={agent.loop}
          activity={agent.activity}
          issue={agent.issue}
        />
      ))}
    </div>
  );
}
```

---

## Integration in Agent Loop

### Vorher (daemon.ts):
```typescript
// Agent schreibt status.md, loop-XXX.md Dateien
await fs.writeFile(`/workspace/${agent}/status.md`, statusContent);
await fs.writeFile(`/workspace/${agent}/loop-${loopNum}.md`, loopLog);
```

### Nachher (daemon.ts):
```typescript
// Am Anfang jedes Loops
await statusMcp.postStatus({
  status: 'working',
  activity: `Processing ${trigger.type} trigger`,
  issue: currentIssue?.number
});

// Am Ende jedes Loops
await statusMcp.postStatus({
  status: 'idle',
  activity: `Completed loop ${loopNumber}`,
  details: { actionsExecuted, messagesProcessed }
});
```

---

## Erwartete Verbesserungen

### Workspace
| Vorher | Nachher |
|--------|---------|
| 50+ loop-XXX.md Dateien pro Agent | 0 Loop-Dateien |
| status.md pro Agent | Optional, nur bei wichtigen Updates |
| Certificates-Ordner | Nicht mehr nötig |

### GitHub Issues
| Vorher | Nachher |
|--------|---------|
| 30+ "Proof" Issues | 0 - Status ist im Dashboard |
| "AI Never Sleeps" Campaigns | Automatisch via Dashboard sichtbar |
| "Operations Certificate" | Dashboard zeigt Uptime |

### Dashboard
| Vorher | Nachher |
|--------|---------|
| Statische Agent-Liste | Real-time Status-Board |
| Keine Loop-Visibility | Live Loop-Counter pro Agent |
| Kein Activity-Feed | Stream der Aktivitäten |

---

## Implementation Roadmap

### Phase 1: Status Service (2-3h)
1. [ ] PostgreSQL Schema erstellen (`agent_status`, `agent_heartbeat`)
2. [ ] Status Service Node.js App (REST + WebSocket)
3. [ ] Docker Container + docker-compose.yml Integration

### Phase 2: Status MCP (1-2h)
1. [ ] `mcp-servers/status-mcp/` erstellen
2. [ ] Tools: `post_status`, `get_team_status`, `get_my_history`
3. [ ] In Agent mcp_servers.json registrieren

### Phase 3: Agent Integration (1h)
1. [ ] `daemon.ts` Loop-Start/End Status-Calls hinzufügen
2. [ ] Loop-File-Schreiben entfernen
3. [ ] Profile aktualisieren (Status-MCP dokumentieren)

### Phase 4: Dashboard (2h)
1. [ ] `AgentStatusBoard` Komponente
2. [ ] WebSocket Client für Real-time Updates
3. [ ] Status-Historie Ansicht

### Phase 5: Cleanup (1h)
1. [ ] Alte loop-XXX.md Dateien löschen
2. [ ] "Proof" Issues schließen mit Hinweis auf Dashboard
3. [ ] CLAUDE.md / base.md aktualisieren

---

## Service-Konfiguration

```yaml
# docker-compose.yml Erweiterung
services:
  aito-status:
    build:
      context: .
      dockerfile: docker/Dockerfile.status
    ports:
      - "3002:3002"
    environment:
      - DATABASE_URL=postgresql://...
      - REDIS_URL=redis://aito-redis:6379
    depends_on:
      - aito-postgres
      - aito-redis
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/health"]
```

---

## Offene Fragen

1. **Retention Policy**: Wie lange Status-Historie aufbewahren?
   - Vorschlag: 30 Tage detailliert, danach nur tägliche Summaries

2. **Aggregation**: Soll der Service auch Metriken aggregieren?
   - Loops pro Tag, durchschnittliche Loop-Dauer, etc.

3. **Alerts**: Soll Status-Service Alerts senden wenn Agent > 30min idle?
   - Integration mit bestehenden Alert-Mechanismus

4. **Public API**: Soll Status-API für B2B-Kunden verfügbar sein?
   - Wäre "proof of operations" ohne manuelle Certificates
