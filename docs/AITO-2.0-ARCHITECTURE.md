# AITO 2.0 - Autonomous AI CEO System Architecture

## Vision

Ein **100% autonomes System**, das:
- Via API und MCP mit der Außenwelt interagiert
- Das Projekt mit eigenen Ideen vorantreibt
- Feedback-Schleifen zwischen Abteilungen koordiniert
- Entscheidungen durch CEO + DAO validiert
- Container dynamisch startet und beendet

---

## System-Architektur

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HUMAN OVERSIGHT                                 │
│                         (Patt nach 3 Veto-Runden)                           │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│                           ORCHESTRATOR                                       │
│                    (Immer aktiv - Lightweight)                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • Container Lifecycle Management (Start/Stop/Health)               │   │
│  │  • Event Bus (Redis Pub/Sub)                                        │   │
│  │  • State Persistence (Postgres)                                     │   │
│  │  • Scheduling (Cron-basierte Loops)                                 │   │
│  │  • Human Escalation Interface                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│                              HEAD LAYER                                      │
│                         (Veto-Recht, Major Decisions)                       │
│                                                                              │
│  ┌──────────────────────┐              ┌──────────────────────┐            │
│  │     CEO AGENT        │◄────────────►│     DAO AGENT        │            │
│  │     Container        │  Consensus   │     Container        │            │
│  ├──────────────────────┤    Loop      ├──────────────────────┤            │
│  │ • Big Picture        │              │ • Community Voice    │            │
│  │ • Strategic Decisions│              │ • Governance Rules   │            │
│  │ • C-Level Queries    │              │ • Treasury Oversight │            │
│  │ • Crisis Management  │              │ • Proposal Voting    │            │
│  └──────────────────────┘              └──────────────────────┘            │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
┌───────────────────▼─────────────▼─────────────▼─────────────────────────────┐
│                           C-LEVEL LAYER                                      │
│                    (Department Heads - Continuous Loops)                     │
│                                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │     CMO     │ │     CTO     │ │     CFO     │ │     COO     │           │
│  │  Marketing  │ │    Tech     │ │  Treasury   │ │  Community  │           │
│  ├─────────────┤ ├─────────────┤ ├─────────────┤ ├─────────────┤           │
│  │ Loop: 4h    │ │ Loop: 1h    │ │ Loop: 6h    │ │ Loop: 2h    │           │
│  │ Git: social │ │ Git: code   │ │ Git: finance│ │ Git: support│           │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                                              │
│  ┌─────────────┐                                                            │
│  │     CCO     │  (Chief Compliance Officer)                                │
│  │ Compliance  │                                                            │
│  ├─────────────┤                                                            │
│  │ Loop: 24h   │                                                            │
│  │ Git: legal  │                                                            │
│  └─────────────┘                                                            │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WORKER LAYER                                       │
│                    (On-Demand, Task-Specific)                               │
│                                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │   Content   │ │   Code      │ │   Analyst   │ │   Support   │           │
│  │   Writer    │ │   Reviewer  │ │             │ │   Bot       │           │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                                              │
│  [Spawned by C-Level, terminated after task completion]                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL LAYER                                     │
│                                                                              │
│  [GitHub API] [Telegram] [Discord] [Twitter/X] [CoinGecko] [Blockchain]    │
│  [Directus CMS] [Website] [Snapshot DAO] [Email] [RSS Feeds]               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Container-Typen

### 1. Orchestrator (Singleton - Immer aktiv)

```yaml
orchestrator:
  image: aito-orchestrator:latest
  restart: always
  environment:
    POSTGRES_URL: postgres://...
    REDIS_URL: redis://...
    DOCKER_SOCKET: /var/run/docker.sock
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock  # Docker-in-Docker
  resources:
    memory: 256MB
    cpu: 0.5
```

