'use client';

import { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip,
  Grid,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Badge,
  Divider,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  ArrowBack as BackIcon,
  ChevronLeft,
  ChevronRight,
  Today as TodayIcon,
  Twitter as TwitterIcon,
  Telegram as TelegramIcon,
  Language as WebIcon,
  Campaign as CampaignIcon,
  Event as EventIcon,
  Celebration as MilestoneIcon,
  Rocket as ReleaseIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useScheduledEvents } from '@/hooks/useProjects';
import type { ScheduledEvent, EventType, Platform, EventStatus } from '@/lib/api';
import Link from 'next/link';

// Event type config
const EVENT_TYPE_CONFIG: Record<EventType, { color: string; icon: React.ReactNode; label: string }> = {
  post: { color: '#1DA1F2', icon: <CampaignIcon />, label: 'Post' },
  ama: { color: '#9B59B6', icon: <EventIcon />, label: 'AMA' },
  release: { color: '#27ae60', icon: <ReleaseIcon />, label: 'Release' },
  milestone: { color: '#f1c40f', icon: <MilestoneIcon />, label: 'Milestone' },
  meeting: { color: '#3498db', icon: <EventIcon />, label: 'Meeting' },
  deadline: { color: '#e74c3c', icon: <ScheduleIcon />, label: 'Deadline' },
  other: { color: '#95a5a6', icon: <EventIcon />, label: 'Other' },
};

// Platform icons
const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  twitter: <TwitterIcon sx={{ fontSize: 16 }} />,
  telegram: <TelegramIcon sx={{ fontSize: 16 }} />,
  discord: <WebIcon sx={{ fontSize: 16 }} />,
  website: <WebIcon sx={{ fontSize: 16 }} />,
};

// Status colors
const STATUS_COLORS: Record<EventStatus, string> = {
  scheduled: '#3498db',
  published: '#27ae60',
  cancelled: '#95a5a6',
  failed: '#e74c3c',
};

// Agent colors
const AGENT_COLORS: Record<string, string> = {
  ceo: '#FFD700',
  dao: '#9B59B6',
  cmo: '#E74C3C',
  cto: '#3498DB',
  cfo: '#2ECC71',
  coo: '#F39C12',
  cco: '#1ABC9C',
};

interface CalendarEventProps {
  event: ScheduledEvent;
}

function CalendarEvent({ event }: CalendarEventProps) {
  const config = EVENT_TYPE_CONFIG[event.eventType];
  const time = new Date(event.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <Paper
      sx={{
        p: 1,
        mb: 0.5,
        borderLeft: `3px solid ${config.color}`,
        backgroundColor: event.status === 'published' ? 'rgba(39, 174, 96, 0.1)' :
                        event.status === 'failed' ? 'rgba(231, 76, 60, 0.1)' :
                        event.status === 'cancelled' ? 'rgba(149, 165, 166, 0.1)' :
                        'background.paper',
        '&:hover': {
          boxShadow: 2,
        },
        transition: 'all 0.2s ease',
        cursor: 'pointer',
      }}
    >
      {/* Time & Type */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <Typography variant="caption" fontWeight={600} color="text.secondary">
          {time}
        </Typography>
        <Box sx={{ color: config.color, display: 'flex', ml: 'auto' }}>
          {config.icon}
        </Box>
        {event.platform && PLATFORM_ICONS[event.platform] && (
          <Box sx={{ display: 'flex', color: 'text.secondary' }}>
            {PLATFORM_ICONS[event.platform]}
          </Box>
        )}
      </Box>

      {/* Title */}
      <Typography
        variant="body2"
        sx={{
          fontWeight: 500,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          textDecoration: event.status === 'cancelled' ? 'line-through' : 'none',
          opacity: event.status === 'cancelled' ? 0.5 : 1,
        }}
      >
        {event.title}
      </Typography>

      {/* Agent & Status */}
      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, alignItems: 'center' }}>
        <Chip
          label={event.agent.toUpperCase()}
          size="small"
          sx={{
            height: 16,
            fontSize: '0.6rem',
            backgroundColor: AGENT_COLORS[event.agent.toLowerCase()] || '#888',
            color: '#000',
          }}
        />
        <Chip
          label={event.status}
          size="small"
          sx={{
            height: 16,
            fontSize: '0.6rem',
            backgroundColor: STATUS_COLORS[event.status],
            color: '#fff',
            textTransform: 'capitalize',
          }}
        />
      </Box>
    </Paper>
  );
}

