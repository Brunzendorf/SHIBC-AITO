'use client';

import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Box,
  Chip,
  IconButton,
  Tooltip,
  LinearProgress,
} from '@mui/material';
import {
  PlayArrow as StartIcon,
  Stop as StopIcon,
  Refresh as RestartIcon,
  OpenInNew as DetailIcon,
} from '@mui/icons-material';
import Link from 'next/link';
import { agentColors, statusColors } from '@/theme/theme';
import type { Agent } from '@/lib/api';

interface AgentCardProps {
  agent: Agent;
  onStart?: () => void;
  onStop?: () => void;
  onRestart?: () => void;
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

export default function AgentCard({ agent, onStart, onStop, onRestart }: AgentCardProps) {
  const agentColor = agentColors[agent.type] || '#666666';
  const statusColor = statusColors[agent.status as keyof typeof statusColors] || statusColors.inactive;
  const isActive = agent.status === 'active' || agent.status === 'healthy';

  return (
    <Card
      sx={{
        position: 'relative',
        overflow: 'visible',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          background: agentColor,
          borderRadius: '12px 12px 0 0',
        },
      }}
    >
      <CardContent>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              background: `${agentColor}20`,
              border: `2px solid ${agentColor}`,
            }}
          >
            {agentIcons[agent.type] || '🤖'}
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {agent.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {agent.type.toUpperCase()}
            </Typography>
          </Box>
          <Chip
            label={agent.status}
            size="small"
            sx={{
              backgroundColor: `${statusColor}20`,
              color: statusColor,
              fontWeight: 600,
              textTransform: 'capitalize',
            }}
          />
        </Box>

        {/* Stats */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Loop Interval
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {agent.loopInterval}s
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Container
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {agent.containerStatus || 'N/A'}
            </Typography>
          </Box>
        </Box>

        {/* Activity indicator */}
        {isActive && (
          <Box sx={{ mb: 1 }}>
            <LinearProgress
              variant="indeterminate"
              sx={{
                height: 2,
                borderRadius: 1,
                backgroundColor: 'rgba(255,255,255,0.1)',
                '& .MuiLinearProgress-bar': {
                  backgroundColor: agentColor,
                },
              }}
            />
          </Box>
        )}
      </CardContent>

      <CardActions sx={{ justifyContent: 'space-between', px: 2, pb: 2 }}>
        <Box>
          {!isActive ? (
            <Tooltip title="Start Agent">
              <IconButton size="small" onClick={onStart} color="success">
                <StartIcon />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title="Stop Agent">
              <IconButton size="small" onClick={onStop} color="error">
                <StopIcon />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Restart Agent">
            <IconButton size="small" onClick={onRestart} color="warning">
              <RestartIcon />
            </IconButton>
          </Tooltip>
        </Box>
        <Tooltip title="View Details">
          <IconButton
            component={Link}
            href={`/agents/${agent.type}`}
            size="small"
            color="primary"
          >
            <DetailIcon />
          </IconButton>
        </Tooltip>
      </CardActions>
    </Card>
  );
}
