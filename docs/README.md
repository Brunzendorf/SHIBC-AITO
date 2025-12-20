# AITO 3.0 Documentation

> **AI Team Orchestrator** - Autonomes Multi-Agent System for Shiba Classic ($SHIBC)
>
> Version: 3.0 | Last Updated: 2025-12-20

---

## Quick Start

```bash
# Start all services
docker compose up -d

# Start with agents
docker compose --profile agents up -d

# View Dashboard
open http://localhost:3000
```

---

## AI Assistant Guide

**[AI-PROMPT-LIBRARY.md](./AI-PROMPT-LIBRARY.md)** - Strukturierte Prompts und Workflows für AI-Assistenten

Enthält:
- 7-Phasen-Workflow für Feature-Implementierung
- Template-Prompts für alle gängigen Aufgaben
- Modul-spezifische Anleitungen
- Task-Abhaken-Format
- Beispiel-Workflows

---

## Documentation Overview

### Core Documentation

| Document | Description |
|----------|-------------|
| [AITO-3.0-COMPLETE.md](./AITO-3.0-COMPLETE.md) | Complete system overview, architecture, configuration |
| [FEATURE-REFERENCE.md](./FEATURE-REFERENCE.md) | Full feature reference with 500+ functions and status |
| [TASK-BACKLOG.md](./TASK-BACKLOG.md) | 36 identified tasks/bugs from code review (~165h effort) |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | High-level system architecture diagram |

---

## Detailed Feature Documentation

In-depth documentation for each system module with function signatures, interfaces, examples, and known issues:

| Module | File | Description | Status |
|--------|------|-------------|--------|
| Database Layer | [01-DATABASE-LAYER.md](./features/01-DATABASE-LAYER.md) | PostgreSQL repositories, state management, volatile state, RAG | 90% |
| Agent System | [02-AGENT-SYSTEM.md](./features/02-AGENT-SYSTEM.md) | Daemon, Claude wrapper, profile loader, state, workspace, initiative | 90% |
| Worker System | [03-WORKER-SYSTEM.md](./features/03-WORKER-SYSTEM.md) | MCP workers, spawner, archive worker, backlog groomer | 85% |
| Orchestrator | [04-ORCHESTRATOR.md](./features/04-ORCHESTRATOR.md) | REST API, WebSocket, health monitoring, container management, scheduler | 80% |
| LLM System | [05-LLM-SYSTEM.md](./features/05-LLM-SYSTEM.md) | Router, Claude/Gemini/OpenAI providers, model selection, quota, benchmarks | 90% |
| Dashboard | [06-DASHBOARD.md](./features/06-DASHBOARD.md) | Next.js UI, API client, hooks, pages, components | 85% |

---

## Technical Reference

### Agent System

| Document | Description |
|----------|-------------|
| [AGENT_PROFILES.md](./AGENT_PROFILES.md) | Agent profile configuration and Markdown format |
| [AUTONOMOUS_INITIATIVE.md](./AUTONOMOUS_INITIATIVE.md) | Agent initiative system for autonomous proposals |

### Worker & MCP

| Document | Description |
|----------|-------------|
| [MCP_WORKERS.md](./MCP_WORKERS.md) | External tool access via MCP servers |
| [MCP-WORKER-ARCHITECTURE.md](./MCP-WORKER-ARCHITECTURE.md) | Detailed MCP worker implementation |
| [CLAUDE-CODE-DOCKER.md](./CLAUDE-CODE-DOCKER.md) | Running Claude Code in Docker containers |

### API & Configuration

| Document | Description |
|----------|-------------|
| [API.md](./API.md) | Orchestrator REST API endpoints |
| [ENVIRONMENT-VARIABLES.md](./ENVIRONMENT-VARIABLES.md) | All configuration environment variables |

---

## Workflow Documentation

