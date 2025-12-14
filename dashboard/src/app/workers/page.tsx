'use client';

import { useState, useMemo } from 'react';
import {
  Typography,
  Box,
  Card,
  CardContent,
  Chip,
  TextField,
  InputAdornment,
  IconButton,
  Tooltip,
  Stack,
  Paper,
  Avatar,
  FormControlLabel,
  Switch,
  LinearProgress,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Science as DryRunIcon,
  Memory as WorkerIcon,
  Timer as DurationIcon,
  OpenInNew as LinkIcon,
} from '@mui/icons-material';
import { useWorkerExecutions, useWorkerStats } from '@/hooks/useWorkers';
import { formatDistanceToNow, formatDate } from '@/lib/utils';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';
import EmptyState from '@/components/common/EmptyState';
import type { WorkerExecution } from '@/lib/api';

// Agent colors for visual distinction
const agentColors: Record<string, string> = {
  ceo: '#ffd700',
  dao: '#9b59b6',
  cmo: '#e91e63',
  cto: '#2196f3',
  cfo: '#4caf50',
  coo: '#ff9800',
  cco: '#00bcd4',
};

const agentEmojis: Record<string, string> = {
  ceo: '👔',
  dao: '🏛️',
  cmo: '📣',
  cto: '💻',
  cfo: '💰',
  coo: '⚙️',
  cco: '📋',
};

