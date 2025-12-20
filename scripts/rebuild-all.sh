#!/bin/bash
# AITO Complete Rebuild Script
# Rebuilds ALL containers and images from scratch with force create
# Solves cache issues and ensures all env vars are correct

set -e

echo "============================================"
echo "AITO Complete Rebuild Script"
echo "============================================"
echo ""

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
echo "Working directory: $PROJECT_DIR"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Stop ALL running containers
echo -e "${YELLOW}Step 1: Stopping all AITO containers...${NC}"
docker compose --profile agents down --remove-orphans 2>/dev/null || true
docker ps -a --filter name=aito- -q | xargs -r docker rm -f 2>/dev/null || true
echo -e "${GREEN}All containers stopped and removed${NC}"
echo ""

# Step 2: Remove ALL AITO images (force)
echo -e "${YELLOW}Step 2: Removing all AITO images (force)...${NC}"
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "shibc-aito" | xargs -r docker rmi -f 2>/dev/null || true
echo -e "${GREEN}All AITO images removed${NC}"
echo ""

# Step 3: Prune Docker build cache
echo -e "${YELLOW}Step 3: Pruning Docker build cache...${NC}"
docker builder prune -af 2>/dev/null || true
echo -e "${GREEN}Build cache cleared${NC}"
echo ""

# Step 4: Build TypeScript
echo -e "${YELLOW}Step 4: Building TypeScript...${NC}"
npm run build
echo -e "${GREEN}TypeScript built${NC}"
echo ""

# Step 5: Build ALL images with --no-cache
echo -e "${YELLOW}Step 5: Building ALL images with --no-cache...${NC}"
docker compose build --no-cache --parallel
echo -e "${GREEN}All images built from scratch${NC}"
echo ""

# Step 6: Start infrastructure first (without agents)
echo -e "${YELLOW}Step 6: Starting infrastructure...${NC}"
docker compose up -d postgres redis ollama qdrant portainer n8n
echo "Waiting for infrastructure to be healthy..."
sleep 10
docker compose up -d orchestrator
echo "Waiting for orchestrator to be healthy..."
sleep 15
echo -e "${GREEN}Infrastructure started${NC}"
echo ""

# Step 7: Start all agents with force-recreate
echo -e "${YELLOW}Step 7: Starting all agents (force-recreate)...${NC}"
docker compose --profile agents up -d --force-recreate
echo -e "${GREEN}All agents started${NC}"
echo ""

# Step 8: Verify containers
echo -e "${YELLOW}Step 8: Verifying containers...${NC}"
echo ""
echo "Running containers:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
echo ""

# Step 9: Verify LLM config in agents
echo -e "${YELLOW}Step 9: Verifying LLM configuration...${NC}"
echo ""
AGENTS=("ceo" "cmo" "cto" "cfo" "coo" "cco" "dao")
ALL_OK=true

for agent in "${AGENTS[@]}"; do
    CONTAINER="aito-$agent"
    if docker ps --format '{{.Names}}' | grep -q "^$CONTAINER$"; then
        LLM_STRATEGY=$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep "^LLM_ROUTING_STRATEGY=" | cut -d= -f2)
        LOOP_INT=$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep "^LOOP_INTERVAL=" | cut -d= -f2)
        PROFILE=$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep "^AGENT_PROFILE=" | cut -d= -f2)

        if [ "$LLM_STRATEGY" = "claude-only" ]; then
            echo -e "${GREEN}$CONTAINER: LLM_ROUTING_STRATEGY=$LLM_STRATEGY, LOOP=$LOOP_INT${NC}"
        else
            echo -e "${RED}$CONTAINER: LLM_ROUTING_STRATEGY=$LLM_STRATEGY (WRONG!)${NC}"
            ALL_OK=false
        fi

        if [[ "$PROFILE" != /app/profiles/* ]]; then
            echo -e "${RED}  WARNING: AGENT_PROFILE=$PROFILE (should start with /app/profiles/)${NC}"
            ALL_OK=false
        fi
    else
        echo -e "${RED}$CONTAINER: NOT RUNNING${NC}"
        ALL_OK=false
    fi
done

echo ""
if [ "$ALL_OK" = true ]; then
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}ALL CONTAINERS VERIFIED SUCCESSFULLY!${NC}"
    echo -e "${GREEN}============================================${NC}"
else
    echo -e "${RED}============================================${NC}"
    echo -e "${RED}SOME CONTAINERS HAVE ISSUES - CHECK ABOVE${NC}"
    echo -e "${RED}============================================${NC}"
    exit 1
fi