| Document | Description |
|----------|-------------|
| [SCRUMBAN_WORKFLOW.md](./SCRUMBAN_WORKFLOW.md) | GitHub-based Kanban workflow with labels |
| [TIERED-APPROVAL.md](./TIERED-APPROVAL.md) | Decision tier system (operational, minor, major, critical) |
| [PR-QUALITY-GATE.md](./PR-QUALITY-GATE.md) | Pull request review and RAG approval process |

---

## Integration Guides

| Document | Description |
|----------|-------------|
| [TG-BOT-DAO-VOTING.md](./TG-BOT-DAO-VOTING.md) | Telegram bot integration for DAO voting |
| [DIRECTUS_SCHEMA.md](./DIRECTUS_SCHEMA.md) | Directus CMS integration schema |
| [TWITTER_PERSONA.md](./TWITTER_PERSONA.md) | X/Twitter persona and content guidelines |

---

## Operations & Deployment

| Document | Description |
|----------|-------------|
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Docker deployment guide |
| [CONTAINER-MANAGEMENT.md](./CONTAINER-MANAGEMENT.md) | Docker container operations |
| [DASHBOARD-REQUIREMENTS.md](./DASHBOARD-REQUIREMENTS.md) | Dashboard UI specifications |

---

## System Status

### Overall Completion: ~87%

| Component | Status | Notes |
|-----------|--------|-------|
| Database Layer | 90% | Volatile state needs cleanup job |
| Agent System | 90% | Initiative dedup working |
| Worker System | 85% | Domain whitelist functional |
| Orchestrator | 80% | Missing auth, rate limiting |
| LLM System | 90% | Multi-provider routing working |
| Dashboard | 85% | Missing container logs |

### Critical Issues

| Priority | Count | Focus Area |
|----------|-------|------------|
| Critical | 8 | API Auth, Rate Limiting, Security |
| High | 14 | Error handling, Validation, Performance |
| Medium | 10 | Features, Polish |
| Low | 4 | Nice-to-have |

See [TASK-BACKLOG.md](./TASK-BACKLOG.md) for complete list.

---

## File Structure

```
docs/
├── README.md                    # This file
├── AI-PROMPT-LIBRARY.md        # AI Assistant prompts & workflows
├── AITO-3.0-COMPLETE.md        # Full system documentation
├── FEATURE-REFERENCE.md        # Feature inventory
├── TASK-BACKLOG.md             # Issue backlog
├── ARCHITECTURE.md             # Architecture overview
│
├── features/                   # Detailed module docs
│   ├── 01-DATABASE-LAYER.md
│   ├── 02-AGENT-SYSTEM.md
│   ├── 03-WORKER-SYSTEM.md
│   ├── 04-ORCHESTRATOR.md
│   ├── 05-LLM-SYSTEM.md
│   └── 06-DASHBOARD.md
│
├── API.md                      # REST API reference
├── ENVIRONMENT-VARIABLES.md    # Config reference
├── AGENT_PROFILES.md           # Agent configuration
├── MCP_WORKERS.md              # MCP tool access
├── MCP-WORKER-ARCHITECTURE.md  # MCP implementation
├── CLAUDE-CODE-DOCKER.md       # Docker + Claude
│
├── SCRUMBAN_WORKFLOW.md        # Kanban workflow
├── TIERED-APPROVAL.md          # Decision tiers
├── PR-QUALITY-GATE.md          # PR review process
├── AUTONOMOUS_INITIATIVE.md    # Agent initiatives
│
├── TG-BOT-DAO-VOTING.md        # Telegram integration
├── DIRECTUS_SCHEMA.md          # CMS integration
├── TWITTER_PERSONA.md          # Social media persona
│
├── DEPLOYMENT.md               # Deployment guide
├── CONTAINER-MANAGEMENT.md     # Container ops
└── DASHBOARD-REQUIREMENTS.md   # UI specs
```

---

## Contributing

When adding new documentation:

1. Create file in appropriate section
2. Add link to this README
3. Follow existing format (German/English mixed is OK)
4. Include status indicators where applicable
5. Reference TASK-IDs for known issues
