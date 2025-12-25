# Agent State Machines Architecture

## Problem

Agents (especially CTO) write specs but never follow through to BUILD/DEPLOY.
Current loop-based approach has no memory of incomplete tasks.

## Solution: Deterministic State Machines

Each agent scenario is modeled as a finite state machine (FSM) that:
1. Defines explicit states and transitions
2. Pushes Redis events to trigger agent actions
3. Waits for agent acknowledgment before transitioning
4. Provides project context to agent on each trigger

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     STATE MACHINE SERVICE                            │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │
│  │ CTO Machine │    │ CMO Machine │    │ CFO Machine │   ...        │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘              │
│         │                  │                  │                      │
│         ▼                  ▼                  ▼                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    REDIS PUB/SUB                             │    │
│  │  channel:agent:<uuid>  →  { type: "state_task", state: ... } │    │
│  └─────────────────────────────────────────────────────────────┘    │
│         │                                                            │
│         ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    AGENT DAEMON                              │    │
│  │  Receives task → Executes → Acknowledges completion          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│         │                                                            │
│         ▼                                                            │
│  channel:state:ack → { machineId, state, success, output }          │
│         │                                                            │
│         ▼                                                            │
│  STATE MACHINE receives ACK → Transitions to next state             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## State Machine Definition

### Schema

```typescript
interface StateMachine {
  id: string;                    // Unique machine instance ID
  type: string;                  // Machine type: "cto_build_project"
  agentType: string;             // Target agent: "cto"
  currentState: string;          // Current state name
  context: MachineContext;       // Persistent context data
  history: StateTransition[];    // Audit trail
  createdAt: Date;
  updatedAt: Date;
}

interface MachineContext {
  projectName?: string;
  githubIssue?: number;
  specPath?: string;
  projectPath?: string;
  buildOutput?: string;
  testResults?: string;
  deploymentUrl?: string;
  retryCount: number;
  maxRetries: number;
  [key: string]: any;
}

interface StateDefinition {
  name: string;
  description: string;
  agentPrompt: string;          // What to tell the agent
  requiredOutput: string[];     // Expected outputs from agent
  onSuccess: string;            // Next state on success
  onFailure: string;            // Next state on failure
  timeout: number;              // Max wait time in ms
  maxRetries: number;           // Retries before failure
}

interface StateTransition {
  from: string;
  to: string;
  timestamp: Date;
  success: boolean;
  output?: any;
}
```

---

## CTO State Machines

### 1. BUILD_PROJECT (from GitHub Issue)

```
┌─────────────────┐
│   IDLE          │ ←────────────────────────────────┐
└────────┬────────┘                                  │
         │ trigger: new issue assigned               │
         ▼                                           │
┌─────────────────┐                                  │
│ ANALYZE_ISSUE   │ Agent reads issue, decides scope │
└────────┬────────┘                                  │
         │ ack: { needsSpec: bool, complexity: ... } │
         ▼                                           │
┌─────────────────┐ (optional, max 30min)            │
│ WRITE_SPEC      │ Only if needsSpec=true           │
└────────┬────────┘                                  │
         │ ack: { specPath: "..." }                  │
         ▼                                           │
┌─────────────────┐                                  │
│ CREATE_PROJECT  │ mkdir, npm init, git init        │
└────────┬────────┘                                  │
         │ ack: { projectPath: "..." }               │
         ▼                                           │
┌─────────────────┐                                  │
│ WRITE_CODE      │ Implement the feature            │
└────────┬────────┘                                  │
         │ ack: { filesCreated: [...] }              │
         ▼                                           │
┌─────────────────┐                                  │
│ RUN_TESTS       │ npm test                         │
└────────┬────────┘                                  │
         │ ack: { passed: bool, coverage: ... }      │
         ├─────── failure ──► WRITE_CODE (retry)     │
         ▼                                           │
┌─────────────────┐                                  │
│ COMMIT_PUSH     │ git add, commit, push            │
└────────┬────────┘                                  │
         │ ack: { commitHash: "..." }                │
         ▼                                           │
┌─────────────────┐                                  │
│ DEPLOY_STAGING  │ woodpecker or portainer          │
└────────┬────────┘                                  │
         │ ack: { stagingUrl: "..." }                │
         ▼                                           │
┌─────────────────┐                                  │
│ VERIFY_STAGING  │ playwright test on staging       │
└────────┬────────┘                                  │
         │ ack: { verified: bool }                   │
         ├─────── failure ──► WRITE_CODE (retry)     │
         ▼                                           │
┌─────────────────┐                                  │
│ DEPLOY_PROD     │ Production deployment            │
└────────┬────────┘                                  │
         │ ack: { prodUrl: "..." }                   │
         ▼                                           │
┌─────────────────┐                                  │
│ COMPLETE        │ Close issue, notify CEO          │
└────────┬────────┘                                  │
         │                                           │
         └───────────────────────────────────────────┘
```

