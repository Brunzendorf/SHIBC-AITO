#!/bin/bash
# Setup Claude CLI authentication in Agent container
# Usage: ./setup-claude-auth.sh <agent-type>
# Example: ./setup-claude-auth.sh ceo

set -e

AGENT_TYPE=${1:-ceo}
CONTAINER_NAME="aito-${AGENT_TYPE}"

echo "🔐 Setting up Claude CLI authentication for ${AGENT_TYPE}..."

# Check if container exists
if ! docker ps | grep -q "${CONTAINER_NAME}"; then
    echo "❌ Container ${CONTAINER_NAME} not running!"
    echo "   Start it first: docker-compose --profile agents up -d ${AGENT_TYPE}-agent"
    exit 1
fi

echo ""
echo "📋 Authentifizierungs-Optionen:"
echo ""
echo "1. INTERAKTIV (empfohlen für erstes Setup)"
echo "   Du wirst nach deinem Claude-Login gefragt"
echo ""
echo "2. BROWSER TOKEN"
echo "   - Öffne claude.ai in deinem Browser"
echo "   - F12 → Application → Cookies → sessionKey kopieren"
echo ""

read -p "Option wählen (1/2): " option

case $option in
    1)
        echo ""
        echo "🚀 Starting interactive auth..."
        echo "   Folge den Anweisungen im Container..."
        echo ""

        # Windows fix for interactive terminal
        if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
            winpty docker exec -it ${CONTAINER_NAME} claude auth login
        else
            docker exec -it ${CONTAINER_NAME} claude auth login
        fi
        ;;
    2)
        read -p "Session Token eingeben: " token
        docker exec ${CONTAINER_NAME} claude setup-token "${token}"
        ;;
    *)
        echo "Ungültige Option!"
        exit 1
        ;;
esac

echo ""
echo "🧪 Testing authentication..."
docker exec ${CONTAINER_NAME} claude --print "AI Agent ${AGENT_TYPE} ready. Please respond with OK."

echo ""
echo "✅ Claude CLI authentication complete for ${AGENT_TYPE}!"
echo ""
echo "💡 Die Auth-Daten sind im Volume '${AGENT_TYPE}_claude_config' gespeichert."
echo "   Sie bleiben über Container-Restarts erhalten."
