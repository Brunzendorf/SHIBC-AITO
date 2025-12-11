'use client';

import { use } from 'react';
import {
  Typography,
  Box,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  Breadcrumbs,
  Link as MuiLink,
} from '@mui/material';
import {
  PlayArrow as StartIcon,
  Stop as StopIcon,
  Refresh as RestartIcon,
  ArrowBack as BackIcon,
} from '@mui/icons-material';
import Link from 'next/link';
import { useAgent } from '@/hooks/useAgents';
import { startAgent, stopAgent, restartAgent } from '@/lib/api';
import { agentColors, statusColors } from '@/theme/theme';
import { formatDate, formatDistanceToNow } from '@/lib/utils';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';
import EmptyState from '@/components/common/EmptyState';

const agentIcons: Record<string, string> = {
  ceo: '👔',
  dao: '🏛️',
  cmo: '📢',
  cto: '⚙️',
  cfo: '💰',
  coo: '📋',
  cco: '⚖️',
};

export default function AgentDetailPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params);
  const { data: agent, error, isLoading, mutate } = useAgent(type);

  const handleStart = async () => {
    await startAgent(type);
    mutate();
  };

  const handleStop = async () => {
    await stopAgent(type);
    mutate();
  };

  const handleRestart = async () => {
    await restartAgent(type);
    mutate();
  };

  if (isLoading) return <Loading message={`Loading ${type} agent...`} />;
  if (error) return <ErrorDisplay error={error} onRetry={() => mutate()} />;
  if (!agent) return <EmptyState title="Agent not found" />;

  const agentColor = agentColors[agent.type] || '#666666';
  const statusColor = statusColors[agent.status as keyof typeof statusColors] || statusColors.inactive;
  const isActive = agent.status === 'active' || agent.status === 'healthy';

  return (
    <Box>
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 2 }}>
        <MuiLink component={Link} href="/" color="inherit" underline="hover">
          Dashboard
        </MuiLink>
        <MuiLink component={Link} href="/agents" color="inherit" underline="hover">
          Agents
        </MuiLink>
        <Typography color="text.primary">{agent.name}</Typography>
      </Breadcrumbs>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
        <IconButton component={Link} href="/agents">
          <BackIcon />
        </IconButton>
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '2rem',
            background: `${agentColor}20`,
            border: `3px solid ${agentColor}`,
          }}
        >
          {agentIcons[agent.type] || '🤖'}
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {agent.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {agent.type.toUpperCase()} Agent
          </Typography>
        </Box>
        <Chip
          label={agent.status}
          sx={{
            backgroundColor: `${statusColor}20`,
            color: statusColor,
            fontWeight: 600,
            textTransform: 'capitalize',
            fontSize: '1rem',
            height: 32,
          }}
        />
      </Box>

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 2, mb: 4 }}>
        {!isActive ? (
          <Button
            variant="contained"
            color="success"
            startIcon={<StartIcon />}
            onClick={handleStart}
          >
            Start Agent
          </Button>
        ) : (
          <Button
            variant="contained"
            color="error"
            startIcon={<StopIcon />}
            onClick={handleStop}
          >
            Stop Agent
          </Button>
        )}
        <Button
          variant="outlined"
          color="warning"
          startIcon={<RestartIcon />}
          onClick={handleRestart}
        >
          Restart
        </Button>
      </Box>

      <Grid container spacing={3}>
        {/* Agent Info */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Agent Information
              </Typography>
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ color: 'text.secondary', border: 'none' }}>ID</TableCell>
                    <TableCell sx={{ border: 'none', fontFamily: 'monospace' }}>{agent.id}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ color: 'text.secondary', border: 'none' }}>Profile Path</TableCell>
                    <TableCell sx={{ border: 'none', fontFamily: 'monospace' }}>{agent.profilePath}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ color: 'text.secondary', border: 'none' }}>Loop Interval</TableCell>
                    <TableCell sx={{ border: 'none' }}>{agent.loopInterval} seconds</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ color: 'text.secondary', border: 'none' }}>Container ID</TableCell>
                    <TableCell sx={{ border: 'none', fontFamily: 'monospace' }}>
                      {agent.containerId ? agent.containerId.slice(0, 12) : 'N/A'}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ color: 'text.secondary', border: 'none' }}>Container Status</TableCell>
                    <TableCell sx={{ border: 'none' }}>{agent.containerStatus || 'N/A'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ color: 'text.secondary', border: 'none' }}>Created</TableCell>
                    <TableCell sx={{ border: 'none' }}>{formatDate(agent.createdAt)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ color: 'text.secondary', border: 'none' }}>Updated</TableCell>
                    <TableCell sx={{ border: 'none' }}>{formatDate(agent.updatedAt)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>

        {/* Current State */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Current State
              </Typography>
              {Object.keys(agent.state || {}).length === 0 ? (
                <EmptyState title="No state" description="Agent has no stored state yet." />
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Key</TableCell>
                        <TableCell>Value</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Object.entries(agent.state || {}).map(([key, value]) => (
                        <TableRow key={key}>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{key}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>
                            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* History */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                History
              </Typography>
              {!agent.history?.length ? (
                <EmptyState title="No history" description="No actions recorded yet." />
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Time</TableCell>
                        <TableCell>Action</TableCell>
                        <TableCell>Summary</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {agent.history.slice(0, 20).map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            <Tooltip title={formatDate(entry.createdAt)}>
                              <span>{formatDistanceToNow(entry.createdAt)}</span>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={entry.actionType}
                              size="small"
                              sx={{ fontSize: '0.7rem' }}
                            />
                          </TableCell>
                          <TableCell>{entry.summary}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
