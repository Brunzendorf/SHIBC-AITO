#!/bin/bash
# Start AITO Infrastructure (Postgres, Redis, Ollama, Qdrant, N8N)

set -e

echo "🚀 Starting AITO Infrastructure..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found! Copy from .env.example:"
    echo "   cp .env.example .env"
    exit 1
fi

# Start infrastructure services
echo "📦 Starting infrastructure containers..."
docker-compose up -d postgres redis ollama qdrant n8n

# Wait for services
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check health
echo "🔍 Checking service health..."
docker-compose ps

# Pull Ollama models
echo "📥 Pulling Ollama models..."
docker exec aito-ollama ollama pull llama3.2:1b || true
docker exec aito-ollama ollama pull llama3.2:3b || true
docker exec aito-ollama ollama pull nomic-embed-text || true

echo ""
echo "✅ Infrastructure started!"
echo ""
echo "Services:"
echo "  📊 PostgreSQL: localhost:5432"
echo "  🔴 Redis:      localhost:6379"
echo "  🦙 Ollama:     localhost:11434"
echo "  🔍 Qdrant:     localhost:6333"
echo "  ⚡ N8N:        localhost:5678"
echo ""
echo "Next steps:"
echo "  1. Start orchestrator: ./scripts/start-orchestrator.sh"
echo "  2. Or start everything: docker-compose --profile agents up -d"
