'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useWebSocket, AgentNode, AgentLink } from '@/hooks/useWebSocket';

// Agent type colors
const AGENT_COLORS: Record<string, string> = {
  ceo: '#FFD700',  // Gold
  dao: '#9B59B6',  // Purple
  cmo: '#E74C3C',  // Red
  cto: '#3498DB',  // Blue
  cfo: '#2ECC71',  // Green
  coo: '#F39C12',  // Orange
  cco: '#1ABC9C',  // Teal
  orchestrator: '#95A5A6', // Gray
};

// Center point and radius for circular layout
const CENTER_X = 400;
const CENTER_Y = 300;
const ORBIT_RADIUS = 180;

// Agent positions (circular layout around orchestrator)
// 7 agents = 360°/7 ≈ 51.4° between each, CEO at top
const AGENTS_ORDER = ['ceo', 'dao', 'cmo', 'cto', 'cfo', 'coo', 'cco'];
const AGENT_ANGLES: Record<string, number> = {};
AGENTS_ORDER.forEach((agent, index) => {
  // Start at -90° (top) and go clockwise
  AGENT_ANGLES[agent] = -90 + (index * (360 / AGENTS_ORDER.length));
});

function getAgentPosition(type: string): { x: number; y: number } {
  const angle = AGENT_ANGLES[type] ?? 0;
  const radians = (angle * Math.PI) / 180;
  return {
    x: CENTER_X + Math.cos(radians) * ORBIT_RADIUS,
    y: CENTER_Y + Math.sin(radians) * ORBIT_RADIUS,
  };
}

interface CanvasNode extends AgentNode {
  x: number;
  y: number;
  radius: number;
}