// MCP Server colors
const serverColors: Record<string, string> = {
  telegram: '#0088cc',
  twitter: '#1da1f2',
  fetch: '#ff6b6b',
  filesystem: '#95a5a6',
  etherscan: '#21325b',
  directus: '#6644ff',
  time: '#f39c12',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export default function WorkersPage() {
  const [filter, setFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [includeDryRun, setIncludeDryRun] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { executions, error, isLoading, mutate } = useWorkerExecutions(
    100,
    agentFilter === 'all' ? undefined : agentFilter,
    includeDryRun
  );
  const { stats } = useWorkerStats();

  const filteredExecutions = useMemo(() => {
    if (!executions) return [];
    if (!filter) return executions;
    const search = filter.toLowerCase();
    return executions.filter((exec: WorkerExecution) =>
      exec.parentAgent?.toLowerCase().includes(search) ||
      exec.task?.toLowerCase().includes(search) ||
      exec.servers?.some(s => s.toLowerCase().includes(search)) ||
      exec.taskId?.toLowerCase().includes(search)
    );
  }, [executions, filter]);

  if (isLoading) return <Loading message="Loading worker executions..." />;
  if (error) return <ErrorDisplay error={error} onRetry={() => mutate()} />;

  const successRate = stats ? Math.round((stats.success / Math.max(stats.total, 1)) * 100) : 0;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
            Worker Executions
          </Typography>
          <Typography variant="body2" color="text.secondary">
            MCP Worker Tasks und externe API-Aufrufe
          </Typography>
        </Box>
        <Tooltip title="Aktualisieren">
          <IconButton onClick={() => mutate()}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Stats Summary */}
      {stats && (
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          <Card sx={{ minWidth: 120, bgcolor: 'rgba(255,255,255,0.02)' }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">Total</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{stats.total}</Typography>
            </CardContent>
          </Card>
          <Card sx={{ minWidth: 120, bgcolor: 'rgba(76, 175, 80, 0.1)' }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">Erfolg</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700, color: '#4caf50' }}>{stats.success}</Typography>
            </CardContent>
          </Card>
          <Card sx={{ minWidth: 120, bgcolor: 'rgba(244, 67, 54, 0.1)' }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">Fehler</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700, color: '#f44336' }}>{stats.failure}</Typography>
            </CardContent>
          </Card>
          <Card sx={{ minWidth: 120, bgcolor: 'rgba(156, 39, 176, 0.1)' }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">DRY-RUN</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700, color: '#9c27b6' }}>{stats.dryRunCount}</Typography>
            </CardContent>
          </Card>
          <Card sx={{ minWidth: 150, bgcolor: 'rgba(255,255,255,0.02)' }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">Erfolgsrate</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>{successRate}%</Typography>
                <LinearProgress
                  variant="determinate"
                  value={successRate}
                  sx={{ flex: 1, height: 8, borderRadius: 4 }}
                  color={successRate >= 80 ? 'success' : successRate >= 50 ? 'warning' : 'error'}
                />
              </Box>
            </CardContent>
          </Card>
          <Card sx={{ minWidth: 120, bgcolor: 'rgba(255,255,255,0.02)' }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">Avg. Dauer</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{formatDuration(stats.avgDurationMs)}</Typography>
            </CardContent>
          </Card>
        </Box>
      )}

      {/* Filters */}
      <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Filter nach Task, Agent, Server..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" />
              </InputAdornment>
            ),
          }}
          sx={{ width: 300 }}
        />

        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Agent</InputLabel>
          <Select
            value={agentFilter}
            label="Agent"
            onChange={(e) => setAgentFilter(e.target.value)}
          >
            <MenuItem value="all">Alle Agents</MenuItem>
            {Object.keys(agentColors).map(agent => (
              <MenuItem key={agent} value={agent}>
                {agentEmojis[agent]} {agent.toUpperCase()}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControlLabel
          control={
            <Switch
              checked={includeDryRun}
              onChange={(e) => setIncludeDryRun(e.target.checked)}
              color="secondary"
            />
          }
          label="DRY-RUN anzeigen"
        />
      </Box>

      {/* Server Legend */}
      <Box sx={{ mb: 3, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {Object.entries(serverColors).map(([server, color]) => (
          <Chip
            key={server}
            label={server}
            size="small"
            sx={{
              borderColor: color,
              color: color,
              fontSize: '0.7rem',
            }}
            variant="outlined"
          />
        ))}
      </Box>

      {/* Execution List */}
      {!filteredExecutions?.length ? (
        <EmptyState
          title={filter ? 'Keine passenden Workers' : 'Keine Worker Executions'}
          description={filter ? 'Versuche einen anderen Filter.' : 'Worker Executions erscheinen hier sobald Agents MCP Tasks ausführen.'}
          icon={<WorkerIcon sx={{ fontSize: 64 }} />}
        />
      ) : (
        <Stack spacing={1}>
          {filteredExecutions.map((exec: WorkerExecution) => {
            const agentColor = agentColors[exec.parentAgent] || '#666';
            const isExpanded = expanded === exec.taskId;

            return (
              <Card
                key={exec.taskId}
                sx={{
                  backgroundColor: exec.dryRun
                    ? 'rgba(156, 39, 176, 0.08)'
                    : exec.success
                      ? 'rgba(76, 175, 80, 0.05)'
                      : 'rgba(244, 67, 54, 0.08)',
                  borderLeft: `4px solid ${agentColor}`,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
                }}
                onClick={() => setExpanded(isExpanded ? null : exec.taskId)}
              >
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                    {/* Status Icon */}
                    {exec.dryRun ? (
                      <Tooltip title="DRY-RUN (simuliert)">
                        <DryRunIcon sx={{ color: '#9c27b6' }} />
                      </Tooltip>
                    ) : exec.success ? (
                      <Tooltip title="Erfolgreich">
                        <SuccessIcon sx={{ color: '#4caf50' }} />
                      </Tooltip>
                    ) : (
                      <Tooltip title="Fehlgeschlagen">
                        <ErrorIcon sx={{ color: '#f44336' }} />
                      </Tooltip>
                    )}

                    {/* Parent Agent */}
                    <Chip
                      avatar={
                        <Avatar sx={{ bgcolor: agentColor + '40', width: 24, height: 24, fontSize: '0.75rem' }}>
                          {agentEmojis[exec.parentAgent] || '🤖'}
                        </Avatar>
                      }
                      label={exec.parentAgent?.toUpperCase()}
                      size="small"
                      sx={{
                        fontWeight: 600,
                        bgcolor: agentColor + '20',
                        color: agentColor,
                        border: `1px solid ${agentColor}40`,
                      }}
                    />

                    {/* MCP Servers Used */}
                    {exec.servers?.map(server => (
                      <Chip
                        key={server}
                        label={server}
                        size="small"
                        sx={{
                          fontSize: '0.7rem',
                          height: 22,
                          bgcolor: (serverColors[server] || '#666') + '20',
                          color: serverColors[server] || '#666',
                          border: `1px solid ${serverColors[server] || '#666'}40`,
                        }}
                      />
                    ))}

                    {/* Task Description */}
                    <Typography
                      variant="body2"
                      sx={{
                        flex: 1,
                        color: 'text.secondary',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}
                    >
                      {exec.task ? (exec.task.length > 60 ? exec.task.slice(0, 60) + '...' : exec.task) : exec.taskId.slice(0, 8)}
                    </Typography>

                    {/* Duration */}
                    <Tooltip title="Dauer">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                        <DurationIcon sx={{ fontSize: '1rem' }} />
                        <Typography variant="caption">{formatDuration(exec.duration)}</Typography>
                      </Box>
                    </Tooltip>

                    {/* Timestamp */}
                    <Tooltip title={formatDate(exec.timestamp)}>
                      <Typography variant="caption" color="text.secondary">
                        {formatDistanceToNow(exec.timestamp)}
                      </Typography>
                    </Tooltip>
                  </Box>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                      <Stack spacing={2}>
                        {/* Full Task */}
                        {exec.task && (
                          <Box>
                            <Typography variant="caption" color="text.secondary">Task</Typography>
                            <Paper sx={{ p: 1.5, bgcolor: 'rgba(0,0,0,0.2)', mt: 0.5 }}>
                              <Typography variant="body2">{exec.task}</Typography>
                            </Paper>
                          </Box>
                        )}

                        {/* Error Message */}
                        {exec.error && (
                          <Box>
                            <Typography variant="caption" color="error">Fehler</Typography>
                            <Paper sx={{ p: 1.5, bgcolor: 'rgba(244,67,54,0.1)', mt: 0.5 }}>
                              <Typography variant="body2" color="error">{exec.error}</Typography>
                            </Paper>
                          </Box>
                        )}

                        {/* Tools Used */}
                        {exec.toolsUsed && exec.toolsUsed.length > 0 && (
                          <Box>
                            <Typography variant="caption" color="text.secondary">Tools verwendet</Typography>
                            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                              {exec.toolsUsed.map((tool, i) => (
                                <Chip key={i} label={tool} size="small" sx={{ fontSize: '0.7rem' }} />
                              ))}
                            </Box>
                          </Box>
                        )}

                        {/* Metadata */}
                        <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <Box>
                            <Typography variant="caption" color="text.secondary">Task ID</Typography>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                              {exec.taskId}
                            </Typography>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary">Zeit</Typography>
                            <Typography variant="body2">{formatDate(exec.timestamp)}</Typography>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary">Dauer</Typography>
                            <Typography variant="body2">{formatDuration(exec.duration)}</Typography>
                          </Box>
                          {exec.dryRun && (
                            <Box>
                              <Typography variant="caption" color="text.secondary">Modus</Typography>
                              <Typography variant="body2" sx={{ color: '#9c27b6' }}>DRY-RUN (simuliert)</Typography>
                            </Box>
                          )}
                        </Box>

                        {/* Link to Agent */}
                        <Box>
                          <Chip
                            icon={<LinkIcon sx={{ fontSize: '1rem' }} />}
                            label={`Zu ${exec.parentAgent?.toUpperCase()} Agent`}
                            size="small"
                            component="a"
                            href={`/agents/${exec.parentAgent}`}
                            clickable
                            sx={{ color: agentColor }}
                          />
                        </Box>
                      </Stack>
                    </Box>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
