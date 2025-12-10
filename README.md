# AITO 2.0 - Autonomous AI CEO System

**Shiba Classic ($SHIBC) - AI-Driven Autonomous Project Management**

## Vision

Ein 100% autonomes System, das:
- Via API und MCP mit der Außenwelt interagiert
- Das Projekt mit eigenen Ideen vorantreibt
- Feedback-Schleifen zwischen Abteilungen koordiniert
- Entscheidungen durch CEO + DAO validiert
- Container dynamisch startet und beendet

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR                            │
│              (Container Lifecycle, Event Bus)                │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼─────────────────────────┐
│                      HEAD LAYER                        │
│              CEO ◄────────────► DAO                   │
│                    (Veto-Recht)                        │
└───────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼─────────────────────────┐
│                    C-LEVEL LAYER                       │
│     CMO │ CTO │ CFO │ COO │ CCO                       │
│   (Marketing, Tech, Treasury, Community, Compliance)   │
└───────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼─────────────────────────┐
│                    WORKER LAYER                        │
│         (On-Demand, Task-Specific, Auto-Terminate)    │
└───────────────────────────────────────────────────────┘
```

## Project Structure

```
├── docs/                    # Architecture & Requirements
├── profiles/                # Agent Profiles (System Prompts)
├── src/
│   ├── orchestrator/        # Central Coordinator
│   ├── agents/              # Agent Implementations
│   ├── lib/                 # Shared Libraries
│   └── mcp/                 # MCP Server Implementations
├── config/                  # Configuration Files
├── docker/                  # Dockerfiles
├── n8n-workflows/           # N8N Workflow Exports
└── scripts/                 # Utility Scripts
```

## Tech Stack

- **Runtime:** Node.js 20+ with TypeScript
- **AI:** Claude Code CLI (Max Plan) + Ollama (Local)
- **Database:** PostgreSQL 15 + Redis 7
- **Workflows:** N8N (Self-hosted)
- **Containers:** Docker with Docker-in-Docker
- **Translation:** DeepL API

## Quick Start

```bash
# Clone
git clone https://github.com/og-shibaclassic/aito-system.git
cd aito-system

# Setup
cp .env.example .env
# Edit .env with your credentials

# Start Infrastructure
docker-compose up -d postgres redis ollama

# Start Orchestrator
docker-compose up -d orchestrator

# Initialize Agents
./scripts/init-agents.sh
```

## Documentation

- [Architecture](docs/AITO-2.0-ARCHITECTURE.md)
- [Requirements](docs/AITO-2.0-REQUIREMENTS.md)
- [Agent Profiles](profiles/)

## Monthly Costs

| Service | Cost |
|---------|------|
| Claude Max Plan | $200 |
| Everything else | $0 (Free Tiers + Existing Infra) |
| **Total** | **$200/month** |

## License

MIT

## Links

- Website: https://shibaclassic.io
- Telegram: https://t.me/shibaclassic
- Twitter: https://x.com/shibaclassic
