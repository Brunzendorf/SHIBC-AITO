'use client';

/**
 * AgentStatusBoard - Real-time agent status display
 *
 * TASK-108: Shows live status updates from Status Service via WebSocket.
 * Displays: agent status (working/idle/blocked), current activity, loop number.
 */

import { useEffect, useState, useRef } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Grid,
  CircularProgress,
  Tooltip,
  Paper,
} from '@mui/material';
import {
  Circle as CircleIcon,
} from '@mui/icons-material';
import { agentColors } from '@/theme/theme';

interface AgentStatus {
  agent_type: string;
  loop_number: number;
  current_status: 'working' | 'idle' | 'blocked' | 'completed';
  current_activity: string;
  last_seen: string;
  presence: 'online' | 'away' | 'offline';
  actions_24h: number;
}

interface StatusUpdate {
  type: 'initial' | 'update';
  data: AgentStatus | AgentStatus[];
}

const agentIcons: Record<string, string> = {
  ceo: '👔',
  dao: '🏛️',
  cmo: '📢',
  cto: '⚙️',
  cfo: '💰',
  coo: '📋',
  cco: '⚖️',
};

const statusColors: Record<string, string> = {
  working: '#4caf50', // green
  idle: '#2196f3',    // blue
  blocked: '#ff9800', // orange
  completed: '#9e9e9e', // gray
};

const presenceColors: Record<string, string> = {
  online: '#4caf50',  // green
  away: '#ff9800',    // orange
  offline: '#f44336', // red
};

export default function AgentStatusBoard() {
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const connect = () => {
      // Use relative WebSocket URL based on current host
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = process.env.NEXT_PUBLIC_STATUS_WS_URL || `${wsProtocol}//${window.location.hostname}:3002`;
      const wsUrl = `${wsHost}/ws/status-feed`;

      try {
        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onopen = () => {
          setConnected(true);
          setError(null);
        };

        wsRef.current.onmessage = (event) => {
          try {
            const message: StatusUpdate = JSON.parse(event.data);

            if (message.type === 'initial') {
              // Initial state: array of all agent statuses
              setStatuses(message.data as AgentStatus[]);
            } else if (message.type === 'update') {
              // Single agent update
              const update = message.data as AgentStatus & { agent: string; timestamp: string };
              setStatuses(prev => {
                const idx = prev.findIndex(s => s.agent_type === update.agent);
                if (idx >= 0) {
                  const updated = [...prev];
                  updated[idx] = {
                    ...updated[idx],
                    current_status: update.current_status || updated[idx].current_status,
                    current_activity: update.current_activity || updated[idx].current_activity,
                    loop_number: update.loop_number || updated[idx].loop_number,
                    last_seen: update.timestamp || updated[idx].last_seen,
                    presence: 'online',
                  };
                  return updated;
                }
                return prev;
              });
            }
          } catch {
            // Ignore parse errors
          }
        };

        wsRef.current.onclose = () => {
          setConnected(false);
          // Reconnect after 5 seconds
          reconnectTimeoutRef.current = setTimeout(connect, 5000);
        };

        wsRef.current.onerror = () => {
          setError('Connection error');
          setConnected(false);
        };
      } catch {
        setError('Failed to connect');
        setConnected(false);
        // Retry connection
        reconnectTimeoutRef.current = setTimeout(connect, 5000);
      }
    };

    // Initial REST fallback while WebSocket connects
    const fetchInitialStatus = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_STATUS_API_URL || `http://${window.location.hostname}:3002`;
        const response = await fetch(`${apiUrl}/api/status`);
        if (response.ok) {
          const data = await response.json();
          setStatuses(data);
        }
      } catch {
        // Will retry via WebSocket
      }
    };

    fetchInitialStatus();
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const formatLastSeen = (lastSeen: string) => {
    const date = new Date(lastSeen);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 60) return 'Just now';
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
    if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
    return date.toLocaleDateString();
  };

  if (statuses.length === 0) {
    return (
      <Paper sx={{ p: 3, textAlign: 'center' }}>
        <CircularProgress size={24} sx={{ mb: 1 }} />
        <Typography variant="body2" color="text.secondary">
          Loading agent status...
        </Typography>
      </Paper>
    );
  }

  return (
    <Box>
      {/* Connection Status */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <CircleIcon
          sx={{
            fontSize: 10,
            color: connected ? '#4caf50' : '#f44336',
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {connected ? 'Live updates' : 'Reconnecting...'}
        </Typography>
        {error && (
          <Typography variant="caption" color="error" sx={{ ml: 1 }}>
            {error}
          </Typography>
        )}
      </Box>

      {/* Agent Status Grid */}
      <Grid container spacing={2}>
        {statuses.map((agent) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={agent.agent_type}>
            <Card
              sx={{
                position: 'relative',
                overflow: 'visible',
                transition: 'box-shadow 0.2s',
                '&:hover': {
                  boxShadow: 4,
                },
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 3,
                  background: agentColors[agent.agent_type] || '#666',
                  borderRadius: '4px 4px 0 0',
                },
              }}
            >
              <CardContent sx={{ pb: 1.5 }}>
                {/* Header */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.2rem',
                      background: `${agentColors[agent.agent_type] || '#666'}20`,
                    }}
                  >
                    {agentIcons[agent.agent_type] || '🤖'}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {agent.agent_type.toUpperCase()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Loop #{agent.loop_number}
                    </Typography>
                  </Box>
                  <Tooltip title={`${agent.presence} - ${formatLastSeen(agent.last_seen)}`}>
                    <CircleIcon
                      sx={{
                        fontSize: 10,
                        color: presenceColors[agent.presence] || '#9e9e9e',
                      }}
                    />
                  </Tooltip>
                </Box>

                {/* Status Chip */}
                <Chip
                  label={agent.current_status}
                  size="small"
                  sx={{
                    mb: 1,
                    backgroundColor: `${statusColors[agent.current_status] || '#666'}20`,
                    color: statusColors[agent.current_status] || '#666',
                    fontWeight: 600,
                    textTransform: 'capitalize',
                  }}
                />

                {/* Activity */}
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: '0.75rem',
                  }}
                  title={agent.current_activity}
                >
                  {agent.current_activity}
                </Typography>

                {/* Stats */}
                <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    24h: {agent.actions_24h} actions
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
