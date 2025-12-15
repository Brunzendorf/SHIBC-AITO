# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AITO 3.0 (AI Autonomous Operations)** - Autonomous AI Agent System for Shiba Classic ($SHIBC)

A multi-agent system where AI agents (CEO, CMO, CTO, CFO, COO, CCO, DAO) collaborate autonomously to manage the Shiba Classic project.

## Quick Start

```bash
# Start all services
docker compose up -d

# View logs
docker logs -f aito-cmo

# Send test message to agent
docker exec aito-redis redis-cli PUBLISH "channel:agent:<AGENT_UUID>" '{"type":"task","from":"human","payload":{"title":"Test"}}'
```

## Architecture Overview

```
Dashboard (Next.js) --> Redis Pub/Sub --> Agents (CEO, CMO, CTO, CFO, COO, CCO, DAO)
                                              |
                                         MCP Workers
                                              |
                            [Telegram] [Filesystem] [Fetch]
```

## MCP Worker System

Agents use **MCP Workers** for external tool access. Workers are short-lived Claude Code sessions with native MCP tool access.

### Spawn Worker Format (CRITICAL)

```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Send message to Telegram channel -1002876952840: Hello!",
    "servers": ["telegram"],
    "timeout": 60000
  }]
}
```

### Available MCP Servers

- `telegram` - Telegram Bot API
- `fetch` - HTTP requests  
- `filesystem` - File access

## Agent Communication

Redis channels:
- `channel:agent:<uuid>` - Direct messages
- `channel:broadcast` - All-agent broadcasts
- `channel:worker:logs` - Worker logs for dashboard

Message types that trigger AI: `task`, `decision`, `alert`, `vote`, `worker_result`

## File Structure

```
src/
├── agents/           # Agent daemon, Claude, profile, state
├── workers/          # MCP Worker implementation
├── lib/              # DB, Redis, logger, types
└── orchestrator/     # Main entry

profiles/             # Agent markdown profiles
dashboard/            # Next.js web UI
docker/               # Dockerfiles
.claude/mcp_servers.json
```

## Key Files

| File | Purpose |
|------|---------|
| `src/workers/worker.ts` | MCP Worker with dynamic config |
| `src/workers/spawner.ts` | Async worker spawning, publishes to Redis |
| `src/agents/daemon.ts` | Agent loop, handles spawn_worker |
| `src/agents/claude.ts` | Claude Code CLI execution, output parsing |
| `src/agents/profile.ts` | Profile loading, MCP section extraction |
| `src/lib/rag.ts` | RAG system with Qdrant + Ollama embeddings |
| `profiles/*.md` | Agent profiles with MCP docs |

## Development

```bash
# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Build TypeScript
npm run build

# Type check without emit
npm run typecheck

# Run tests
npm test                  # Single run
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage

# Lint
npm run lint

# Database migrations
npm run db:migrate
npm run db:seed
```

### Dashboard Development

```bash
cd dashboard
npm install
npm run dev              # http://localhost:3000
```

### Docker (Production)

```bash
# Start all infrastructure
docker compose up -d

# Start with agents
docker compose --profile agents up -d

# Rebuild specific service
docker compose up -d --build cmo-agent
```

### Environment Setup

```bash
cp .env.example .env
# Edit .env with required credentials (POSTGRES_PASSWORD, N8N_ENCRYPTION_KEY, etc.)
```

## Troubleshooting

- **Wrong spawn_worker format**: Check profile has MCP Workers section
- **Invalid action error**: Need `type`, `task`, `servers` fields
- **Claude unavailable**: Check auth in container
- no ANTHROPIC_API_KEY usage in the complete AITO system! we use the installed claude code via cli!!!!