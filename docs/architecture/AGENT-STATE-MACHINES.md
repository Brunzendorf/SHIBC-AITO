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

## Agent State Machines (All 7 Agents)

---

## CEO State Machines

### 1. STRATEGIC_DECISION
```
IDLE → GATHER_CONTEXT → ANALYZE_OPTIONS → CONSULT_C_LEVEL → MAKE_DECISION → COMMUNICATE → COMPLETE
```
**Trigger:** Strategic issue, major decision needed
**States:**
- GATHER_CONTEXT: Read relevant issues, market data, agent reports
- ANALYZE_OPTIONS: List pros/cons of each option
- CONSULT_C_LEVEL: Request input from relevant C-level agents
- MAKE_DECISION: Final decision with rationale
- COMMUNICATE: Broadcast decision to all agents

### 2. INITIATIVE_LAUNCH
```
IDLE → DEFINE_SCOPE → ASSIGN_AGENTS → CREATE_ISSUES → MONITOR_PROGRESS → REVIEW_COMPLETION → COMPLETE
```
**Trigger:** New initiative proposal
**States:**
- DEFINE_SCOPE: Goals, timeline, success metrics
- ASSIGN_AGENTS: Determine which agents handle what
- CREATE_ISSUES: Create GitHub issues for each task
- MONITOR_PROGRESS: Check agent progress daily
- REVIEW_COMPLETION: Verify all tasks done

### 3. WEEKLY_REPORT
```
IDLE → COLLECT_AGENT_REPORTS → ANALYZE_METRICS → WRITE_REPORT → PUBLISH → COMPLETE
```
**Trigger:** Weekly schedule (Sundays)

---

## CMO State Machines

### 1. CAMPAIGN_EXECUTION
```
IDLE → ANALYZE_BRIEF → CREATE_CONTENT → REVIEW_COMPLIANCE → SCHEDULE_POSTS → EXECUTE → MONITOR_ENGAGEMENT → REPORT → COMPLETE
```
**Trigger:** Campaign issue assigned
**States:**
- ANALYZE_BRIEF: Understand campaign goals, target audience
- CREATE_CONTENT: Write copy, create visuals (spawn imagen worker)
- REVIEW_COMPLIANCE: CCO check for compliance
- SCHEDULE_POSTS: Queue for optimal times
- EXECUTE: Post to Telegram/Twitter
- MONITOR_ENGAGEMENT: Track metrics for 24-48h
- REPORT: Summary with metrics

### 2. CONTENT_CREATION
```
IDLE → RESEARCH_TOPIC → WRITE_DRAFT → GENERATE_VISUALS → REVIEW → PUBLISH → COMPLETE
```
**Trigger:** Content request

### 3. SOCIAL_RESPONSE
```
IDLE → ANALYZE_MENTION → DRAFT_RESPONSE → COMPLIANCE_CHECK → POST → COMPLETE
```
**Trigger:** Community mention requiring response

### 4. MARKET_NEWSJACKING
```
IDLE → DETECT_TREND → ASSESS_RELEVANCE → CREATE_ANGLE → RAPID_CONTENT → POST → MONITOR → COMPLETE
```
**Trigger:** Fear & Greed alert, market news

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

### 4. SECURITY_INCIDENT
```
IDLE → DETECT_THREAT → ASSESS_SEVERITY → ISOLATE → INVESTIGATE → PATCH → VERIFY → POST_MORTEM → COMPLETE
```
**Trigger:** Security alert

---

## CFO State Machines

### 1. TREASURY_REPORT
```
IDLE → FETCH_BALANCES → FETCH_PRICES → CALCULATE_METRICS → GENERATE_REPORT → PUBLISH → COMPLETE
```
**Trigger:** Daily/weekly schedule
**States:**
- FETCH_BALANCES: Query Gnosis Safe, wallets via etherscan
- FETCH_PRICES: Get token prices from CoinGecko
- CALCULATE_METRICS: Treasury value, runway, burn rate
- GENERATE_REPORT: Format markdown report
- PUBLISH: Post to workspace, notify CEO

### 2. PAYMENT_PROCESSING
```
IDLE → VERIFY_REQUEST → CHECK_BUDGET → COMPLIANCE_CHECK → PREPARE_TX → AWAIT_APPROVAL → EXECUTE → CONFIRM → COMPLETE
```
**Trigger:** Payment request issue
**States:**
- VERIFY_REQUEST: Valid recipient, amount, purpose
- CHECK_BUDGET: Sufficient funds, within limits
- COMPLIANCE_CHECK: CCO approval for large amounts
- PREPARE_TX: Create transaction data
- AWAIT_APPROVAL: Multi-sig if required
- EXECUTE: Submit transaction
- CONFIRM: Verify on-chain

### 3. BUDGET_ALLOCATION
```
IDLE → ANALYZE_REQUESTS → PRIORITIZE → PROPOSE_ALLOCATION → CEO_APPROVAL → IMPLEMENT → COMPLETE
```
**Trigger:** Budget planning period

### 4. FINANCIAL_AUDIT
```
IDLE → GATHER_TRANSACTIONS → CATEGORIZE → RECONCILE → FLAG_ANOMALIES → REPORT → COMPLETE
```
**Trigger:** Monthly schedule

---

## COO State Machines

### 1. OPERATIONAL_REPORT
```
IDLE → COLLECT_AGENT_METRICS → CALCULATE_KPIs → IDENTIFY_BOTTLENECKS → GENERATE_REPORT → PUBLISH → COMPLETE
```
**Trigger:** Daily schedule
**States:**
- COLLECT_AGENT_METRICS: Loop counts, response times, errors
- CALCULATE_KPIs: Uptime, throughput, efficiency
- IDENTIFY_BOTTLENECKS: Slow agents, failed tasks
- GENERATE_REPORT: Operational dashboard update
- PUBLISH: Post to status service, notify CEO