**Responsibilities:**
- Container Lifecycle (docker-compose up/down per agent)
- Health Checks (ping agents, restart if dead)
- Event Bus (Redis Pub/Sub für Inter-Agent Comm)
- Scheduler (Cron für Agent Loops)
- State Queries (Postgres für Agent State)
- Escalation (Webhook zu Human bei Patt)

### 2. Head Agents (CEO, DAO)

```yaml
ceo-agent:
  image: aito-agent:latest
  environment:
    AGENT_TYPE: ceo
    AGENT_PROFILE: /profiles/ceo.md
    LOOP_INTERVAL: 3600  # 1h
    CLAUDE_MODEL: claude-sonnet-4-20250514
  volumes:
    - ./profiles/ceo.md:/profiles/ceo.md
    - ./memory/ceo:/memory
```

### 3. C-Level Agents (CMO, CTO, CFO, COO, CCO)

```yaml
cmo-agent:
  image: aito-agent:latest
  environment:
    AGENT_TYPE: cmo
    AGENT_PROFILE: /profiles/cmo.md
    LOOP_INTERVAL: 14400  # 4h
    GIT_REPO: og-shibaclassic/shiba-social
    GIT_FILTER: "content/*"
    DEPARTMENT: marketing
```

### 4. Worker Agents (On-Demand)

```yaml
# Dynamisch gestartet vom C-Level
worker-content-writer:
  image: aito-worker:latest
  environment:
    WORKER_TYPE: content-writer
    PARENT_AGENT: cmo
    TASK_ID: ${TASK_ID}
    AUTO_TERMINATE: true
```

---

## State Persistence Schema

### Postgres Tables

```sql
-- Agent Definitions
CREATE TABLE agents (
    id UUID PRIMARY KEY,
    type VARCHAR(50) NOT NULL,  -- ceo, dao, cmo, cto, cfo, coo, cco
    name VARCHAR(100) NOT NULL,
    profile_path VARCHAR(255),
    loop_interval INTEGER,  -- seconds
    git_repo VARCHAR(255),
    git_filter VARCHAR(255),
    status VARCHAR(20) DEFAULT 'inactive',  -- inactive, starting, active, stopping, error
    container_id VARCHAR(100),
    last_heartbeat TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Agent State (Persistent Memory)
CREATE TABLE agent_state (
    id UUID PRIMARY KEY,
    agent_id UUID REFERENCES agents(id),
    state_key VARCHAR(255) NOT NULL,
    state_value JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(agent_id, state_key)
);

-- Agent History (RAG Source)
CREATE TABLE agent_history (
    id UUID PRIMARY KEY,
    agent_id UUID REFERENCES agents(id),
    action_type VARCHAR(50),  -- decision, task, communication, error
    summary TEXT,
    details JSONB,
    embedding VECTOR(1536),  -- For RAG retrieval
    created_at TIMESTAMP DEFAULT NOW()
);

-- Decisions (For Veto Process)
CREATE TABLE decisions (
    id UUID PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    proposed_by UUID REFERENCES agents(id),
    decision_type VARCHAR(50),  -- minor, major, critical
    status VARCHAR(20) DEFAULT 'pending',  -- pending, approved, vetoed, escalated
    veto_round INTEGER DEFAULT 0,
    ceo_vote VARCHAR(20),  -- approve, veto, abstain
    dao_vote VARCHAR(20),
    c_level_votes JSONB,  -- {cmo: 'approve', cto: 'veto', ...}
    human_decision VARCHAR(20),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Tasks (Work Items)
CREATE TABLE tasks (
    id UUID PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assigned_to UUID REFERENCES agents(id),
    created_by UUID REFERENCES agents(id),
    status VARCHAR(20) DEFAULT 'pending',
    priority INTEGER DEFAULT 5,
    due_date TIMESTAMP,
    completed_at TIMESTAMP,
    result JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Events (Audit Log)
CREATE TABLE events (
    id UUID PRIMARY KEY,
    event_type VARCHAR(50),
    source_agent UUID REFERENCES agents(id),
    target_agent UUID REFERENCES agents(id),
    payload JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Redis Keys

```
# Agent Status (Fast Lookup)
agent:status:{agent_id} = {status, last_heartbeat, container_id}

