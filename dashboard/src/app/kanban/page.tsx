'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip,
  Link,
  Badge,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  OpenInNew as OpenInNewIcon,
  BugReport as BugIcon,
  Lightbulb as IdeaIcon,
  Build as TaskIcon,
  Group as EpicIcon,
} from '@mui/icons-material';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { getBacklogIssues, getBacklogStats, KanbanIssue, BacklogStats } from '@/lib/api';

// Status columns configuration
const COLUMNS = [
  { id: 'backlog', label: 'Backlog', color: '#666666' },
  { id: 'ready', label: 'Ready', color: '#0E8A16' },
  { id: 'in_progress', label: 'In Progress', color: '#FFA500' },
  { id: 'review', label: 'Review', color: '#1D76DB' },
  { id: 'done', label: 'Done', color: '#2ECC71' },
  { id: 'blocked', label: 'Blocked', color: '#D93F0B' },
];

// Priority colors
const PRIORITY_COLORS: Record<string, string> = {
  critical: '#B60205',
  high: '#D93F0B',
  medium: '#FBCA04',
  low: '#0E8A16',
};

// Effort badge colors
const EFFORT_COLORS: Record<string, string> = {
  xs: '#C5DEF5',
  s: '#7DC4E4',
  m: '#0969DA',
  l: '#1D76DB',
  xl: '#0E34A0',
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

interface KanbanCardProps {
  issue: KanbanIssue;
}

function KanbanCard({ issue }: KanbanCardProps) {
  const isEpic = issue.isEpic || issue.labels.includes('type:epic');
  const isBug = issue.labels.some(l => l.toLowerCase().includes('bug'));

  // Extract agent from labels
  const agentLabel = issue.labels.find(l => l.startsWith('agent:'));
  const agent = agentLabel?.replace('agent:', '') || issue.assignee;

  return (
    <Paper
      sx={{
        p: 1.5,
        mb: 1,
        backgroundColor: isEpic ? 'rgba(83, 25, 231, 0.1)' : 'background.paper',
        borderLeft: issue.priority ? `4px solid ${PRIORITY_COLORS[issue.priority]}` : '4px solid transparent',
        '&:hover': {
          boxShadow: 3,
          transform: 'translateY(-2px)',
        },
        transition: 'all 0.2s ease',
        cursor: 'pointer',
      }}
      onClick={() => issue.html_url && window.open(issue.html_url, '_blank')}
    >
      {/* Header: Number + Type Icon */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        {isEpic ? (
          <EpicIcon sx={{ fontSize: 16, color: '#5319E7' }} />
        ) : isBug ? (
          <BugIcon sx={{ fontSize: 16, color: '#D93F0B' }} />
        ) : (
          <TaskIcon sx={{ fontSize: 16, color: '#666' }} />
        )}
        <Typography variant="caption" color="text.secondary">
          #{issue.number}
        </Typography>
        {issue.epicNumber && (
          <Chip
            label={`Epic #${issue.epicNumber}`}
            size="small"
            sx={{ height: 16, fontSize: '0.65rem', ml: 'auto' }}
          />
        )}
      </Box>

      {/* Title */}
      <Typography
        variant="body2"
        sx={{
          fontWeight: isEpic ? 600 : 400,
          mb: 1,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {issue.title}
      </Typography>

      {/* Footer: Agent + Effort + Priority */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        {agent && (
          <Chip
            label={agent.toUpperCase()}
            size="small"
            sx={{
              height: 18,
              fontSize: '0.65rem',
              backgroundColor: AGENT_COLORS[agent.toLowerCase()] || '#888',
              color: '#000',
            }}
          />
        )}
        {issue.effort && (
          <Chip
            label={issue.effort.toUpperCase()}
            size="small"
            sx={{
              height: 18,
              fontSize: '0.65rem',
              backgroundColor: EFFORT_COLORS[issue.effort] || '#888',
              color: '#fff',
            }}
          />
        )}
        {issue.priority && (
          <Tooltip title={`Priority: ${issue.priority}`}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: PRIORITY_COLORS[issue.priority],
                ml: 'auto',
              }}
            />
          </Tooltip>
        )}
      </Box>
    </Paper>
  );
}

interface KanbanColumnProps {
  id: string;
  label: string;
  color: string;
  issues: KanbanIssue[];
}

function KanbanColumn({ id, label, color, issues }: KanbanColumnProps) {
  return (
    <Box
      sx={{
        minWidth: 280,
        maxWidth: 320,
        flex: '1 1 280px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Column Header */}
      <Paper
        sx={{
          p: 1.5,
          mb: 1,
          backgroundColor: 'background.paper',
          borderTop: `3px solid ${color}`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="subtitle2" fontWeight={600}>
            {label}
          </Typography>
          <Badge
            badgeContent={issues.length}
            color={id === 'in_progress' ? 'warning' : id === 'blocked' ? 'error' : 'default'}
            sx={{
              '& .MuiBadge-badge': {
                backgroundColor: color,
                color: '#fff',
              },
            }}
          />
        </Box>
      </Paper>

      {/* Column Content */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          p: 0.5,
          backgroundColor: 'rgba(0,0,0,0.1)',
          borderRadius: 1,
          minHeight: 400,
        }}
      >
        {issues.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: 'center', py: 4 }}
          >
            No issues
          </Typography>
        ) : (
          issues.map(issue => (
            <KanbanCard key={issue.number} issue={issue} />
          ))
        )}
      </Box>
    </Box>
  );
}

export default function KanbanPage() {
  const [issues, setIssues] = useState<KanbanIssue[]>([]);
  const [stats, setStats] = useState<BacklogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    const [issuesRes, statsRes] = await Promise.all([
      getBacklogIssues(),
      getBacklogStats(),
    ]);

    if (issuesRes.error) {
      setError(issuesRes.error);
    } else if (issuesRes.data) {
      setIssues(issuesRes.data);
    }

    if (statsRes.data) {
      setStats(statsRes.data);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  // Group issues by status
  const issuesByStatus = COLUMNS.reduce((acc, col) => {
    acc[col.id] = issues.filter(issue => issue.status === col.id);
    return acc;
  }, {} as Record<string, KanbanIssue[]>);

  // Sort by priority within each column
  const sortedIssuesByStatus = Object.entries(issuesByStatus).reduce((acc, [status, statusIssues]) => {
    const priorityOrder = ['critical', 'high', 'medium', 'low'];
    acc[status] = [...statusIssues].sort((a, b) => {
      const aIdx = priorityOrder.indexOf(a.priority || 'low');
      const bIdx = priorityOrder.indexOf(b.priority || 'low');
      return aIdx - bIdx;
    });
    return acc;
  }, {} as Record<string, KanbanIssue[]>);

  return (
    <DashboardLayout>
      <Box sx={{ p: 2 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Box>
            <Typography variant="h5" fontWeight={600}>
              Kanban Board
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Scrumban workflow - Issues organized by status
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {stats && (
              <Typography variant="body2" color="text.secondary">
                {stats.total} total issues
                {stats.lastGroomed && ` | Last groomed: ${new Date(stats.lastGroomed).toLocaleString()}`}
              </Typography>
            )}
            <Tooltip title="Refresh">
              <IconButton onClick={fetchData} disabled={loading}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Open GitHub Issues">
              <IconButton
                component={Link}
                href="https://github.com/Brunzendorf/SHIBC-AITO/issues"
                target="_blank"
              >
                <OpenInNewIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Error State */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Failed to load issues: {error}
          </Alert>
        )}

        {/* Loading State */}
        {loading && issues.length === 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Kanban Board */}
        {!loading || issues.length > 0 ? (
          <Box
            sx={{
              display: 'flex',
              gap: 2,
              overflowX: 'auto',
              pb: 2,
              minHeight: 'calc(100vh - 250px)',
            }}
          >
            {COLUMNS.map(col => (
              <KanbanColumn
                key={col.id}
                id={col.id}
                label={col.label}
                color={col.color}
                issues={sortedIssuesByStatus[col.id] || []}
              />
            ))}
          </Box>
        ) : null}

        {/* Legend */}
        <Paper sx={{ p: 2, mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Legend
          </Typography>
          <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Priority
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                {Object.entries(PRIORITY_COLORS).map(([priority, color]) => (
                  <Chip
                    key={priority}
                    label={priority}
                    size="small"
                    sx={{
                      backgroundColor: color,
                      color: priority === 'medium' ? '#000' : '#fff',
                      fontSize: '0.7rem',
                    }}
                  />
                ))}
              </Box>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Effort
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                {Object.entries(EFFORT_COLORS).map(([effort, color]) => (
                  <Chip
                    key={effort}
                    label={effort.toUpperCase()}
                    size="small"
                    sx={{ backgroundColor: color, color: '#fff', fontSize: '0.7rem' }}
                  />
                ))}
              </Box>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Type
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mt: 0.5, alignItems: 'center' }}>
                <EpicIcon sx={{ fontSize: 18, color: '#5319E7' }} />
                <Typography variant="caption">Epic</Typography>
                <BugIcon sx={{ fontSize: 18, color: '#D93F0B', ml: 1 }} />
                <Typography variant="caption">Bug</Typography>
                <TaskIcon sx={{ fontSize: 18, color: '#666', ml: 1 }} />
                <Typography variant="caption">Task</Typography>
              </Box>
            </Box>
          </Box>
        </Paper>
      </Box>
    </DashboardLayout>
  );
}
