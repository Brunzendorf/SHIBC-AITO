'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface WSMessage {
  type: 'agent_status' | 'worker_log' | 'agent_message' | 'system_event';
  data: unknown;
  timestamp: string;
}

export interface AgentNode {
  id: string;
  type: string;
  name: string;
  status: 'active' | 'inactive' | 'error' | 'busy';
  lastActivity: string;
  currentAction?: string;
}

export interface AgentLink {
  source: string;
  target: string;
  type: string;
  timestamp: string;
}

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState<Map<string, AgentNode>>(new Map());
  const [links, setLinks] = useState<AgentLink[]>([]);
  const [messages, setMessages] = useState<WSMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/ws';
    console.log('Connecting to WebSocket:', wsUrl);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnected(true);
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          handleMessage(msg);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setConnected(false);
        wsRef.current = null;
        // Reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      // Retry connection
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000);
    }
  }, []);

  const handleMessage = useCallback((msg: WSMessage) => {
    setMessages(prev => [...prev.slice(-99), msg]); // Keep last 100 messages

    switch (msg.type) {
      case 'agent_status': {
        const data = msg.data as Partial<AgentNode>;
        if (data.id || data.agentId) {
          const id = data.id || (data as { agentId?: string }).agentId || '';
          setAgents(prev => {
            const newMap = new Map(prev);
            const existing = newMap.get(id) || {
              id,
              type: 'unknown',
              name: 'Unknown',
              status: 'inactive' as const,
              lastActivity: new Date().toISOString(),
            };
            newMap.set(id, {
              ...existing,
              ...data,
              id,
              status: determineStatus(data),
              lastActivity: data.lastActivity || msg.timestamp,
              currentAction: data.currentAction,
            });
            return newMap;
          });
        }
        break;
      }

      case 'agent_message': {
        const data = msg.data as { agentId?: string; message?: { from?: string; to?: string; type?: string } };
        const message = data.message;
        if (message?.from && message?.to && message.to !== 'orchestrator') {
          // Add communication link
          setLinks(prev => {
            const newLink: AgentLink = {
              source: message.from!,
              target: message.to!,
              type: message.type || 'direct',
              timestamp: msg.timestamp,
            };
            // Keep last 50 links and remove old ones (older than 30 seconds)
            const cutoff = Date.now() - 30000;
            const filtered = prev.filter(l => new Date(l.timestamp).getTime() > cutoff);
            return [...filtered.slice(-49), newLink];
          });
        }
        break;
      }

      case 'worker_log': {
        // Update agent to busy status while worker is running
        const data = msg.data as { agentId?: string; agentType?: string };
        if (data.agentId) {
          setAgents(prev => {
            const newMap = new Map(prev);
            const existing = newMap.get(data.agentId!);
            if (existing) {
              newMap.set(data.agentId!, {
                ...existing,
                status: 'busy',
                currentAction: 'Running worker...',
                lastActivity: msg.timestamp,
              });
            }
            return newMap;
          });
        }
        break;
      }
    }
  }, []);

  const determineStatus = (data: Partial<AgentNode>): 'active' | 'inactive' | 'error' | 'busy' => {
    if (data.currentAction) return 'busy';
    if (data.status === 'error') return 'error';
    if (data.status === 'active' || data.status === 'busy') return data.status;
    return 'inactive';
  };

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Clean up old links periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 30000;
      setLinks(prev => prev.filter(l => new Date(l.timestamp).getTime() > cutoff));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return {
    connected,
    agents: Array.from(agents.values()),
    links,
    messages,
  };
}