interface DayColumnProps {
  date: Date;
  events: ScheduledEvent[];
  isToday: boolean;
}

function DayColumn({ date, events, isToday }: DayColumnProps) {
  const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
  const dayNum = date.getDate();
  const monthName = date.toLocaleDateString('en-US', { month: 'short' });

  return (
    <Box
      sx={{
        minWidth: 180,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid',
        borderColor: 'divider',
        '&:last-child': { borderRight: 'none' },
      }}
    >
      {/* Day Header */}
      <Box
        sx={{
          p: 1,
          textAlign: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider',
          backgroundColor: isToday ? 'primary.main' : 'transparent',
          color: isToday ? 'primary.contrastText' : 'inherit',
        }}
      >
        <Typography variant="caption" display="block">
          {dayName}
        </Typography>
        <Typography variant="h6" fontWeight={600}>
          {dayNum}
        </Typography>
        <Typography variant="caption" display="block">
          {monthName}
        </Typography>
      </Box>

      {/* Events */}
      <Box sx={{ p: 0.5, flex: 1, overflowY: 'auto', minHeight: 300 }}>
        {events.length === 0 ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', textAlign: 'center', mt: 4 }}
          >
            No events
          </Typography>
        ) : (
          events.map(event => (
            <CalendarEvent key={event.id} event={event} />
          ))
        )}
      </Box>
    </Box>
  );
}

