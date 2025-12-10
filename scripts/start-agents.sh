#!/bin/bash
# Start AITO Agent Containers
# Usage: ./start-agents.sh [agent-type]
# Without argument: starts all agents

set -e

AGENT=${1:-all}

echo "🤖 Starting AITO Agents..."

if [ "$AGENT" == "all" ]; then
    echo "Starting all agents..."
    docker-compose --profile agents up -d
else
    echo "Starting ${AGENT} agent..."
    docker-compose up -d ${AGENT}-agent
fi

sleep 5

echo ""
echo "📊 Agent Status:"
docker-compose ps | grep aito-

echo ""
echo "✅ Agents started!"
echo ""
echo "⚠️  WICHTIG: Claude CLI muss für jeden Agent einmalig authentifiziert werden!"
echo ""
echo "Für jeden Agent ausführen:"
echo "  ./scripts/setup-claude-auth.sh ceo"
echo "  ./scripts/setup-claude-auth.sh dao"
echo "  ./scripts/setup-claude-auth.sh cmo"
echo "  ./scripts/setup-claude-auth.sh cto"
echo "  ./scripts/setup-claude-auth.sh cfo"
echo "  ./scripts/setup-claude-auth.sh coo"
echo "  ./scripts/setup-claude-auth.sh cco"
echo ""
echo "📊 Orchestrator API: http://localhost:8080/agents"