# Event Bus (Pub/Sub Channels)
channel:broadcast           # All agents
channel:head                # CEO + DAO only
channel:clevel              # C-Level only
channel:agent:{agent_id}    # Specific agent

# Task Queues
queue:tasks:{agent_id}      # Pending tasks per agent
queue:urgent                # High-priority cross-department

# Rate Limiting
ratelimit:claude:{agent_id} # API rate limiting per agent

# Locks (Prevent Race Conditions)
lock:decision:{decision_id} # Decision being processed
lock:container:{agent_id}   # Container being started/stopped
```

---

## Agent Definition Schema

### Profile File Structure

```markdown
# /profiles/cmo.md

## Identity

**Name:** Chief Marketing Officer (CMO)
**Department:** Marketing
**Reports To:** CEO
**Manages:** Content Writers, Social Media, Community Growth

## Mission

Drive brand awareness, community growth, and engagement for Shiba Classic.
Ensure consistent messaging across all channels. Generate leads and
convert community members into active participants.

## Core Responsibilities

1. **Content Strategy**
   - Plan and approve all marketing content
   - Maintain brand voice consistency
   - Coordinate content calendar

2. **Social Media**
   - Monitor Twitter/X, Telegram, Discord engagement
   - Respond to trends and opportunities
   - Manage influencer relationships

3. **Community Growth**
   - Track community metrics (members, engagement, sentiment)
   - Identify growth opportunities
   - Report to CEO on community health

4. **Campaign Management**
   - Plan and execute marketing campaigns
   - Track campaign performance
   - Optimize based on results

## Decision Authority

### Can Decide Alone (Minor)
- Daily social media posts
- Response to community questions
- Content scheduling

### Needs CEO Approval (Major)
- New marketing campaigns (> $100 budget)
- Influencer partnerships
- Brand messaging changes

### Needs DAO Approval (Critical)
- Major rebrand initiatives
- Large budget allocations (> $1000)
- Strategic partnerships

## Loop Schedule

**Interval:** Every 4 hours
**Actions:**
1. Check pending tasks from CEO
2. Review social media metrics
3. Monitor community sentiment
4. Generate content ideas
5. Update status report for CEO

## Git Integration