### 2. FIX_BUG (simpler flow)

```
IDLE → ANALYZE_BUG → LOCATE_CODE → WRITE_FIX → RUN_TESTS → COMMIT_PUSH → DEPLOY → COMPLETE
```

### 3. INFRASTRUCTURE_CHECK (monitoring)

```
IDLE → CHECK_UPTIME → CHECK_CERTS → CHECK_CONTAINERS → GENERATE_REPORT → IDLE
```

---

## Redis Event Format

### State Machine → Agent

```json
{
  "type": "state_task",
  "machineId": "uuid-machine-123",
  "state": "WRITE_CODE",
  "context": {
    "projectName": "sla-api",
    "projectPath": "/app/projects/sla-api",
    "githubIssue": 726,
    "specPath": "/app/workspace/SHIBC-CTO-001/specs/issue-726-spec.md"
  },
  "prompt": "Implement the SLA API according to the spec. Create src/index.ts with Express server, routes for /health, /uptime, /metrics. Use the project at /app/projects/sla-api.",
  "requiredOutput": ["filesCreated", "buildSuccess"],
  "timeout": 300000
}
```

### Agent → State Machine (ACK)

```json
{
  "type": "state_ack",
  "machineId": "uuid-machine-123",
  "state": "WRITE_CODE",
  "success": true,
  "output": {
    "filesCreated": ["src/index.ts", "src/routes/health.ts"],
    "buildSuccess": true,
    "tokensUsed": 15000
  }
}
```

---

## Database Schema

```sql
-- State Machine Instances
CREATE TABLE state_machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,           -- 'cto_build_project', 'cmo_campaign'
  agent_type VARCHAR(10) NOT NULL,     -- 'cto', 'cmo', etc.
  current_state VARCHAR(50) NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'running', -- 'running', 'paused', 'completed', 'failed'
  github_issue INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- State Transition History
CREATE TABLE state_transitions (
  id SERIAL PRIMARY KEY,
  machine_id UUID REFERENCES state_machines(id),
  from_state VARCHAR(50),
  to_state VARCHAR(50) NOT NULL,
  success BOOLEAN NOT NULL,
  output JSONB,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- State Machine Definitions (templates)
CREATE TABLE state_machine_definitions (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) UNIQUE NOT NULL,
  agent_type VARCHAR(10) NOT NULL,
  description TEXT,
  states JSONB NOT NULL,              -- Array of StateDefinition
  initial_state VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_machines_agent ON state_machines(agent_type, status);
CREATE INDEX idx_machines_issue ON state_machines(github_issue);
CREATE INDEX idx_transitions_machine ON state_transitions(machine_id);
```

---

## Implementation Plan

### Phase 1: Core Service
1. Create `src/services/state-machine/` module
2. Implement StateMachineService class
3. Add PostgreSQL persistence
4. Add Redis pub/sub integration

### Phase 2: Agent Integration
1. Update daemon.ts to handle `state_task` messages
2. Add `state_ack` response handling
3. Modify agent prompt to include state context

### Phase 3: CTO Scenarios
1. Define BUILD_PROJECT state machine
2. Define FIX_BUG state machine
3. Define INFRASTRUCTURE_CHECK state machine

### Phase 4: Dashboard
1. Add state machine visualization
2. Show current state per agent
3. Allow manual state transitions (admin)

---

## Benefits

1. **Deterministic Flow** - Agent can't skip steps
2. **Resumable** - Context persisted, can resume after restart
3. **Auditable** - Full history of state transitions
4. **Timeout Handling** - Auto-retry or escalate on timeout
5. **Project Context** - Agent always knows current state and what to do
6. **Multi-Loop** - Complex tasks span multiple agent loops with context preserved
