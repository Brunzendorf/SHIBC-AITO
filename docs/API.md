# AITO Orchestrator API Documentation

Base URL: `http://localhost:8080`

## Health & Status

### GET /health
Quick liveness probe.

**Response:**
```json
{"status": "ok"}
```

### GET /ready
Readiness probe for Kubernetes/Docker health checks.

**Response:**
```json
{"status": "ready", "timestamp": "2025-12-11T09:46:35.959Z"}
```

### GET /health/full
Detailed health status of all system components.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-12-11T09:46:35.959Z",
    "components": {
      "database": {"status": "healthy", "latencyMs": 1},
      "redis": {"status": "healthy", "latencyMs": 1},
      "docker": {"status": "healthy", "latencyMs": 5},
      "agents": {
        "total": 7,
        "healthy": 7,
        "unhealthy": 0,
        "inactive": 0,
        "details": {
          "ceo": {
            "agentId": "b84ea7b5-...",
            "status": "healthy",
            "lastCheck": "2025-12-11T09:46:25.880Z",
            "containerId": "47d7f2a8673fa...",
            "containerStatus": "running",
            "memoryUsage": 25075712,
            "cpuUsage": 0.0017896
          }
          // ... other agents
        }
      }
    },
    "uptime": 37287039
  }
}
```

### GET /metrics
Prometheus-formatted metrics.

**Response:**
```
# HELP aito_system_status System status (1=healthy, 0=unhealthy)
# TYPE aito_system_status gauge
aito_system_status 1

# HELP aito_agents_total Total number of registered agents
# TYPE aito_agents_total gauge
aito_agents_total 7

# HELP aito_agents_healthy Number of healthy agents
# TYPE aito_agents_healthy gauge
aito_agents_healthy 7
```

---

## Agent Management

### GET /agents
List all registered agents with their current status.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "b84ea7b5-fad7-4756-ae47-6b3ecd63d3a1",
      "type": "ceo",
      "name": "CEO Agent",
      "profilePath": "/profiles/ceo.md",
      "loopInterval": 3600,
      "gitRepo": null,
      "gitFilter": null,
      "status": "active",
      "containerId": null,
      "lastHeartbeat": null,
      "createdAt": "2025-12-10T22:30:00.588Z",
      "updatedAt": "2025-12-11T09:33:58.968Z",
      "containerStatus": {
        "agentId": "b84ea7b5-...",
        "status": "healthy",
        "lastCheck": "2025-12-11T09:44:24.841Z",
        "containerId": "47d7f2a8673fa...",
        "containerStatus": "running",
        "memoryUsage": 24735744,
        "cpuUsage": 0.00123
      }
    }
    // ... other agents
  ],
  "timestamp": "2025-12-11T09:44:24.847Z"
}
```

### GET /agents/:type
Get details of a specific agent.

**Parameters:**
- `type`: Agent type (ceo, dao, cmo, cto, cfo, coo, cco)

**Response:**
```json
{
  "success": true,
  "data": {
    "agent": { /* agent data */ },
    "state": {
      "loop_count": 10,
      "status": "active",
      "current_focus": "system_stabilization",
      "awaiting_reports_from": ["CTO", "CFO", "CMO", "COO", "CCO"]
    },
    "recentHistory": [
      {
        "id": "67c12958-...",
        "action_type": "decision",
        "summary": "CEO Startup Loop #10 abgeschlossen...",
        "created_at": "2025-12-11T09:34:27.913Z"
      }
    ]
  }
}
```

### POST /agents/:type/start
Start an agent container via Portainer.

**Parameters:**
- `type`: Agent type

**Response:**
```json
{
  "success": true,
  "message": "Agent ceo started",
  "containerId": "47d7f2a8673fa..."
}
```

### POST /agents/:type/stop
Stop an agent container.

**Parameters:**
- `type`: Agent type

**Response:**
```json
{
  "success": true,
  "message": "Agent ceo stopped"
}
```

### POST /agents/:type/restart
Restart an agent container.

**Parameters:**
- `type`: Agent type

**Response:**
```json
{
  "success": true,
  "message": "Agent ceo restarted"
}
```

### GET /agents/:type/health
Get detailed health info for a specific agent.

**Parameters:**
- `type`: Agent type

**Response:**
```json
{
  "success": true,
  "data": {
    "agentId": "b84ea7b5-...",
    "status": "healthy",
    "lastCheck": "2025-12-11T09:46:25.880Z",
    "containerId": "47d7f2a8673fa...",
    "containerStatus": "running",
    "memoryUsage": 25075712,
    "cpuUsage": 0.0017896
  }
}
```

### GET /containers
List all AITO containers via Portainer API.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "Id": "47d7f2a8673fa...",
      "Names": ["/aito-ceo"],
      "State": "running",
      "Status": "Up 5 minutes (healthy)"
    }
  ]
}
```

---

## Events & History

### GET /events
Get global event log.

**Query Parameters:**
- `type` (optional): Filter by event type
- `limit` (optional): Number of results (default: 50)
- `offset` (optional): Pagination offset

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "event_type": "agent_started",
      "source_agent": "b84ea7b5-...",
      "target_agent": null,
      "payload": {},
      "created_at": "2025-12-11T09:33:58.976Z"
    }
  ]
}
```

