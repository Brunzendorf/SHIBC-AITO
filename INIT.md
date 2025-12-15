# AITO Project Initialization

> **Read this first when starting a new Claude Code session on AITO**

## Project Summary

AITO 3.0 is an autonomous multi-agent AI system for Shiba Classic ($SHIBC). Seven AI agents (CEO, CMO, CTO, CFO, COO, CCO, DAO) collaborate via Redis Pub/Sub to manage the project autonomously.

## Critical Knowledge

### MCP Worker System (MOST IMPORTANT)

Agents access external tools (Telegram, APIs, filesystem) via **MCP Workers**. The spawn format is CRITICAL:

```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Natural language task description",
    "servers": ["telegram"],
    "timeout": 60000
  }]
}
```

**Key files:**
- `src/workers/worker.ts` - Worker implementation
- `src/agents/daemon.ts` - Handles spawn_worker actions
- `src/agents/profile.ts` - Extracts MCP section for system prompt
- `profiles/*.md` - Agent profiles (must include MCP Workers section)

### Agent Profile Structure

Each profile in `/profiles/` MUST include:
```markdown
## MCP Workers - External Tool Access
### Available MCP Servers
- telegram, fetch, filesystem
### Spawn Worker Format
{ "type": "spawn_worker", "task": "...", "servers": ["..."] }
```

This section is auto-extracted by `extractMCPWorkersSection()` in profile.ts.

## Key Commands

```bash
# Build
npm run build

# Start Docker services
docker compose up -d

# View agent logs
docker logs -f aito-cmo

# Send message to agent
docker exec aito-redis redis-cli PUBLISH "channel:agent:<UUID>" '{"type":"task",...}'

# Rebuild agent image
docker build -f docker/Dockerfile.agent -t shibc-aito-cmo-agent .
```

## File Structure Quick Reference

```
src/agents/daemon.ts    → Main agent loop, action handling
src/agents/claude.ts    → Claude Code execution
src/agents/profile.ts   → Profile parsing, system prompt generation
src/workers/worker.ts   → MCP Worker (dynamic config, native tools)
src/lib/redis.ts        → Redis channels definition
profiles/*.md           → Agent behavior profiles
.claude/mcp_servers.json → MCP server configuration
dashboard/              → Next.js web UI
```

## Common Tasks

### Adding new MCP server
1. Add to `.claude/mcp_servers.json`
2. Document in agent profiles that need it
3. Rebuild agent containers

### Fixing "Invalid spawn_worker action"
- Check action has `type`, `task` (string), `servers` (array)
- Check profile has MCP Workers section

### Agent not following format
- Verify `profile.ts` has `extractMCPWorkersSection()` 
- Check `systemPromptLength` in logs includes MCP section (~3500+ chars for CMO)

## Architecture Diagram

```
Dashboard → Redis Pub/Sub → Agent Daemons → Claude Code Sessions
                                ↓
                          MCP Workers
                                ↓
                    [Telegram] [Fetch] [Filesystem]
```

## Documentation

- `CLAUDE.md` - Main project context
- `docs/ARCHITECTURE.md` - System architecture
- `docs/MCP_WORKERS.md` - MCP Worker details
- `docs/AGENT_PROFILES.md` - Profile structure
- `docs/DEPLOYMENT.md` - Docker deployment

## GitHub Issues

All AITO issues are now in this repo (#21-#38). Key ones:
- #25 Orchestrator Container
- #26 Base Agent Container  
- #27-#35 Agent implementations
- #38 Dashboard

## Environment

```bash
POSTGRES_URL=postgresql://aito:...@postgres:5432/aito
REDIS_URL=redis://redis:6379
TELEGRAM_BOT_TOKEN=...
GITHUB_TOKEN=...
```

## Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| Claude unavailable in container | Check `/app/.claude` auth |
| Worker timeout | Increase timeout or simplify task |
| Agent wrong format | Check profile MCP section |
| Container not starting | Check `docker logs aito-<agent>` |
