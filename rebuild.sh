#!/bin/bash
# AITO Clean Rebuild Script
# Verhindert Cache-Probleme und stellt sicher, dass neuer Code deployed wird

set -e  # Exit on error

echo "🔥 AITO Clean Rebuild"
echo "===================="

# 1. Stop all containers
echo "1️⃣ Stopping all containers..."
docker compose down

# 2. Build TypeScript FIRST (damit dist/ aktuell ist)
echo "2️⃣ Building TypeScript..."
npm run build

# 3. Remove old images (force fresh build)
echo "3️⃣ Removing old images..."
docker compose rm -f
docker rmi -f shibc-aito-orchestrator:latest 2>/dev/null || true
docker rmi -f shibc-aito-ceo-agent:latest 2>/dev/null || true
docker rmi -f shibc-aito-cmo-agent:latest 2>/dev/null || true
docker rmi -f shibc-aito-cto-agent:latest 2>/dev/null || true
docker rmi -f shibc-aito-cfo-agent:latest 2>/dev/null || true
docker rmi -f shibc-aito-coo-agent:latest 2>/dev/null || true
docker rmi -f shibc-aito-cco-agent:latest 2>/dev/null || true
docker rmi -f shibc-aito-dao-agent:latest 2>/dev/null || true
docker rmi -f shibc-aito-dashboard:latest 2>/dev/null || true

# 4. Build images NO CACHE
echo "4️⃣ Building images (no cache)..."
docker compose build --no-cache

# 5. Start infrastructure only
echo "5️⃣ Starting infrastructure..."
docker compose up -d redis postgres qdrant

echo ""
echo "✅ Build complete!"
echo ""
echo "Start services:"
echo "  All:     docker compose --profile agents up -d"
echo "  CMO only: docker compose up -d cmo-agent"
echo "  Dashboard: docker compose up -d dashboard orchestrator"
