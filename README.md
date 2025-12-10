# AITO 2.0 - Autonomous AI CEO System

**Shiba Classic ($SHIBC) - AI-Driven Autonomous Project Management**

## Vision

Ein 100% autonomes System, das:
- Via Claude Code CLI (NICHT API!) mit AI kommuniziert
- Das Projekt mit eigenen Ideen vorantreibt
- Feedback-Schleifen zwischen Abteilungen koordiniert
- Entscheidungen durch CEO + DAO validiert (Veto-System)
- Container dynamisch startet und beendet

## Repositories

| Repository | Zweck |
|------------|-------|
| **SHIBC-AITO** (hier) | Code für das autonome Agent-System |
| [shiba-classic-website](https://github.com/og-shibaclassic/shiba-classic-website) | Issue Tracking (Issues #21-#37) |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR                            │
│              (Container Lifecycle, Event Bus)                │
│                    http://localhost:8080                     │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼─────────────────────────────┐
│                      HEAD LAYER                            │
│              CEO ◄────────────► DAO                        │
│                    (Veto-Recht)                            │
└───────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼─────────────────────────────┐
│                    C-LEVEL LAYER                           │
│     CMO │ CTO │ CFO │ COO │ CCO                           │
│   (Marketing, Tech, Treasury, Community, Compliance)       │
└───────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼─────────────────────────────┐
│                    WORKER LAYER                            │
│         (On-Demand, Task-Specific, Auto-Terminate)         │
└───────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Setup

```bash
# Clone
git clone https://github.com/Brunzendorf/SHIBC-AITO.git
cd SHIBC-AITO

# Environment
cp .env.example .env
# WICHTIG: .env bearbeiten und Credentials eintragen!
```

### 2. Infrastructure starten

```bash
./scripts/start-infra.sh
# Oder manuell:
docker-compose up -d postgres redis ollama qdrant n8n
```

### 3. Orchestrator starten

```bash
./scripts/start-orchestrator.sh
# Oder manuell:
docker-compose up -d --build orchestrator
```

### 4. Agents starten

```bash
# Alle Agents
docker-compose --profile agents up -d

# Oder einzeln
docker-compose up -d ceo-agent
```

### 5. Claude CLI authentifizieren (EINMALIG pro Agent!)

```bash
# Für jeden Agent einmal ausführen:
./scripts/setup-claude-auth.sh ceo
./scripts/setup-claude-auth.sh dao
./scripts/setup-claude-auth.sh cmo
# ... etc.
```

## API Endpoints

| Endpoint | Beschreibung |
|----------|--------------|
| `GET /health` | Liveness Probe |
| `GET /health/full` | Detaillierter Health Check |
| `GET /agents` | Liste aller Agents |
| `POST /agents/{type}/start` | Agent starten |
| `POST /agents/{type}/stop` | Agent stoppen |
| `GET /events` | Event Log |
| `GET /metrics` | Prometheus Metrics |
| `POST /escalate` | Human Escalation triggern |

## Project Structure

```
├── docs/                    # Architecture & Requirements
│   ├── AITO-2.0-ARCHITECTURE.md
│   ├── AITO-2.0-REQUIREMENTS.md
│   └── CLAUDE-CODE-DOCKER.md
├── profiles/                # Agent Profiles (System Prompts)
│   └── ceo.md
├── src/
│   ├── orchestrator/        # Central Coordinator
│   │   ├── index.ts         # Entry Point
│   │   ├── api.ts           # REST API
│   │   ├── container.ts     # Docker Management
│   │   ├── scheduler.ts     # Cron Jobs
│   │   ├── events.ts        # Redis Pub/Sub
│   │   └── health.ts        # Health Checks
│   ├── agents/              # Agent Implementations
│   └── lib/                 # Shared Libraries
│       ├── db.ts            # PostgreSQL Client
│       ├── redis.ts         # Redis Client
│       ├── config.ts        # Environment Config
│       └── types.ts         # TypeScript Types
├── docker/
│   ├── Dockerfile.orchestrator
│   ├── Dockerfile.agent
│   └── init-db.sql
├── scripts/
│   ├── start-infra.sh
│   ├── start-orchestrator.sh
│   ├── start-agents.sh
│   └── setup-claude-auth.sh
├── docker-compose.yml
└── CLAUDE.md               # Claude Code Context
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20+ / TypeScript 5.3+ |
| AI | Claude Code CLI (Max Plan $200/mo) |
| Local AI | Ollama (llama3.2, nomic-embed) |
| Database | PostgreSQL 15 + pgvector |
| Cache | Redis 7 |
| Workflows | N8N (self-hosted) |
| Vectors | Qdrant |
| Translation | DeepL API (500k free) |

## Monatliche Kosten

| Service | Kosten |
|---------|--------|
| Claude Max Plan | $200 |
| Server, Domain | $0 (existiert bereits) |
| Ollama, Redis, Postgres | $0 (self-hosted) |
| DeepL, SendGrid, etc. | $0 (free tiers) |
| **Gesamt** | **$200/month** |

## Development

```bash
# Dependencies installieren
npm install

# Development Mode
npm run dev

# Build
npm run build

# TypeScript Check
npm run typecheck

# Tests
npm test
```

## Wichtige Design-Entscheidungen

| Entscheidung | Wahl | Grund |
|--------------|------|-------|
| AI Engine | Claude Code CLI | $200/mo flat vs $12K API |
| AI Trigger | Event-basiert | Kein 24/7 AI-Kosten |
| Git | Mono-Repo | Manager sehen Big Picture |
| Human Interface | Multi-Channel | Telegram + Dashboard + Email |

## Veto-System

```
C-Level proposes → CEO + DAO vote
├── Both approve → APPROVED
├── Both veto → REJECTED
└── One veto → Round 2 (C-Level input)
    ├── Clear majority → DECISION
    └── Deadlock (3 rounds) → HUMAN DECIDES
```

## Links

- 🌐 Website: https://shibaclassic.io
- 💬 Telegram: https://t.me/shibaclassic
- 🐦 Twitter: https://x.com/shibaclassic
- 📋 Issues: [shiba-classic-website#21-#37](https://github.com/og-shibaclassic/shiba-classic-website/issues)

## License

MIT
