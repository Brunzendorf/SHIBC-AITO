# AITO Deployment

## Prerequisites

- Docker & Docker Compose
- Node.js 20+
- Claude Code CLI (authenticated)

## Quick Start

```bash
# Clone repo
git clone https://github.com/Brunzendorf/SHIBC-AITO.git
cd SHIBC-AITO

# Copy environment
cp .env.example .env
# Edit .env with your values

# Start infrastructure
docker compose up -d redis postgres qdrant ollama

# Build TypeScript
npm install
npm run build

# Start all services
docker compose up -d
```

## Environment Variables

```bash
# Database
POSTGRES_URL=postgresql://aito:password@postgres:5432/aito
REDIS_URL=redis://redis:6379

# AI
OLLAMA_URL=http://ollama:11434

# Telegram
TELEGRAM_BOT_TOKEN=your-bot-token

# GitHub
GITHUB_TOKEN=your-token
GITHUB_ORG=og-shibaclassic
```

## Building Agent Images

```bash
# Build all agent images
for agent in ceo cmo cto cfo coo cco dao; do
  docker build -f docker/Dockerfile.agent -t shibc-aito-${agent}-agent .
done
```

## Container Management

Agent containers are managed via Portainer or Docker directly:

```bash
# View running containers
docker ps | grep aito

# View agent logs
docker logs -f aito-cmo

# Restart agent
docker restart aito-cmo

# Stop all agents
docker stop aito-ceo aito-cmo aito-cto aito-cfo aito-coo aito-cco aito-dao
```

## Health Checks

Each agent exposes health endpoint on port 3001:

```bash
curl http://localhost:3001/health
```

## Volumes

Agent containers mount:
- `./profiles:/app/profiles:ro` - Agent profiles (read-only)
- `./workspace:/app/workspace:rw` - Git workspace

## Networking

All containers use `aito-network` Docker network for internal communication.

## Dashboard

Access dashboard at http://localhost:3002

## Troubleshooting

### Agent not starting
```bash
docker logs aito-cmo --tail 50
```

### Claude authentication
```bash
docker exec aito-cmo claude --version
docker exec aito-cmo claude --print "test"
```

### Redis connection
```bash
docker exec aito-redis redis-cli PING
```