**Repository:** og-shibaclassic/shiba-social
**Branch Filter:** main
**Path Filter:** content/*, campaigns/*
**Actions:**
- Create PRs for new content
- Review content submissions
- Merge approved content

## Communication Style

- Professional but approachable
- Data-driven arguments
- Focus on growth metrics
- Collaborative with other departments

## Escalation Rules

1. Negative sentiment spike (> 20%) → Immediate CEO alert
2. PR crisis → CEO + DAO emergency session
3. Budget overrun → CFO notification
4. Technical issues → CTO handoff
```

---

## Feedback Loop System

### Loop Types

#### 1. Agent Internal Loop (Continuous)

```
┌─────────────────────────────────────────┐
│           AGENT INTERNAL LOOP           │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  1. Wake Up (Scheduled/Event)   │   │
│  └──────────────┬──────────────────┘   │
│                 ▼                       │
│  ┌─────────────────────────────────┐   │
│  │  2. Load Context                │   │
│  │     • Profile (from file)       │   │
│  │     • State (from Postgres)     │   │
│  │     • Recent History (RAG)      │   │
│  │     • Pending Tasks (Redis)     │   │
│  └──────────────┬──────────────────┘   │
│                 ▼                       │
│  ┌─────────────────────────────────┐   │
│  │  3. Execute Loop                │   │
│  │     • Check external sources    │   │
│  │     • Process tasks             │   │
│  │     • Make decisions            │   │
│  │     • Delegate to workers       │   │
│  └──────────────┬──────────────────┘   │
│                 ▼                       │
│  ┌─────────────────────────────────┐   │
│  │  4. Persist & Report            │   │
│  │     • Save state to Postgres    │   │
│  │     • Log history               │   │
│  │     • Publish events to Redis   │   │
│  │     • Update heartbeat          │   │
│  └──────────────┬──────────────────┘   │
│                 ▼                       │
│  ┌─────────────────────────────────┐   │
│  │  5. Sleep until next interval   │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

#### 2. CEO Status Query Loop

```
┌─────────────────────────────────────────────────────────────┐
│                   CEO STATUS QUERY LOOP                      │
│                      (Every 1 hour)                          │
│                                                              │
│  CEO ──► Query CMO Status ──► Receive Report                │
│      ──► Query CTO Status ──► Receive Report                │
│      ──► Query CFO Status ──► Receive Report                │
│      ──► Query COO Status ──► Receive Report                │
│      ──► Query CCO Status ──► Receive Report                │
│                     │                                        │
│                     ▼                                        │
│            Aggregate & Analyze                               │
│                     │                                        │
│                     ▼                                        │
│         ┌─────────────────────┐                             │
│         │  Issues Detected?   │                             │
│         └──────────┬──────────┘                             │
│                    │                                         │
│         ┌─────YES──┴──NO─────┐                              │
│         ▼                    ▼                               │
│    Create Tasks         Continue                            │
│    for C-Level          Monitoring                          │
└─────────────────────────────────────────────────────────────┘
```

#### 3. Decision/Veto Loop

```
┌─────────────────────────────────────────────────────────────┐
│                    DECISION/VETO LOOP                        │
│                                                              │
│  C-Level proposes Major Decision                            │
│                     │                                        │
│                     ▼                                        │
│  ┌─────────────────────────────────┐                        │
│  │      ROUND 1: CEO + DAO Vote     │                       │
│  └──────────────┬──────────────────┘                        │
│                 │                                            │
│    ┌────────────┼────────────┐                              │
│    ▼            ▼            ▼                               │
│  Both        One Veto     Both Veto                         │
│  Approve                                                     │
│    │            │            │                               │
│    ▼            ▼            ▼                               │
│  APPROVED   ROUND 2      REJECTED                           │
│                 │                                            │
│                 ▼                                            │
│  ┌─────────────────────────────────┐                        │
│  │   ROUND 2: C-Level Analysis     │                        │
│  │   (All C-Level give input)      │                        │
│  └──────────────┬──────────────────┘                        │
│                 │                                            │
│                 ▼                                            │
│  ┌─────────────────────────────────┐                        │
│  │   ROUND 3: Final Vote           │                        │
│  │   CEO + DAO + C-Level Majority  │                        │
│  └──────────────┬──────────────────┘                        │
│                 │                                            │
│    ┌────────────┼────────────┐                              │
│    ▼            ▼            ▼                               │
│  Clear       Still        PATT                              │
│  Majority    Unclear                                         │
│    │            │            │                               │
│    ▼            ▼            ▼                               │
│  DECISION   More         HUMAN                              │
│  MADE       Discussion   DECIDES                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Inter-Agent Communication

### Message Types

```typescript
interface AgentMessage {
  id: string;
  type: 'task' | 'status_request' | 'status_response' | 'decision' |
        'vote' | 'alert' | 'broadcast' | 'direct';
  from: AgentId;
  to: AgentId | 'all' | 'head' | 'clevel';
  payload: any;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  timestamp: Date;
  requires_response: boolean;
  response_deadline?: Date;
}

// Examples
const statusRequest: AgentMessage = {
  id: 'msg-001',
  type: 'status_request',
  from: 'ceo',
  to: 'cmo',
  payload: { include: ['metrics', 'pending_tasks', 'blockers'] },
  priority: 'normal',
  timestamp: new Date(),
  requires_response: true,
  response_deadline: new Date(Date.now() + 300000)  // 5 min
};

const taskAssignment: AgentMessage = {
  id: 'msg-002',
  type: 'task',
  from: 'ceo',
  to: 'cmo',
  payload: {
    task_id: 'task-123',
    title: 'Create announcement for new partnership',
    description: 'Draft Twitter thread and Telegram message',
    deadline: '2024-12-11T12:00:00Z',
    priority: 'high'
  },
  priority: 'high',
  timestamp: new Date(),
  requires_response: true
};
```

### Redis Pub/Sub Flow

```
Publisher (CMO)                    Redis                    Subscribers
     │                               │                           │
     │  PUBLISH channel:head         │                           │
     │  {type: 'decision',           │                           │
     │   title: 'New Campaign'}      │                           │
     │ ─────────────────────────────►│                           │
     │                               │  Deliver to CEO           │
     │                               │ ─────────────────────────►│ CEO
     │                               │  Deliver to DAO           │
     │                               │ ─────────────────────────►│ DAO
     │                               │                           │
```

---

## Git Integration per Department

### Repository Structure

```
Organization: og-shibaclassic
│
├── shiba-classic-website     # Main website (CTO)
├── shiba-social              # Social content (CMO)
├── shiba-treasury            # Financial records (CFO)
├── shiba-community           # Community resources (COO)
├── shiba-legal               # Compliance docs (CCO)
└── shiba-dao                 # Governance proposals (DAO)
```

### Agent Git Actions

```typescript
interface GitConfig {
  repo: string;
  branch: string;
  pathFilter?: string;
  permissions: ('read' | 'write' | 'admin')[];
}

const agentGitConfigs: Record<AgentType, GitConfig> = {
  ceo: {
    repo: 'og-shibaclassic/*',  // Access to all
    branch: 'main',
    permissions: ['read', 'admin']
  },
  cmo: {
    repo: 'og-shibaclassic/shiba-social',
    branch: 'main',
    pathFilter: 'content/*',
    permissions: ['read', 'write']
  },
  cto: {
    repo: 'og-shibaclassic/shiba-classic-website',
    branch: 'main',
    permissions: ['read', 'write', 'admin']
  },
  cfo: {
    repo: 'og-shibaclassic/shiba-treasury',
    branch: 'main',
    permissions: ['read', 'write']
  },
  // ...
};
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Orchestrator Container (Docker-in-Docker)
- [ ] Postgres Schema + Migrations
- [ ] Redis Pub/Sub Setup
- [ ] Basic Agent Container Template
- [ ] Health Check System

### Phase 2: Head Layer (Week 2-3)
- [ ] CEO Agent Profile + Container
- [ ] DAO Agent Profile + Container
- [ ] Veto Loop Implementation
- [ ] Head Communication Channel

### Phase 3: C-Level Layer (Week 3-4)
- [ ] CMO Agent (Marketing)
- [ ] CTO Agent (Tech)
- [ ] CFO Agent (Treasury)
- [ ] COO Agent (Community)
- [ ] CCO Agent (Compliance)

### Phase 4: Integration (Week 4-5)
- [ ] Git Integration per Department
- [ ] External API Connections
- [ ] RAG History System
- [ ] Worker Spawning System

### Phase 5: Autonomy (Week 5-6)
- [ ] Full Loop Activation
- [ ] Self-Healing Containers
- [ ] Idea Generation System
- [ ] Human Escalation Interface

---

## Open Questions

1. **Claude Code vs API?**
   - Option A: Each container runs Claude Code CLI with shared auth
   - Option B: Central Claude API proxy with rate limiting
   - Recommendation: Hybrid - CLI for complex tasks, API for simple

2. **Container Lifecycle**
   - C-Level: Always running or on-demand?
   - Recommendation: Always running with sleep intervals (cheaper than restart)

3. **Context Management**
   - How much history per agent?
   - Recommendation: Last 50 actions + RAG for older relevant context

4. **Budget/Cost Tracking**
   - Who monitors Claude usage?
   - Recommendation: Orchestrator tracks, CFO reports anomalies

5. **Failure Recovery**
   - What if CEO container dies?
   - Recommendation: Orchestrator auto-restarts, DAO takes temporary lead
