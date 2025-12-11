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
  ExpandMore as ExpandMoreIcon,
  Message as MessageIcon,
} from '@mui/icons-material';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Link from 'next/link';
import { useAgent, useAgentHistory, AgentHistory } from '@/hooks/useAgents';
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
  const { data: history } = useAgentHistory(type);

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
                    <TableCell sx={{ border: 'none' }}>{agent.containerStatus?.status || 'N/A'}</TableCell>
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

        {/* History with Details */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Communication History
              </Typography>
              {!history?.length ? (
                <EmptyState title="No history" description="No actions recorded yet." />
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {history.slice(0, 20).map((entry) => {
                    const details = entry.details as Record<string, unknown> | undefined;
                    const messages = details?.messages as Array<{to: string; content: string}> | undefined;
                    const actions = details?.actions as Array<{type: string; data: unknown}> | undefined;
                    
                    return (
                      <Accordion key={entry.id} sx={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                            <Tooltip title={formatDate(entry.createdAt)}>
                              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 80 }}>
                                {formatDistanceToNow(entry.createdAt)}
                              </Typography>
                            </Tooltip>
                            <Chip
                              label={entry.actionType}
                              size="small"
                              sx={{ fontSize: '0.7rem' }}
                            />
                            {messages && messages.length > 0 && (
                              <Chip
                                icon={<MessageIcon sx={{ fontSize: 14 }} />}
                                label={`${messages.length} msg`}
                                size="small"
                                color="info"
                                variant="outlined"
                                sx={{ fontSize: '0.65rem' }}
                              />
                            )}
                            <Typography variant="body2" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {entry.summary}
                            </Typography>
                          </Box>
                        </AccordionSummary>
                        <AccordionDetails>
                          {/* Full Summary */}
                          <Typography variant="body2" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
                            {entry.summary}
                          </Typography>
                          
                          {/* Messages Section */}
                          {messages && messages.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle2" sx={{ mb: 1, color: 'info.main' }}>
                                📨 Messages Sent
                              </Typography>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                {messages.map((msg, idx) => (
                                  <Paper key={idx} variant="outlined" sx={{ p: 1.5, backgroundColor: 'rgba(0,0,0,0.2)' }}>
                                    <Typography variant="caption" color="primary" sx={{ fontWeight: 600 }}>
                                      To: {msg.to}
                                    </Typography>
                                    <Typography variant="body2" sx={{ mt: 0.5, fontFamily: 'monospace', fontSize: '0.8rem' }}>
                                      {msg.content}
                                    </Typography>
                                  </Paper>
                                ))}
                              </Box>
                            </Box>
                          )}
                          
                          {/* Actions Section */}
                          {actions && actions.length > 0 && (
                            <Box sx={{ mb: 2 }}>
                              <Typography variant="subtitle2" sx={{ mb: 1, color: 'success.main' }}>
                                ⚡ Actions Performed
                              </Typography>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                {actions.map((action, idx) => (
                                  <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                                    <Chip label={action.type} size="small" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                      {JSON.stringify(action.data, null, 0).slice(0, 200)}...
                                    </Typography>
                                  </Box>
                                ))}
                              </Box>
                            </Box>
                          )}
                          
                          {/* Raw Details Fallback */}
                          {details && !messages && !actions && (
                            <Box>
                              <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
                                Raw Details
                              </Typography>
                              <pre style={{ fontSize: '0.7rem', overflow: 'auto', maxHeight: 200 }}>
                                {JSON.stringify(details, null, 2)}
                              </pre>
                            </Box>
                          )}
                        </AccordionDetails>
                      </Accordion>
                    );
                  })}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
