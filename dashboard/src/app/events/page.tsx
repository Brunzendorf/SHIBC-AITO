'use client';

import { useState } from 'react';
import {
  Typography,
  Box,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  TextField,
  InputAdornment,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useEvents } from '@/hooks/useEvents';
import { formatDistanceToNow, formatDate } from '@/lib/utils';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';
import EmptyState from '@/components/common/EmptyState';
import { History as EventIcon } from '@mui/icons-material';

const eventTypeColors: Record<string, string> = {
  agent_started: '#00ff88',
  agent_stopped: '#ff4757',
  agent_loop: '#ffd700',
  agent_error: '#ff4757',
  decision_created: '#45b7d1',
  decision_resolved: '#00ff88',
  decision_vetoed: '#ffa502',
  escalation_created: '#ffa502',
  escalation_resolved: '#00ff88',
  message_sent: '#6c5ce7',
  message_received: '#45b7d1',
  error: '#ff4757',
};

export default function EventsPage() {
  const { data: events, error, isLoading, mutate } = useEvents(100);
  const [filter, setFilter] = useState('');

  const filteredEvents = events?.filter((event) => {
    if (!filter) return true;
    const search = filter.toLowerCase();
    return (
      event.eventType.toLowerCase().includes(search) ||
      event.sourceAgent?.toLowerCase().includes(search) ||
      event.targetAgent?.toLowerCase().includes(search)
    );
  });

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
            System-wide event history
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton onClick={() => mutate()}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Filter */}
      <Box sx={{ mb: 3 }}>
        <TextField
          size="small"
          placeholder="Filter events..."
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
      </Box>

      {!filteredEvents?.length ? (
        <EmptyState
          title={filter ? 'No matching events' : 'No events'}
          description={filter ? 'Try adjusting your filter.' : 'Events will appear here as the system operates.'}
          icon={<EventIcon sx={{ fontSize: 64 }} />}
        />
      ) : (
        <Card>
          <CardContent>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Time</TableCell>
                    <TableCell>Event Type</TableCell>
                    <TableCell>Source</TableCell>
                    <TableCell>Target</TableCell>
                    <TableCell>Details</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredEvents.map((event) => (
                    <TableRow key={event.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title={formatDate(event.createdAt)}>
                          <span>{formatDistanceToNow(event.createdAt)}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={event.eventType.replace(/_/g, ' ')}
                          size="small"
                          sx={{
                            backgroundColor: `${eventTypeColors[event.eventType] || '#666'}20`,
                            color: eventTypeColors[event.eventType] || '#666',
                            fontWeight: 500,
                            fontSize: '0.7rem',
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        {event.sourceAgent || (
                          <Typography variant="caption" color="text.secondary">
                            -
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {event.targetAgent || (
                          <Typography variant="caption" color="text.secondary">
                            -
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {event.payload ? (
                          <Typography
                            variant="caption"
                            sx={{
                              fontFamily: 'monospace',
                              maxWidth: 300,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              display: 'block',
                            }}
                          >
                            {JSON.stringify(event.payload).slice(0, 100)}
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            -
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