### GET /events/agent/:id
Get events for a specific agent.

**Parameters:**
- `id`: Agent UUID

**Query Parameters:**
- `limit` (optional): Number of results (default: 50)

---

## Tasks

### GET /tasks/agent/:id
Get tasks assigned to an agent.

**Parameters:**
- `id`: Agent UUID

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "title": "Review PR #42",
      "assigned_to": "3cf8f7db-...",
      "created_by": "b84ea7b5-...",
      "status": "pending",
      "priority": "high",
      "result": null,
      "created_at": "2025-12-11T09:00:00.000Z"
    }
  ]
}
```

### POST /tasks
Create a new task.

**Request Body:**
```json
{
  "title": "Review security audit",
  "assignedTo": "cto",
  "createdBy": "ceo",
  "priority": "high",
  "details": {
    "description": "Review the latest security audit report"
  }
}
```

---

## Decisions

### GET /decisions/pending
Get all pending decisions awaiting votes.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "title": "Implement new marketing campaign",
      "proposed_by": "c2a7aff0-...",
      "status": "pending",
      "veto_round": 1,
      "ceo_vote": null,
      "dao_vote": null,
      "c_level_votes": {},
      "created_at": "2025-12-11T09:00:00.000Z"
    }
  ]
}
```

### GET /decisions/:id
Get details of a specific decision.

**Parameters:**
- `id`: Decision UUID

---

## Human Escalation

### GET /escalations/pending
Get all pending escalations requiring human input.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "decision_id": "...",
      "reason": "Deadlock after 3 veto rounds",
      "channels_notified": ["telegram", "email"],
      "human_response": null,
      "status": "pending",
      "timeout_at": "2025-12-12T09:00:00.000Z",
      "created_at": "2025-12-11T09:00:00.000Z"
    }
  ]
}
```

### POST /escalate
Create a new escalation.

**Request Body:**
```json
{
  "decisionId": "...",
  "reason": "Critical decision requires human approval",
  "channels": ["telegram", "email"],
  "timeoutHours": 24
}
```

### POST /escalations/:id/respond
Respond to an escalation.

**Parameters:**
- `id`: Escalation UUID

**Request Body:**
```json
{
  "response": "approved",
  "comment": "Approved with conditions..."
}
```

---

## Scheduler

### GET /scheduler/jobs
Get list of scheduled cron jobs.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "health-check",
      "schedule": "*/30 * * * * *",
      "lastRun": "2025-12-11T09:46:00.000Z",
      "nextRun": "2025-12-11T09:46:30.000Z"
    },
    {
      "name": "escalation-check",
      "schedule": "*/5 * * * *",
      "lastRun": "2025-12-11T09:45:00.000Z",
      "nextRun": "2025-12-11T09:50:00.000Z"
    },
    {
      "name": "daily-digest",
      "schedule": "0 9 * * *",
      "lastRun": "2025-12-11T09:00:00.000Z",
      "nextRun": "2025-12-12T09:00:00.000Z"
    }
  ]
}
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error message here",
  "timestamp": "2025-12-11T09:46:35.959Z"
}
```

Common HTTP status codes:
- `200` - Success
- `400` - Bad Request (invalid parameters)
- `404` - Not Found (agent/resource doesn't exist)
- `500` - Internal Server Error
- `503` - Service Unavailable (dependency down)

---

## Database Schema

### agents
```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY,
  type VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  profile_path VARCHAR(500),
  loop_interval INTEGER DEFAULT 3600,
  git_repo VARCHAR(500),
  git_filter VARCHAR(255),
  status VARCHAR(50) DEFAULT 'inactive',
  container_id VARCHAR(255),
  last_heartbeat TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### agent_state
```sql
CREATE TABLE agent_state (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agents(id),
  state_key VARCHAR(255) NOT NULL,
  state_value JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(agent_id, state_key)
);
```

### agent_history
```sql
CREATE TABLE agent_history (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agents(id),
  action_type VARCHAR(100) NOT NULL,
  summary TEXT,
  details JSONB,
  embedding VECTOR(1536),
  created_at TIMESTAMP DEFAULT NOW()
);
```

### events
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  source_agent UUID REFERENCES agents(id),
  target_agent UUID REFERENCES agents(id),
  payload JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### decisions
```sql
CREATE TABLE decisions (
  id UUID PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  proposed_by UUID REFERENCES agents(id),
  status VARCHAR(50) DEFAULT 'pending',
  veto_round INTEGER DEFAULT 1,
  ceo_vote VARCHAR(50),
  dao_vote VARCHAR(50),
  c_level_votes JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  decided_at TIMESTAMP
);
```

### tasks
```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  assigned_to UUID REFERENCES agents(id),
  created_by UUID REFERENCES agents(id),
  status VARCHAR(50) DEFAULT 'pending',
  priority VARCHAR(50) DEFAULT 'normal',
  details JSONB,
  result JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
```

### escalations
```sql
CREATE TABLE escalations (
  id UUID PRIMARY KEY,
  decision_id UUID REFERENCES decisions(id),
  reason TEXT NOT NULL,
  channels_notified TEXT[],
  human_response TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  timeout_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  responded_at TIMESTAMP
);
```
