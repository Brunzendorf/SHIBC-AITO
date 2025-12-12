# MCP & Worker Agent Architecture

## Overview

AITO uses a hybrid architecture combining:
- **C-Level Agents**: Strategic decision makers (long-running, stateful)
- **Worker Agents**: Task executors (short-lived, stateless)
- **N8N Flows**: Scheduled/repetitive automations
- **MCP Servers**: Tool providers for external services

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                    C-Level Agents                        │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐│
│  │ CEO │ │ DAO │ │ CMO │ │ CTO │ │ CFO │ │ COO │ │ CCO ││
│  └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘│
│     │       │       │       │       │       │       │    │
│     └───────┴───────┴───┬───┴───────┴───────┴───────┘    │
│                         │                                 │
│                    ┌────┴────┐                           │
│                    │ Message │                           │
│                    │  Bus    │                           │
│                    │ (Redis) │                           │
│                    └────┬────┘                           │
└─────────────────────────┼────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
         ▼                ▼                ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│    N8N      │   │   Worker    │   │ Orchestrator│
│   Flows     │   │   Agents    │   │   (Node)    │
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │                 │                 │
       └─────────────────┼─────────────────┘
                         │
                    ┌────┴────┐
                    │   MCP   │
                    │ Servers │
                    └────┬────┘
                         │
    ┌────────────────────┼────────────────────┐
    │         │          │          │         │
    ▼         ▼          ▼          ▼         ▼
┌───────┐ ┌───────┐ ┌─────────┐ ┌───────┐ ┌────────┐
│Twitter│ │Telegram│ │Directus │ │GitHub │ │Ethereum│
└───────┘ └───────┘ └─────────┘ └───────┘ └────────┘
```

## Component Roles

### C-Level Agents
- **Purpose**: Strategic thinking, decision making
- **Lifecycle**: Long-running, persistent state
- **Context**: Full conversation history, RAG memory
- **Spawns**: Worker agents for specific tasks

### Worker Agents
- **Purpose**: Execute specific tasks
- **Lifecycle**: Short-lived, terminates after task
- **Context**: Minimal, task-specific
- **Tools**: MCP servers for external services

### N8N Flows
- **Purpose**: Scheduled, repetitive automations
- **Lifecycle**: Triggered by schedule or webhook
- **Use Cases**:
  - Hourly Twitter mention fetch
  - Daily treasury balance check
  - Price alert monitoring
  - News aggregation

### MCP Servers
- **Purpose**: Provide tools to agents
- **Protocol**: Model Context Protocol (Anthropic)
- **Advantages**:
  - Standardized interface
  - Language-agnostic
  - Reusable across agents

## MCP Servers to Implement

| Server | Purpose | Used By |
|--------|---------|---------|
| **@anthropic/mcp-twitter** | Twitter API access | CMO |
| **@anthropic/mcp-telegram** | Telegram Bot API | COO, CMO |
| **directus-mcp** | Directus CMS | CTO |
| **@anthropic/mcp-github** | GitHub API | CTO, all |
| **etherscan-mcp** | Blockchain data | CFO |
| **@anthropic/mcp-filesystem** | Local file access | All |

## Worker Agent Design

### Spawning Pattern
```typescript
// C-Level agent requests worker
const workerResult = await spawnWorker({
  task: 'fetch_twitter_mentions',
  params: { query: '$SHIBC', since: '24h' },
  mcpServers: ['twitter'],
  timeout: 60000,
});

// Worker executes and returns
interface WorkerResult {
  success: boolean;
  data: unknown;
  tokensUsed: number;
  durationMs: number;
}
```

### Worker Lifecycle
```
1. Spawn with task + MCP config
2. Initialize MCP connections
3. Execute task (single prompt)
4. Return result
5. Terminate (no state retained)
```

### Token Efficiency
- Workers use minimal context
- No conversation history
- Single-purpose prompts
- Results summarized before return

## N8N Integration

### Webhook Endpoints
```
POST /webhook/twitter-mentions
POST /webhook/price-alert
POST /webhook/treasury-check
POST /webhook/news-fetch
```

### Flow → Agent Communication
```typescript
// N8N calls orchestrator API
POST /api/events
{
  "type": "n8n_data",
  "source": "twitter-mentions",
  "data": { ... }
}

// Orchestrator routes to appropriate agent
```

### Scheduled Flows

| Flow | Schedule | Target |
|------|----------|--------|
| Twitter Mentions | */15 min | CMO |
| Price Check | */5 min | CFO |
| Treasury Balance | */1 hour | CFO |
| News Aggregation | */30 min | CMO |
| Community Stats | */1 hour | COO |

## Implementation Plan

### Phase 1: MCP Server Setup
1. Install `directus-mcp` for CTO
2. Configure `mcp-github` for PR workflow
3. Test with single agent

### Phase 2: Worker Agent System
1. Create `src/workers/` directory
2. Implement worker spawning in daemon
3. Add MCP initialization
4. Test worker → C-Level communication

### Phase 3: N8N Flows
1. Create base flows for each data source
2. Configure webhooks to orchestrator
3. Set up schedules
4. Test data flow to agents

### Phase 4: Integration
1. Connect C-Level → Worker → MCP
2. Connect N8N → Orchestrator → Agent
3. End-to-end testing
4. Documentation

## Configuration

### MCP Server Config
```json
// .claude/mcp_servers.json
{
  "servers": {
    "directus": {
      "command": "npx",
      "args": ["directus-mcp"],
      "env": {
        "DIRECTUS_URL": "${DIRECTUS_URL}",
        "DIRECTUS_TOKEN": "${DIRECTUS_TOKEN}"
      }
    },
    "github": {
      "command": "npx",
      "args": ["@anthropic/mcp-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

### N8N Environment
```env
N8N_WEBHOOK_URL=http://n8n:5678
N8N_API_KEY=xxx
```

## Benefits

1. **Token Efficiency**: Workers use minimal context
2. **Separation of Concerns**: Strategy vs. execution
3. **Scalability**: Workers can run in parallel
4. **Reliability**: N8N handles retries/scheduling
5. **Extensibility**: Add new MCP servers easily
