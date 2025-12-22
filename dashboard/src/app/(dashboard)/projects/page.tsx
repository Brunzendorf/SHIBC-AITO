'use client';

import { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  IconButton,
  Tooltip,
  LinearProgress,
  Grid,
  Card,
  CardContent,
  Button,
  Tab,
  Tabs,
  Badge,
  Divider,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Add as AddIcon,
  CalendarMonth as CalendarIcon,
  AccountTree as FlowIcon,
  Token as TokenIcon,
  Assignment as TaskIcon,
  Schedule as ScheduleIcon,
  Warning as WarningIcon,
  CheckCircle as CheckIcon,
  PauseCircle as PauseIcon,
  PlayCircle as PlayIcon,
} from '@mui/icons-material';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useProjects, useProjectStats, useAgentWorkload, useBlockedTasks } from '@/hooks/useProjects';
import type { Project, ProjectStatus, ProjectPriority } from '@/lib/api';
import Link from 'next/link';

// Priority colors
const PRIORITY_COLORS: Record<ProjectPriority, string> = {
  critical: '#B60205',
  high: '#D93F0B',
  medium: '#FBCA04',
  low: '#0E8A16',
};

// Status colors
const STATUS_COLORS: Record<ProjectStatus, string> = {
  planning: '#6c757d',
  active: '#28a745',
  paused: '#ffc107',
  completed: '#17a2b8',
  cancelled: '#dc3545',
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

function StatusIcon({ status }: { status: ProjectStatus }) {
  switch (status) {
    case 'active':
      return <PlayIcon sx={{ color: STATUS_COLORS.active, fontSize: 20 }} />;
    case 'paused':
      return <PauseIcon sx={{ color: STATUS_COLORS.paused, fontSize: 20 }} />;
    case 'completed':
      return <CheckIcon sx={{ color: STATUS_COLORS.completed, fontSize: 20 }} />;
    default:
      return null;
  }
}

interface ProjectCardProps {
  project: Project;
}

function ProjectCard({ project }: ProjectCardProps) {
  const progressPercent = project.progress || 0;
  const tokenUsagePercent = project.tokenBudget > 0
    ? Math.round((project.tokensUsed / project.tokenBudget) * 100)
    : 0;

  return (
    <Card
      sx={{
        height: '100%',
        borderLeft: `4px solid ${PRIORITY_COLORS[project.priority]}`,
        '&:hover': {
          boxShadow: 4,
          transform: 'translateY(-2px)',
        },
        transition: 'all 0.2s ease',
      }}
    >
      <CardContent>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <StatusIcon status={project.status} />
          <Typography variant="h6" sx={{ flex: 1, fontWeight: 600 }}>
            {project.title}
          </Typography>
          <Chip
            label={project.owner.toUpperCase()}
            size="small"
            sx={{
              backgroundColor: AGENT_COLORS[project.owner.toLowerCase()] || '#888',
              color: '#000',
              fontWeight: 600,
            }}
          />
        </Box>

        {/* Description */}
        {project.description && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mb: 2,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {project.description}
          </Typography>
        )}

        {/* Progress */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              Progress
            </Typography>
            <Typography variant="caption" fontWeight={600}>
              {progressPercent}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progressPercent}
            sx={{
              height: 6,
              borderRadius: 3,
              backgroundColor: 'rgba(0,0,0,0.1)',
              '& .MuiLinearProgress-bar': {
                borderRadius: 3,
                backgroundColor: progressPercent >= 100 ? STATUS_COLORS.completed : STATUS_COLORS.active,
              },
            }}
          />
        </Box>

        {/* Stats Row */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Tooltip title="Tasks">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <TaskIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="caption">
                {project.completedTasks || 0}/{project.totalTasks || 0}
              </Typography>
            </Box>
          </Tooltip>

          <Tooltip title="Story Points">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" fontWeight={600}>SP</Typography>
              <Typography variant="caption">
                {project.completedStoryPoints || 0}/{project.totalStoryPoints || 0}
              </Typography>
            </Box>
          </Tooltip>

          <Tooltip title="Token Budget">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <TokenIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="caption">
                {tokenUsagePercent}%
              </Typography>
            </Box>
          </Tooltip>

          {(project.blockedTasks || 0) > 0 && (
            <Tooltip title="Blocked Tasks">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <WarningIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                <Typography variant="caption" color="warning.main">
                  {project.blockedTasks}
                </Typography>
              </Box>
            </Tooltip>
          )}

          {(project.upcomingEvents || 0) > 0 && (
            <Tooltip title="Upcoming Events">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <ScheduleIcon sx={{ fontSize: 16, color: 'info.main' }} />
                <Typography variant="caption" color="info.main">
                  {project.upcomingEvents}
                </Typography>
              </Box>
            </Tooltip>
          )}
        </Box>

        {/* Tags */}
        {project.tags && project.tags.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
            {project.tags.slice(0, 3).map(tag => (
              <Chip
                key={tag}
                label={tag}
                size="small"
                sx={{ height: 20, fontSize: '0.65rem' }}
              />
            ))}
            {project.tags.length > 3 && (
              <Chip
                label={`+${project.tags.length - 3}`}
                size="small"
                sx={{ height: 20, fontSize: '0.65rem' }}
              />
            )}
          </Box>
        )}

        {/* Status Badge */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Chip
            label={project.status}
            size="small"
            sx={{
              backgroundColor: STATUS_COLORS[project.status],
              color: project.status === 'paused' ? '#000' : '#fff',
              textTransform: 'capitalize',
            }}
          />
          <Chip
            label={project.priority}
            size="small"
            sx={{
              backgroundColor: PRIORITY_COLORS[project.priority],
              color: project.priority === 'medium' ? '#000' : '#fff',
              textTransform: 'capitalize',
            }}
          />
        </Box>
      </CardContent>
    </Card>
  );
}

function StatsCard({ title, value, subtitle, icon, color }: {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
      <Box
        sx={{
          p: 1.5,
          borderRadius: 2,
          backgroundColor: `${color}20`,
          color: color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </Box>
      <Box>
        <Typography variant="h5" fontWeight={700}>
          {value}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

export default function ProjectsPage() {
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>('all');
  const { data: projects, isLoading, error, mutate } = useProjects();
  const { data: stats } = useProjectStats();
  const { data: workload } = useAgentWorkload();
  const { data: blockedTasks } = useBlockedTasks();

  // Filter projects by status
  const filteredProjects = projects?.filter(p =>
    statusFilter === 'all' ? true : p.status === statusFilter
  ) || [];

  // Group by status for tabs
  const countByStatus = projects?.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  return (
    <DashboardLayout>
      <Box sx={{ p: 2 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Box>
            <Typography variant="h5" fontWeight={600}>
              Project Portfolio
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Multi-project management with complexity-based planning
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tooltip title="Flow View">
              <IconButton component={Link} href="/projects/flow">
                <FlowIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Calendar">
              <IconButton component={Link} href="/projects/calendar">
                <CalendarIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Refresh">
              <IconButton onClick={() => mutate()} disabled={isLoading}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              size="small"
              disabled
            >
              New Project
            </Button>
          </Box>
        </Box>

        {/* Stats Overview */}
        {stats && (
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <StatsCard
                title="Active Projects"
                value={stats.activeProjects}
                subtitle={`${stats.totalProjects} total`}
                icon={<PlayIcon />}
                color="#28a745"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <StatsCard
                title="Tasks Completed"
                value={`${stats.completedTasks}/${stats.totalTasks}`}
                subtitle={`${Math.round((stats.completedTasks / (stats.totalTasks || 1)) * 100)}%`}
                icon={<TaskIcon />}
                color="#17a2b8"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <StatsCard
                title="Story Points Done"
                value={`${stats.completedStoryPoints}/${stats.totalStoryPoints}`}
                icon={<Typography sx={{ fontWeight: 700 }}>SP</Typography>}
                color="#6f42c1"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <StatsCard
                title="Token Budget"
                value={`${Math.round((stats.tokensUsed / (stats.totalTokenBudget || 1)) * 100)}%`}
                subtitle={`${(stats.tokensUsed / 1000).toFixed(0)}K / ${(stats.totalTokenBudget / 1000).toFixed(0)}K`}
                icon={<TokenIcon />}
                color="#fd7e14"
              />
            </Grid>
          </Grid>
        )}

        {/* Blocked Tasks Warning */}
        {blockedTasks && blockedTasks.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2">
              {blockedTasks.length} task(s) are blocked waiting on dependencies
            </Typography>
          </Alert>
        )}

        {/* Error State */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Failed to load projects: {error.message}
          </Alert>
        )}

        {/* Status Filter Tabs */}
        <Paper sx={{ mb: 2 }}>
          <Tabs
            value={statusFilter}
            onChange={(_, value) => setStatusFilter(value)}
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab
              label={
                <Badge badgeContent={projects?.length || 0} color="primary">
                  All
                </Badge>
              }
              value="all"
            />
            <Tab
              label={
                <Badge badgeContent={countByStatus['active'] || 0} color="success">
                  Active
                </Badge>
              }
              value="active"
            />
            <Tab
              label={
                <Badge badgeContent={countByStatus['planning'] || 0} color="default">
                  Planning
                </Badge>
              }
              value="planning"
            />
            <Tab
              label={
                <Badge badgeContent={countByStatus['paused'] || 0} color="warning">
                  Paused
                </Badge>
              }
              value="paused"
            />
            <Tab
              label={
                <Badge badgeContent={countByStatus['completed'] || 0} color="info">
                  Completed
                </Badge>
              }
              value="completed"
            />
          </Tabs>
        </Paper>

        {/* Loading State */}
        {isLoading && !projects && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Projects Grid */}
        {filteredProjects.length > 0 ? (
          <Grid container spacing={2}>
            {filteredProjects.map(project => (
              <Grid item xs={12} sm={6} md={4} key={project.id}>
                <ProjectCard project={project} />
              </Grid>
            ))}
          </Grid>
        ) : !isLoading && (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">
              No projects found{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}
            </Typography>
          </Paper>
        )}

        {/* Agent Workload */}
        {workload && workload.length > 0 && (
          <Box sx={{ mt: 4 }}>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              Agent Workload
            </Typography>
            <Grid container spacing={2}>
              {workload.map(w => (
                <Grid item xs={12} sm={6} md={4} key={w.agent}>
                  <Paper sx={{ p: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Chip
                        label={w.agent.toUpperCase()}
                        size="small"
                        sx={{
                          backgroundColor: AGENT_COLORS[w.agent.toLowerCase()] || '#888',
                          color: '#000',
                          fontWeight: 600,
                        }}
                      />
                      <Typography variant="body2" fontWeight={600}>
                        {w.totalTasks} tasks
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      <Typography variant="caption" color="text.secondary">
                        In Progress: {w.inProgress}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Pending: {w.pending}
                      </Typography>
                      {w.blocked > 0 && (
                        <Typography variant="caption" color="warning.main">
                          Blocked: {w.blocked}
                        </Typography>
                      )}
                    </Box>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}
      </Box>
    </DashboardLayout>
  );
}