export default function NetworkPage() {
  const { connected, agents, links, messages } = useWebSocket();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentNode | null>(null);

  // Convert agents to canvas nodes with positions (memoized to prevent infinite loops)
  const canvasNodes = useMemo(() => {
    const nodes: CanvasNode[] = agents.map(agent => {
      const pos = getAgentPosition(agent.type);
      return {
        ...agent,
        x: pos.x,
        y: pos.y,
        radius: agent.status === 'busy' ? 45 : 40,
      };
    });

    // Add orchestrator node in center
    if (!nodes.find(n => n.type === 'orchestrator')) {
      nodes.push({
        id: 'orchestrator',
        type: 'orchestrator',
        name: 'Orchestrator',
        status: connected ? 'active' : 'inactive',
        lastActivity: new Date().toISOString(),
        x: CENTER_X,
        y: CENTER_Y,
        radius: 50,
      });
    }

    return nodes;
  }, [agents, connected]);

  // Draw the network graph
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = '#2a2a4e';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw permanent connections from orchestrator to all agents
    const orchestrator = canvasNodes.find(n => n.type === 'orchestrator');
    if (orchestrator) {
      canvasNodes.forEach(node => {
        if (node.type !== 'orchestrator') {
          ctx.beginPath();
          ctx.strokeStyle = '#3a3a5e';
          ctx.lineWidth = 1;
          ctx.moveTo(orchestrator.x, orchestrator.y);
          ctx.lineTo(node.x, node.y);
          ctx.stroke();
        }
      });
    }

    // Draw dynamic links (communication lines)
    links.forEach(link => {
      const sourceNode = canvasNodes.find(n => n.id === link.source || n.type === link.source);
      const targetNode = canvasNodes.find(n => n.id === link.target || n.type === link.target);

      if (sourceNode && targetNode) {
        const age = Date.now() - new Date(link.timestamp).getTime();
        const opacity = Math.max(0, 1 - age / 30000); // Fade over 30 seconds

        ctx.beginPath();
        ctx.strokeStyle = `rgba(0, 255, 255, ${opacity})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.moveTo(sourceNode.x, sourceNode.y);
        ctx.lineTo(targetNode.x, targetNode.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw arrow
        const angle = Math.atan2(targetNode.y - sourceNode.y, targetNode.x - sourceNode.x);
        const arrowX = targetNode.x - Math.cos(angle) * targetNode.radius;
        const arrowY = targetNode.y - Math.sin(angle) * targetNode.radius;

        ctx.beginPath();
        ctx.fillStyle = `rgba(0, 255, 255, ${opacity})`;
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(arrowX - 10 * Math.cos(angle - Math.PI / 6), arrowY - 10 * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(arrowX - 10 * Math.cos(angle + Math.PI / 6), arrowY - 10 * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      }
    });

    // Draw nodes
    canvasNodes.forEach(node => {
      const color = AGENT_COLORS[node.type] || '#666';

      // Status glow
      if (node.status === 'busy') {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 10, 0, Math.PI * 2);
        ctx.fillStyle = `${color}33`;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);

      // Gradient fill
      const gradient = ctx.createRadialGradient(
        node.x - 10, node.y - 10, 0,
        node.x, node.y, node.radius
      );
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, adjustColor(color, -30));
      ctx.fillStyle = gradient;
      ctx.fill();

      // Border based on status
      ctx.strokeStyle = node.status === 'active' ? '#00ff00' :
                        node.status === 'busy' ? '#ffff00' :
                        node.status === 'error' ? '#ff0000' : '#666';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Agent type label
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.type.toUpperCase(), node.x, node.y);

      // Status indicator
      const statusColor = node.status === 'active' ? '#00ff00' :
                          node.status === 'busy' ? '#ffff00' :
                          node.status === 'error' ? '#ff0000' : '#666';
      ctx.beginPath();
      ctx.arc(node.x + node.radius - 5, node.y - node.radius + 5, 8, 0, Math.PI * 2);
      ctx.fillStyle = statusColor;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Current action label (if busy)
      if (node.currentAction) {
        ctx.fillStyle = '#ffff00';
        ctx.font = '11px Arial';
        ctx.fillText(node.currentAction.slice(0, 25), node.x, node.y + node.radius + 15);
      }
    });

    // Draw title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('AITO Agent Network', 20, 30);

    // Connection status
    ctx.fillStyle = connected ? '#00ff00' : '#ff0000';
    ctx.font = '14px Arial';
    ctx.fillText(connected ? '● Connected' : '○ Disconnected', 20, 55);

    // Legend
    ctx.fillStyle = '#888';
    ctx.font = '12px Arial';
    ctx.textAlign = 'right';
    ctx.fillText('Green: Active | Yellow: Busy | Red: Error | Gray: Offline', canvas.width - 20, canvas.height - 20);
  }, [canvasNodes, links, connected]);

  // Animation loop
  useEffect(() => {
    let animationId: number;
    const animate = () => {
      draw();
      animationId = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(animationId);
  }, [draw]);

  // Handle canvas click
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Find clicked node
    const clicked = canvasNodes.find(node => {
      const dx = x - node.x;
      const dy = y - node.y;
      return Math.sqrt(dx * dx + dy * dy) <= node.radius;
    });

    setSelectedAgent(clicked || null);
  };

  return (
    <DashboardLayout>
      <div className="p-6">
        <div className="flex gap-6">
          {/* Main Network Canvas */}
          <div className="flex-1">
            <div className="bg-gray-800 rounded-lg overflow-hidden shadow-xl">
              <canvas
                ref={canvasRef}
                width={800}
                height={600}
                onClick={handleCanvasClick}
                className="cursor-pointer"
              />
            </div>
          </div>

          {/* Side Panel */}
          <div className="w-80 space-y-4">
            {/* Selected Agent Details */}
            {selectedAgent && (
              <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="text-lg font-bold text-white mb-3">
                  {selectedAgent.name || selectedAgent.type.toUpperCase()}
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Status:</span>
                    <span className={
                      selectedAgent.status === 'active' ? 'text-green-400' :
                      selectedAgent.status === 'busy' ? 'text-yellow-400' :
                      selectedAgent.status === 'error' ? 'text-red-400' : 'text-gray-400'
                    }>
                      {selectedAgent.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Type:</span>
                    <span className="text-white">{selectedAgent.type.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Last Activity:</span>
                    <span className="text-white">
                      {new Date(selectedAgent.lastActivity).toLocaleTimeString()}
                    </span>
                  </div>
                  {selectedAgent.currentAction && (
                    <div className="mt-2 p-2 bg-yellow-900/30 rounded">
                      <span className="text-yellow-400 text-xs">Current Action:</span>
                      <p className="text-white text-sm">{selectedAgent.currentAction}</p>
                    </div>
                  )}
                </div>
                <a
                  href={`/agents/${selectedAgent.type}`}
                  className="mt-4 block text-center bg-blue-600 hover:bg-blue-700 text-white py-2 rounded transition-colors"
                >
                  View Details
                </a>
              </div>
            )}

            {/* Live Activity Feed */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-bold text-white mb-3">Live Activity</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {messages.slice(-20).reverse().map((msg, i) => (
                  <div key={i} className="text-xs p-2 bg-gray-700/50 rounded">
                    <div className="flex justify-between text-gray-400">
                      <span className={
                        msg.type === 'agent_status' ? 'text-blue-400' :
                        msg.type === 'worker_log' ? 'text-yellow-400' :
                        msg.type === 'agent_message' ? 'text-green-400' : 'text-gray-400'
                      }>
                        {msg.type}
                      </span>
                      <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-white mt-1 truncate">
                      {formatMessageData(msg.data, agents)}
                    </div>
                  </div>
                ))}
                {messages.length === 0 && (
                  <div className="text-gray-500 text-center py-4">
                    Waiting for activity...
                  </div>
                )}
              </div>
            </div>

            {/* Agent Legend */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-bold text-white mb-3">Agents</h3>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(AGENT_COLORS).map(([type, color]) => (
                  <div key={type} className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-white text-sm">{type.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

// Helper function to adjust color brightness
function adjustColor(color: string, amount: number): string {
  try {
    const hex = color.replace('#', '');
    if (hex.length !== 6) return color;
    const r = Math.max(0, Math.min(255, parseInt(hex.slice(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(hex.slice(2, 4), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(hex.slice(4, 6), 16) + amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  } catch {
    return color;
  }
}

// Format message data for display
function formatMessageData(data: unknown, agents: AgentNode[]): string {
  if (!data) return '-';
  if (typeof data === 'string') return data;
  const obj = data as Record<string, unknown>;

  // Helper to resolve agent ID/type to display name
  const resolveAgentName = (idOrType: string): string => {
    if (!idOrType) return '?';
    // Check if it's already a known type
    if (['ceo', 'cmo', 'cto', 'cfo', 'coo', 'cco', 'dao', 'orchestrator'].includes(idOrType.toLowerCase())) {
      return idOrType.toUpperCase();
    }
    // Try to find agent by ID
    const agent = agents.find(a => a.id === idOrType);
    if (agent) return agent.type.toUpperCase();
    // Check if ID contains agent type hint
    if (idOrType.includes('-')) {
      const parts = idOrType.split('-');
      const possibleType = parts.find(p =>
        ['ceo', 'cmo', 'cto', 'cfo', 'coo', 'cco', 'dao'].includes(p.toLowerCase())
      );
      if (possibleType) return possibleType.toUpperCase();
    }
    // Return shortened UUID as fallback
    return idOrType.slice(0, 8);
  };

  if (obj.agentType) return `${String(obj.agentType).toUpperCase()}: ${obj.currentAction || obj.status || 'update'}`;
  if (obj.message) {
    const msg = obj.message as Record<string, unknown>;
    const from = resolveAgentName(String(msg.from || ''));
    const to = resolveAgentName(String(msg.to || ''));
    return `${from} → ${to}: ${msg.type}`;
  }
  return JSON.stringify(data).slice(0, 50);
}
