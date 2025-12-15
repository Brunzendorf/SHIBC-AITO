# AITO Architecture

## System Overview

AITO is a multi-agent autonomous system where AI agents collaborate to manage the Shiba Classic project.

## Components

### 1. Agent Containers

Each agent runs in its own Docker container:
- **CEO** - Strategic decisions, final authority
- **DAO** - Governance, voting, community decisions
- **CMO** - Marketing, social media, community
- **CTO** - Technical development, infrastructure
- **CFO** - Treasury, financial operations
- **COO** - Operations, community management
- **CCO** - Compliance, legal, risk

### 2. Agent Daemon

Each agent container runs a lightweight Node.js daemon that:
- Subscribes to Redis channels for messages
- Runs on scheduled intervals (cron)
- Triggers Claude Code sessions on events
- Persists state to Redis
- Spawns MCP Workers for external tools

### 3. Redis Pub/Sub

Central event bus for agent communication:
```
channel:agent:<uuid>     - Direct messages to agent
channel:broadcast        - System-wide broadcasts
channel:worker:logs      - Worker execution logs
```

### 4. MCP Workers

Short-lived Claude Code sessions for external tool access:
- Dynamically configured with only needed MCP servers
- Execute tasks and return results
- Logged to dashboard

### 5. Dashboard

Next.js web interface for:
- Agent status monitoring
- Decision management
- Worker logs
- System health

## Data Flow

```
1. Trigger (message/cron/webhook)
        |
2. Daemon receives event
        |
3. Build prompt (profile + state + RAG context)
        |
4. Execute Claude Code session
        |
5. Parse JSON response
        |
6. Execute actions:
   - operational: file writes, git commits
   - message: send to other agents
   - spawn_worker: MCP tool access
   - decision: start decision process
        |
7. Persist state, send results
```

## Decision Flow

```
Agent proposes decision
        |
CEO/DAO review (depending on tier)
        |
Approved? --> Execute
        |
Vetoed? --> Back to proposer (max 3 rounds)
        |
Deadlock? --> Human escalation
```
