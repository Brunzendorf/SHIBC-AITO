# SHIBC-AITO - Claude Code Context

## Project Overview

**AITO (AI Autonomous Operations)** - Autonomous AI CEO System for Shiba Classic ($SHIBC)

## Repository Structure

This project spans **two repositories**:

### 1. SHIBC-AITO (THIS REPO)
- **URL:** https://github.com/Brunzendorf/SHIBC-AITO
- **Purpose:** AITO autonomous agent system code
- **Contains:** Orchestrator, Agent containers, MCP servers, workflows

### 2. shiba-classic-website (ISSUES REPO)
- **URL:** https://github.com/og-shibaclassic/shiba-classic-website
- **Purpose:** Main website + Issue tracking for ALL SHIBC projects
- **Contains:** Website code, GitHub Issues for AITO (#21-#37)

## GitHub Issues Reference

All AITO issues are tracked in `og-shibaclassic/shiba-classic-website`:

| # | Issue | Priority |
|---|-------|----------|
| #25 | Orchestrator Container | CRITICAL |
| #26 | Base Agent Container | CRITICAL |
| #36 | Database Schema | CRITICAL |
| #27 | CEO Agent | HIGH |
| #28 | DAO Agent | HIGH |
| #31-#35 | C-Level Agents | HIGH/MEDIUM |
| #29 | N8N Workflows | HIGH |
| #30 | Ollama Integration | HIGH |
| #37 | Human Escalation | HIGH |

## Architecture

```
Orchestrator (Always Running, NO AI)
├── Container Lifecycle (Docker-in-Docker)
├── Event Bus (Redis Pub/Sub)
├── Scheduler (Cron for Agent Loops)
├── Health Checks
└── Human Escalation Interface

HEAD Layer (CEO + DAO)
├── Veto System (3 rounds → Human)
└── Major Decision Approval

C-Level Layer (CMO, CTO, CFO, COO, CCO)
├── Department-specific loops
├── Own Git domains
└── Worker spawning

Workers (On-Demand)
└── Spawned by C-Level, auto-terminate
```

## Tech Stack

- **Runtime:** Node.js 20+ / TypeScript 5.3+
- **AI:** Claude Code CLI (Max Plan $200/mo) + Ollama (local)
- **Database:** PostgreSQL 15 (pgvector) + Redis 7
- **Workflows:** N8N (self-hosted)
- **Translation:** DeepL API (500k chars/mo free)
- **Container:** Docker with Docker-in-Docker

## Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| AI Engine | Claude Code CLI | $200/mo flat vs $12k API |
| AI Trigger | Event-based | No 24/7 AI cost |
| State | PostgreSQL | ACID, JSONB, pgvector |
| Cache/Pub-Sub | Redis | Fast, reliable |
| Git | Mono-repo | Managers see big picture |
| Human Interface | Multi-channel | Telegram + Dashboard + Email |

## Development Commands

```bash
# Start infrastructure
docker-compose up -d postgres redis ollama qdrant

# Start orchestrator (dev mode)
npm run dev

# Build orchestrator
npm run build

# Run tests
npm test

# Type check
npm run typecheck
```

## Agent Execution Model

```
Lightweight Daemon (Node.js, 24/7, NO AI cost)
├── Redis Subscribe (events)
├── Cron (scheduled intervals)
├── Webhooks (external triggers)
│
└── ONLY on trigger:
    Claude Code Session
    ├── Load context (profile + state + RAG)
    ├── Execute task
    ├── Persist result
    └── Terminate
```

## File Structure

```
src/
├── orchestrator/          # Central coordinator
│   ├── index.ts           # Entry point
│   ├── container.ts       # Docker management
│   ├── scheduler.ts       # Cron jobs
│   ├── events.ts          # Redis Pub/Sub
│   ├── health.ts          # Health checks
│   └── api.ts             # REST API
├── agents/                # Agent base classes
│   ├── base.ts            # BaseAgent class
│   ├── daemon.ts          # Lightweight daemon
│   └── claude.ts          # Claude Code integration
├── lib/                   # Shared libraries
│   ├── db.ts              # PostgreSQL client
│   ├── redis.ts           # Redis client
│   ├── ollama.ts          # Ollama client
│   └── types.ts           # TypeScript types
└── mcp/                   # Custom MCP servers
    ├── state/             # Agent state MCP
    ├── events/            # Event bus MCP
    └── tasks/             # Task management MCP
```

## Environment Variables

See `.env.example` for full list. Key ones:

```bash
# Database
POSTGRES_URL=postgres://aito:password@localhost:5432/aito
REDIS_URL=redis://localhost:6379

# Docker
DOCKER_SOCKET=/var/run/docker.sock

# AI
ANTHROPIC_API_KEY=sk-...  # Fallback only
OLLAMA_URL=http://localhost:11434

# Communication
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ADMIN_CHAT_ID=...
```

## Notes

- Orchestrator runs 24/7 but uses NO AI (pure Node.js)
- AI (Claude Code) only invoked on specific triggers
- Each agent has own profile in `/profiles/{agent}.md`
- Veto deadlock after 3 rounds → Human decides
