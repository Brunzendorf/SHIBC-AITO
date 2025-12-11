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
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Paper,
  Stack,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
  Avatar,
} from '@mui/material';
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  AccountTree as ChainIcon,
  ViewList as ListIcon,
  ArrowForward as ArrowIcon,
  Schedule as PendingIcon,
} from '@mui/icons-material';
import { useEvents } from '@/hooks/useEvents';
import { useAgents } from '@/hooks/useAgents';
import { formatDistanceToNow, formatDate } from '@/lib/utils';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';
import EmptyState from '@/components/common/EmptyState';
import { History as EventIcon } from '@mui/icons-material';

interface Event {
  id: string;
  eventType: string;
  sourceAgent?: string;
  targetAgent?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
  correlationId?: string;
}

interface Agent {
  id: string;
  type: string;
  name: string;
}

// Agent colors for visual distinction
const agentColors: Record<string, string> = {
  ceo: '#ffd700',
  dao: '#9b59b6',
  cmo: '#e91e63',
  cto: '#2196f3',
  cfo: '#4caf50',
  coo: '#ff9800',
  cco: '#00bcd4',
  system: '#666',
};

const agentEmojis: Record<string, string> = {
  ceo: '👔',
  dao: '🏛️',
  cmo: '📣',
  cto: '💻',
  cfo: '💰',
  coo: '⚙️',
  cco: '📋',
  system: '🤖',
};

const eventTypeLabels: Record<string, string> = {
  decision: 'Entscheidung vorgeschlagen',
  decision_created: 'Entscheidung erstellt',
  decision_resolved: 'Entscheidung genehmigt',
  decision_vetoed: 'Entscheidung abgelehnt',
  task: 'Task erstellt',
  task_created: 'Task zugewiesen',
  task_completed: 'Task abgeschlossen',
  message: 'Nachricht',
  alert: 'Warnung',
  broadcast: 'Broadcast',
  agent_started: 'Agent gestartet',
  agent_stopped: 'Agent gestoppt',
  agent_loop: 'Loop ausgeführt',
  error: 'Fehler',
};

const eventTypeColors: Record<string, string> = {
  decision: '#45b7d1',
  decision_created: '#45b7d1',
  decision_resolved: '#00ff88',
  decision_vetoed: '#ff4757',
  task: '#ffd700',
  task_created: '#ffd700',
  task_completed: '#00ff88',
  message: '#6c5ce7',
  alert: '#ffa502',
  broadcast: '#9b59b6',
  agent_started: '#00ff88',
  agent_stopped: '#ff4757',
  agent_loop: '#666',
  error: '#ff4757',
};

// Extract human-readable summary from payload
function extractSummary(event: Event): string {
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p) return '';

  // Direct message field
  if (p.message && typeof p.message === 'string') return p.message;

  // Title field (decisions, tasks)
  if (p.title && typeof p.title === 'string') return p.title;

  // Summary field
  if (p.summary && typeof p.summary === 'string') return p.summary;

  // Content field
  if (p.content && typeof p.content === 'string') return p.content;

  // Type + description
  if (p.type && typeof p.type === 'string') {
    const desc = p.description || p.reason || '';
    return `${p.type}${desc ? ': ' + desc : ''}`;
  }

  // eventType from payload
  if (p.eventType && typeof p.eventType === 'string') {
    return p.eventType.replace(/_/g, ' ');
  }

  return '';
}

// Check if event represents a "waiting" state
function isWaitingEvent(event: Event): boolean {
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p) return false;

  const msg = String(p.message || p.status || '').toLowerCase();
  return msg.includes('waiting') ||
         msg.includes('pending') ||
         msg.includes('awaiting') ||
         msg.includes('approval') ||
         msg.includes('required');
}