export default function CalendarPage() {
  const [daysToShow, setDaysToShow] = useState(14);
  const [platformFilter, setPlatformFilter] = useState<string>('');
  const [agentFilter, setAgentFilter] = useState<string>('');

  const { data: events, isLoading, error, mutate } = useScheduledEvents(
    daysToShow,
    platformFilter || undefined,
    agentFilter || undefined
  );

  // Get current date for "today" indicator
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Generate days for the calendar
  const days = useMemo(() => {
    const result: Date[] = [];
    for (let i = 0; i < daysToShow; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      result.push(d);
    }
    return result;
  }, [today, daysToShow]);

  // Group events by date
  const eventsByDate = useMemo(() => {
    if (!events) return new Map<string, ScheduledEvent[]>();

    const map = new Map<string, ScheduledEvent[]>();
    events.forEach(event => {
      const dateKey = new Date(event.scheduledAt).toDateString();
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(event);
    });

    // Sort events within each day by time
    map.forEach((dayEvents, key) => {
      map.set(key, dayEvents.sort((a, b) =>
        new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
      ));
    });

    return map;
  }, [events]);

  // Stats
  const stats = useMemo(() => {
    if (!events) return null;

    const byType = events.reduce((acc, e) => {
      acc[e.eventType] = (acc[e.eventType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const byStatus = events.reduce((acc, e) => {
      acc[e.status] = (acc[e.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      total: events.length,
      byType,
      byStatus,
    };
  }, [events]);

  // Get unique agents and platforms for filters
  const agents = useMemo(() => {
    if (!events) return [];
    return [...new Set(events.map(e => e.agent))];
  }, [events]);

  const platforms = useMemo(() => {
    if (!events) return [];
    return [...new Set(events.map(e => e.platform).filter((p): p is NonNullable<typeof p> => p != null))];
  }, [events]);

  return (
    <DashboardLayout>
      <Box sx={{ p: 2 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Tooltip title="Back to Projects">
              <IconButton component={Link} href="/projects">
                <BackIcon />
              </IconButton>
            </Tooltip>
            <Box>
              <Typography variant="h5" fontWeight={600}>
                Event Calendar
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Scheduled posts, AMAs, releases, and milestones
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>Days</InputLabel>
              <Select
                value={daysToShow}
                onChange={(e) => setDaysToShow(e.target.value as number)}
                label="Days"
              >
                <MenuItem value={7}>7 days</MenuItem>
                <MenuItem value={14}>14 days</MenuItem>
                <MenuItem value={30}>30 days</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Platform</InputLabel>
              <Select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                label="Platform"
              >
                <MenuItem value="">All</MenuItem>
                {platforms.map(p => (
                  <MenuItem key={p} value={p}>
                    {p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Unknown'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>Agent</InputLabel>
              <Select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                label="Agent"
              >
                <MenuItem value="">All</MenuItem>
                {agents.map(a => (
                  <MenuItem key={a} value={a}>
                    {a.toUpperCase()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Tooltip title="Refresh">
              <IconButton onClick={() => mutate()} disabled={isLoading}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Stats */}
        {stats && (
          <Paper sx={{ p: 1.5, mb: 2 }}>
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography variant="body2" fontWeight={600}>
                {stats.total} events in next {daysToShow} days
              </Typography>
              <Divider orientation="vertical" flexItem />
              {Object.entries(EVENT_TYPE_CONFIG).map(([type, config]) => {
                const count = stats.byType[type] || 0;
                if (count === 0) return null;
                return (
                  <Box key={type} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ color: config.color, display: 'flex' }}>{config.icon}</Box>
                    <Typography variant="caption">
                      {config.label}: {count}
                    </Typography>
                  </Box>
                );
              })}
              <Divider orientation="vertical" flexItem />
              {stats.byStatus['scheduled'] && (
                <Chip
                  label={`${stats.byStatus['scheduled']} scheduled`}
                  size="small"
                  sx={{ backgroundColor: STATUS_COLORS.scheduled, color: '#fff' }}
                />
              )}
              {stats.byStatus['published'] && (
                <Chip
                  label={`${stats.byStatus['published']} published`}
                  size="small"
                  sx={{ backgroundColor: STATUS_COLORS.published, color: '#fff' }}
                />
              )}
            </Box>
          </Paper>
        )}

        {/* Error State */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Failed to load events: {error.message}
          </Alert>
        )}

        {/* Loading State */}
        {isLoading && !events && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Calendar Grid */}
        {events && (
          <Paper sx={{ overflow: 'hidden' }}>
            <Box
              sx={{
                display: 'flex',
                overflowX: 'auto',
                minHeight: 400,
              }}
            >
              {days.map(day => (
                <DayColumn
                  key={day.toISOString()}
                  date={day}
                  events={eventsByDate.get(day.toDateString()) || []}
                  isToday={day.toDateString() === today.toDateString()}
                />
              ))}
            </Box>
          </Paper>
        )}

        {/* Legend */}
        <Paper sx={{ p: 2, mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Legend
          </Typography>
          <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Event Types
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                {Object.entries(EVENT_TYPE_CONFIG).map(([type, config]) => (
                  <Chip
                    key={type}
                    icon={config.icon as React.ReactElement}
                    label={config.label}
                    size="small"
                    sx={{
                      backgroundColor: config.color,
                      color: '#fff',
                      fontSize: '0.7rem',
                      '& .MuiChip-icon': { color: '#fff' },
                    }}
                  />
                ))}
              </Box>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Status
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                {Object.entries(STATUS_COLORS).map(([status, color]) => (
                  <Chip
                    key={status}
                    label={status}
                    size="small"
                    sx={{
                      backgroundColor: color,
                      color: '#fff',
                      fontSize: '0.7rem',
                      textTransform: 'capitalize',
                    }}
                  />
                ))}
              </Box>
            </Box>
          </Box>
        </Paper>
      </Box>
    </DashboardLayout>
  );
}