### 2. PROCESS_OPTIMIZATION
```
IDLE → ANALYZE_WORKFLOW → IDENTIFY_INEFFICIENCY → PROPOSE_IMPROVEMENT → TEST_CHANGE → MEASURE_IMPACT → IMPLEMENT → COMPLETE
```
**Trigger:** Performance issue detected

### 3. INCIDENT_MANAGEMENT
```
IDLE → DETECT_INCIDENT → CLASSIFY_SEVERITY → ASSIGN_RESPONDER → COORDINATE_RESPONSE → VERIFY_RESOLUTION → POST_MORTEM → COMPLETE
```
**Trigger:** System alert, agent failure

### 4. AGENT_HEALTH_CHECK
```
IDLE → CHECK_HEARTBEATS → CHECK_LOOP_COUNTS → CHECK_ERROR_RATES → RESTART_IF_NEEDED → REPORT → IDLE
```
**Trigger:** Hourly schedule

### 5. CAPACITY_PLANNING
```
IDLE → ANALYZE_USAGE → FORECAST_GROWTH → IDENTIFY_CONSTRAINTS → PROPOSE_SCALING → COMPLETE
```
**Trigger:** Weekly schedule

---

## CCO State Machines

### 1. COMPLIANCE_REVIEW
```
IDLE → RECEIVE_REQUEST → ANALYZE_CONTENT → CHECK_REGULATIONS → APPROVE_OR_REJECT → DOCUMENT → COMPLETE
```
**Trigger:** Compliance check request from other agents
**States:**
- RECEIVE_REQUEST: Content, campaign, or transaction to review
- ANALYZE_CONTENT: Check for prohibited terms, claims
- CHECK_REGULATIONS: Crypto advertising rules, disclaimers
- APPROVE_OR_REJECT: Decision with feedback
- DOCUMENT: Log decision for audit trail

### 2. POLICY_UPDATE
```
IDLE → MONITOR_REGULATIONS → IDENTIFY_CHANGES → DRAFT_POLICY → LEGAL_REVIEW → CEO_APPROVAL → PUBLISH → NOTIFY_AGENTS → COMPLETE
```
**Trigger:** Regulatory change detected

### 3. RISK_ASSESSMENT
```
IDLE → IDENTIFY_RISKS → EVALUATE_IMPACT → PROPOSE_MITIGATIONS → IMPLEMENT → MONITOR → COMPLETE
```
**Trigger:** New initiative, partnership proposal

### 4. AUDIT_PREPARATION
```
IDLE → GATHER_DOCUMENTS → VERIFY_COMPLETENESS → ORGANIZE → GENERATE_REPORT → COMPLETE
```
**Trigger:** Audit schedule

### 5. CONTENT_MODERATION
```
IDLE → SCAN_CONTENT → FLAG_VIOLATIONS → REVIEW → TAKE_ACTION → LOG → IDLE
```
**Trigger:** Continuous monitoring

---

## DAO State Machines

### 1. PROPOSAL_LIFECYCLE
```
IDLE → RECEIVE_PROPOSAL → VALIDATE_FORMAT → PUBLISH_DISCUSSION → OPEN_VOTING → MONITOR_VOTES → CLOSE_VOTING → ANNOUNCE_RESULT → EXECUTE_IF_PASSED → COMPLETE
```
**Trigger:** New proposal submitted
**States:**
- RECEIVE_PROPOSAL: Parse proposal from issue/message
- VALIDATE_FORMAT: Check required fields, thresholds
- PUBLISH_DISCUSSION: Post to Telegram, Discord
- OPEN_VOTING: Create Snapshot vote
- MONITOR_VOTES: Track participation, remind voters
- CLOSE_VOTING: End voting period
- ANNOUNCE_RESULT: Publish outcome
- EXECUTE_IF_PASSED: Trigger implementation

### 2. GOVERNANCE_REPORT
```
IDLE → FETCH_VOTING_STATS → ANALYZE_PARTICIPATION → SUMMARIZE_DECISIONS → PUBLISH → COMPLETE
```
**Trigger:** Weekly schedule

### 3. DELEGATE_MANAGEMENT
```
IDLE → TRACK_DELEGATIONS → ANALYZE_POWER_DISTRIBUTION → FLAG_CONCENTRATION → REPORT → COMPLETE
```
**Trigger:** Delegation change events

### 4. TREASURY_PROPOSAL
```
IDLE → RECEIVE_FUNDING_REQUEST → VALIDATE_AMOUNT → CREATE_PROPOSAL → SUBMIT_TO_DAO → MONITOR → COMPLETE
```
**Trigger:** Funding request from agents

### 5. COMMUNITY_PULSE
```
IDLE → SCAN_CHANNELS → ANALYZE_SENTIMENT → IDENTIFY_CONCERNS → SUMMARIZE → REPORT_TO_CEO → COMPLETE
```
**Trigger:** Daily schedule

---

## Workflow Summary

| Agent | Workflows | Primary Focus |
|-------|-----------|---------------|
| **CEO** | 3 | Strategic decisions, initiatives, reporting |
| **CMO** | 4 | Campaigns, content, social, market response |
| **CTO** | 4 | Build, fix, infrastructure, security |
| **CFO** | 4 | Treasury, payments, budgets, audits |
| **COO** | 5 | Operations, processes, incidents, capacity |
| **CCO** | 5 | Compliance, policy, risk, audits, moderation |
| **DAO** | 5 | Proposals, governance, delegates, treasury, community |
| **TOTAL** | **30** | |

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
