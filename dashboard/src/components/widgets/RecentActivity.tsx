'use client';

import {
  Card,
  CardContent,
  Typography,
  Box,
  List,
  ListItem,
  ListItemText,
  Chip,
  Skeleton,
} from '@mui/material';
import { useEvents } from '@/hooks/useEvents';
import { formatDistanceToNow } from '@/lib/utils';
import EmptyState from '@/components/common/EmptyState';
import { History as EventIcon } from '@mui/icons-material';

const eventTypeColors: Record<string, string> = {
  agent_started: '#00ff88',
  agent_stopped: '#ff4757',
  agent_loop: '#ffd700',
  decision_created: '#45b7d1',
  decision_resolved: '#00ff88',
  escalation_created: '#ffa502',
  escalation_resolved: '#00ff88',
  error: '#ff4757',
};

export default function RecentActivity() {
  const { data: events, isLoading } = useEvents(10);

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Recent Activity
        </Typography>

        {isLoading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} variant="rounded" height={48} />
            ))}
          </Box>
        ) : !events?.length ? (
          <EmptyState
            title="No activity"
            description="Events will appear here as agents work."
            icon={<EventIcon sx={{ fontSize: 48 }} />}
          />
        ) : (
          <List disablePadding>
            {events.map((event) => (
              <ListItem
                key={event.id}
                disablePadding
                sx={{
                  py: 1,
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip
                        label={event.eventType.replace(/_/g, ' ')}
                        size="small"
                        sx={{
                          backgroundColor: `${eventTypeColors[event.eventType] || '#666'}20`,
                          color: eventTypeColors[event.eventType] || '#666',
                          fontSize: '0.7rem',
                          height: 20,
                        }}
                      />
                      {event.sourceAgent && (
                        <Typography variant="caption" color="text.secondary">
                          {event.sourceAgent}
                        </Typography>
                      )}
                    </Box>
                  }
                  secondary={formatDistanceToNow(event.createdAt)}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