export default function EventsPage() {
  const { data: events, error, isLoading, mutate } = useEvents(100);
  const { data: agents } = useAgents();
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<string | false>(false);
  const [viewMode, setViewMode] = useState<'list' | 'flow'>('flow');

  // Create agent lookup map
  const agentMap = useMemo(() => {
    const map: Record<string, Agent> = {};
    if (agents) {
      agents.forEach((agent: Agent) => {
        map[agent.id] = agent;
      });
    }
    return map;
  }, [agents]);

  // Get agent name from ID
  const getAgentName = (id?: string): string => {
    if (!id) return 'System';
    const agent = agentMap[id];
    return agent ? agent.type.toUpperCase() : id.slice(0, 8);
  };

  const getAgentType = (id?: string): string => {
    if (!id) return 'system';
    const agent = agentMap[id];
    return agent ? agent.type : 'system';
  };

  const filteredEvents = useMemo(() => {
    if (!events) return [];
    if (!filter) return events;
    const search = filter.toLowerCase();
    return events.filter((event: Event) => {
      const sourceName = getAgentName(event.sourceAgent).toLowerCase();
      const targetName = getAgentName(event.targetAgent).toLowerCase();
      const summary = extractSummary(event).toLowerCase();
      return (
        event.eventType.toLowerCase().includes(search) ||
        sourceName.includes(search) ||
        targetName.includes(search) ||
        summary.includes(search)
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, filter, agentMap]);

  const handleAccordionChange = (panel: string) => (_: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };

  if (isLoading) return <Loading message="Loading events..." />;
  if (error) return <ErrorDisplay error={error} onRetry={() => mutate()} />;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
            Event Log
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Agent-Kommunikation und Systemereignisse
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, v) => v && setViewMode(v)}
            size="small"
          >
            <ToggleButton value="flow">
              <Tooltip title="Flow View (empfohlen)">
                <ChainIcon />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="list">
              <Tooltip title="Liste">
                <ListIcon />
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          <Tooltip title="Aktualisieren">
            <IconButton onClick={() => mutate()}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      {/* Filter */}
      <Box sx={{ mb: 3 }}>
        <TextField
          size="small"
          placeholder="Filter nach Agent, Typ oder Inhalt..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" />
              </InputAdornment>
            ),
          }}
          sx={{ width: 400 }}
        />
      </Box>

      {/* Agent Legend */}
      <Box sx={{ mb: 3, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {Object.entries(agentColors).filter(([key]) => key !== 'system').map(([type, color]) => (
          <Chip
            key={type}
            avatar={<Avatar sx={{ bgcolor: color + '40' }}>{agentEmojis[type]}</Avatar>}
            label={type.toUpperCase()}
            size="small"
            sx={{
              borderColor: color,
              color: color,
              '& .MuiAvatar-root': { fontSize: '0.8rem' }
            }}
            variant="outlined"
          />
        ))}
      </Box>

      {!filteredEvents?.length ? (
        <EmptyState
          title={filter ? 'Keine passenden Events' : 'Keine Events'}
          description={filter ? 'Versuche einen anderen Filter.' : 'Events erscheinen hier sobald das System aktiv ist.'}
          icon={<EventIcon sx={{ fontSize: 64 }} />}
        />
      ) : viewMode === 'flow' ? (
        // Flow View - Communication focused
        <Stack spacing={1}>
          {filteredEvents.map((event: Event) => {
            const sourceType = getAgentType(event.sourceAgent);
            const targetType = getAgentType(event.targetAgent);
            const sourceName = getAgentName(event.sourceAgent);
            const targetName = event.targetAgent ? getAgentName(event.targetAgent) : null;
            const summary = extractSummary(event);
            const isWaiting = isWaitingEvent(event);
            const eventColor = eventTypeColors[event.eventType] || '#666';

            return (
              <Accordion
                key={event.id}
                expanded={expanded === event.id}
                onChange={handleAccordionChange(event.id)}
                sx={{
                  backgroundColor: isWaiting ? 'rgba(255, 165, 0, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                  '&:before': { display: 'none' },
                  borderLeft: `4px solid ${agentColors[sourceType] || '#666'}`,
                  borderRight: isWaiting ? '4px solid #ffa502' : 'none',
                }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', flexWrap: 'wrap' }}>
                    {/* Source Agent */}
                    <Chip
                      avatar={<Avatar sx={{ bgcolor: agentColors[sourceType] + '40', width: 24, height: 24, fontSize: '0.75rem' }}>
                        {agentEmojis[sourceType] || '🤖'}
                      </Avatar>}
                      label={sourceName}
                      size="small"
                      sx={{
                        fontWeight: 600,
                        bgcolor: agentColors[sourceType] + '20',
                        color: agentColors[sourceType],
                        border: `1px solid ${agentColors[sourceType]}40`,
                      }}
                    />

                    {/* Arrow + Target (if exists) */}
                    {targetName && (
                      <>
                        <ArrowIcon sx={{ color: 'text.secondary', fontSize: '1rem' }} />
                        <Chip
                          avatar={<Avatar sx={{ bgcolor: agentColors[targetType] + '40', width: 24, height: 24, fontSize: '0.75rem' }}>
                            {agentEmojis[targetType] || '🤖'}
                          </Avatar>}
                          label={targetName}
                          size="small"
                          sx={{
                            fontWeight: 600,
                            bgcolor: agentColors[targetType] + '20',
                            color: agentColors[targetType],
                            border: `1px solid ${agentColors[targetType]}40`,
                          }}
                        />
                      </>
                    )}

                    {/* Event Type Badge */}
                    <Chip
                      label={eventTypeLabels[event.eventType] || event.eventType.replace(/_/g, ' ')}
                      size="small"
                      sx={{
                        backgroundColor: eventColor + '20',
                        color: eventColor,
                        fontSize: '0.7rem',
                        height: 20,
                      }}
                    />

                    {/* Waiting indicator */}
                    {isWaiting && (
                      <Tooltip title="Wartet auf Aktion">
                        <PendingIcon sx={{ color: '#ffa502', fontSize: '1.2rem' }} />
                      </Tooltip>
                    )}

                    {/* Summary text */}
                    {summary && (
                      <Typography
                        variant="body2"
                        sx={{
                          flex: 1,
                          color: 'text.secondary',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                          ml: 1,
                        }}
                      >
                        {summary.length > 80 ? summary.slice(0, 80) + '...' : summary}
                      </Typography>
                    )}

                    {/* Timestamp */}
                    <Tooltip title={formatDate(event.createdAt)}>
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', flexShrink: 0 }}>
                        {formatDistanceToNow(event.createdAt)}
                      </Typography>
                    </Tooltip>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    {/* Full Summary */}
                    {summary && (
                      <Paper sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.03)' }}>
                        <Typography variant="body2">{summary}</Typography>
                      </Paper>
                    )}

                    {/* Metadata */}
                    <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Von</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: agentColors[sourceType] }}>
                          {agentEmojis[sourceType]} {sourceName}
                        </Typography>
                      </Box>
                      {targetName && (
                        <Box>
                          <Typography variant="caption" color="text.secondary">An</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: agentColors[targetType] }}>
                            {agentEmojis[targetType]} {targetName}
                          </Typography>
                        </Box>
                      )}
                      <Box>
                        <Typography variant="caption" color="text.secondary">Typ</Typography>
                        <Typography variant="body2">{event.eventType}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Zeit</Typography>
                        <Typography variant="body2">{formatDate(event.createdAt)}</Typography>
                      </Box>
                    </Box>

                    {/* Full Payload */}
                    {event.payload && Object.keys(event.payload).length > 0 && (
                      <>
                        <Divider />
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                            Vollständige Daten
                          </Typography>
                          <Paper
                            sx={{
                              p: 2,
                              backgroundColor: 'rgba(0, 0, 0, 0.3)',
                              maxHeight: 300,
                              overflow: 'auto',
                            }}
                          >
                            <pre style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                              {JSON.stringify(event.payload, null, 2)}
                            </pre>
                          </Paper>
                        </Box>
                      </>
                    )}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Stack>
      ) : (
        // Simple List View
        <Stack spacing={1}>
          {filteredEvents.map((event: Event) => (
            <Card
              key={event.id}
              sx={{
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderLeft: `3px solid ${eventTypeColors[event.eventType] || '#666'}`,
              }}
            >
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography sx={{ fontWeight: 600, minWidth: 60 }}>
                    {getAgentName(event.sourceAgent)}
                  </Typography>
                  {event.targetAgent && (
                    <>
                      <ArrowIcon sx={{ color: 'text.secondary', fontSize: '1rem' }} />
                      <Typography sx={{ fontWeight: 600, minWidth: 60 }}>
                        {getAgentName(event.targetAgent)}
                      </Typography>
                    </>
                  )}
                  <Chip
                    label={event.eventType}
                    size="small"
                    sx={{ fontSize: '0.7rem' }}
                  />
                  <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                    {extractSummary(event).slice(0, 60)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatDistanceToNow(event.createdAt)}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
}
