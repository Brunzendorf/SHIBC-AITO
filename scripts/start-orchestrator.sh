#!/bin/bash
# Start AITO Orchestrator

set -e

echo "🎯 Starting AITO Orchestrator..."

# Build and start orchestrator
docker-compose up -d --build orchestrator

# Wait and check
sleep 5
echo ""
echo "🔍 Checking orchestrator health..."
curl -s http://localhost:8080/health | jq . || echo "Waiting for startup..."

echo ""
echo "✅ Orchestrator started!"
echo ""
echo "Endpoints:"
echo "  🏥 Health:   http://localhost:8080/health"
echo "  📊 Metrics:  http://localhost:8080/metrics"
echo "  🤖 Agents:   http://localhost:8080/agents"
echo "  📋 Events:   http://localhost:8080/events"
echo ""
echo "Next steps:"
echo "  1. Start agents: ./scripts/start-agents.sh"
echo "  2. Auth Claude:  ./scripts/setup-claude-auth.sh ceo"
