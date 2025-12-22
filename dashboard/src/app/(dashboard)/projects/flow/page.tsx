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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
  Badge,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  ArrowBack as BackIcon,
  ArrowForward as ArrowIcon,
  CheckCircle as CheckIcon,
  PlayArrow as InProgressIcon,
  Block as BlockedIcon,
  Schedule as TodoIcon,
  RateReview as ReviewIcon,
} from '@mui/icons-material';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useProjects, useProjectTasks } from '@/hooks/useProjects';
import type { ProjectTask, TaskStatus } from '@/lib/api';
import Link from 'next/link';

// Status config
const STATUS_CONFIG: Record<TaskStatus, { color: string; icon: React.ReactNode; label: string }> = {
  todo: { color: '#6c757d', icon: <TodoIcon />, label: 'To Do' },
  in_progress: { color: '#fd7e14', icon: <InProgressIcon />, label: 'In Progress' },
  review: { color: '#17a2b8', icon: <ReviewIcon />, label: 'Review' },
  done: { color: '#28a745', icon: <CheckIcon />, label: 'Done' },
  blocked: { color: '#dc3545', icon: <BlockedIcon />, label: 'Blocked' },
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

// Story point labels
const STORY_POINT_LABELS: Record<number, string> = {
  1: 'XS',
  2: 'S',
  3: 'M',
  5: 'L',
  8: 'XL',
};

interface TaskNodeProps {
  task: ProjectTask;
  allTasks: ProjectTask[];
  level: number;
}

function TaskNode({ task, allTasks, level }: TaskNodeProps) {
  const config = STATUS_CONFIG[task.status];
  const dependencyTasks = task.dependencies
    .map(depId => allTasks.find(t => t.id === depId))
    .filter(Boolean) as ProjectTask[];

  const blockedByIncomplete = dependencyTasks.filter(t => t.status !== 'done');

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        pl: level * 4,
        py: 1,
      }}
    >
      {/* Dependency arrow indicator */}
      {level > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', color: 'text.secondary' }}>
          <Box sx={{ width: 20, height: 2, bgcolor: 'divider', mr: 0.5 }} />
          <ArrowIcon sx={{ fontSize: 16 }} />
        </Box>
      )}

      {/* Task Card */}
      <Paper
        sx={{
          p: 1.5,
          flex: 1,
          maxWidth: 400,
          borderLeft: `4px solid ${config.color}`,
          opacity: task.status === 'done' ? 0.7 : 1,
          backgroundColor: task.status === 'blocked' ? 'rgba(220, 53, 69, 0.1)' : 'background.paper',
        }}
      >
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Box sx={{ color: config.color }}>{config.icon}</Box>
          <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
            {task.title}
          </Typography>
          {task.assignee && (
            <Chip
              label={task.assignee.toUpperCase()}
              size="small"
              sx={{
                height: 18,
                fontSize: '0.65rem',
                backgroundColor: AGENT_COLORS[task.assignee.toLowerCase()] || '#888',
                color: '#000',
              }}
            />
          )}
        </Box>

        {/* Info Row */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip
            label={config.label}
            size="small"
            sx={{
              height: 18,
              fontSize: '0.65rem',
              backgroundColor: config.color,
              color: '#fff',
            }}
          />
          <Chip
            label={STORY_POINT_LABELS[task.storyPoints] || `${task.storyPoints}SP`}
            size="small"
            sx={{ height: 18, fontSize: '0.65rem' }}
          />
          {blockedByIncomplete.length > 0 && (
            <Tooltip title={`Blocked by: ${blockedByIncomplete.map(t => t.title).join(', ')}`}>
              <Chip
                label={`Waiting on ${blockedByIncomplete.length}`}
                size="small"
                icon={<BlockedIcon sx={{ fontSize: 14 }} />}
                sx={{
                  height: 18,
                  fontSize: '0.65rem',
                  backgroundColor: '#dc3545',
                  color: '#fff',
                  '& .MuiChip-icon': { color: '#fff' },
                }}
              />
            </Tooltip>
          )}
          {task.canStart === false && task.status === 'todo' && (
            <Chip
              label="Cannot Start"
              size="small"
              sx={{
                height: 18,
                fontSize: '0.65rem',
                backgroundColor: '#ffc107',
                color: '#000',
              }}
            />
          )}
        </Box>

        {/* Dependencies */}
        {dependencyTasks.length > 0 && (
          <Box sx={{ mt: 1, pt: 1, borderTop: '1px dashed', borderColor: 'divider' }}>
            <Typography variant="caption" color="text.secondary">
              Depends on:
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
              {dependencyTasks.map(dep => (
                <Chip
                  key={dep.id}
                  label={dep.title.length > 20 ? `${dep.title.slice(0, 20)}...` : dep.title}
                  size="small"
                  sx={{
                    height: 16,
                    fontSize: '0.6rem',
                    backgroundColor: STATUS_CONFIG[dep.status].color,
                    color: '#fff',
                  }}
                />
              ))}
            </Box>
          </Box>
        )}
      </Paper>
    </Box>
  );
}

interface DependencyFlowProps {
  tasks: ProjectTask[];
}

function DependencyFlow({ tasks }: DependencyFlowProps) {
  // Build dependency graph
  const taskMap = useMemo(() => {
    return new Map(tasks.map(t => [t.id, t]));
  }, [tasks]);

  // Find root tasks (no dependencies) and build tree
  const rootTasks = useMemo(() => {
    return tasks.filter(t => t.dependencies.length === 0);
  }, [tasks]);

  // Get dependents for a task (tasks that depend on this one)
  const getDependents = (taskId: string): ProjectTask[] => {
    return tasks.filter(t => t.dependencies.includes(taskId));
  };

  // Render task and its dependents recursively
  const renderTaskTree = (task: ProjectTask, level: number, rendered: Set<string>): React.ReactNode => {
    if (rendered.has(task.id)) return null; // Prevent cycles
    rendered.add(task.id);

    const dependents = getDependents(task.id);

    return (
      <Box key={task.id}>
        <TaskNode task={task} allTasks={tasks} level={level} />
        {dependents.map(dep => renderTaskTree(dep, level + 1, rendered))}
      </Box>
    );
  };

  // Tasks without any dependencies or dependents (orphans)
  const orphanTasks = useMemo(() => {
    const hasRelations = new Set<string>();
    tasks.forEach(t => {
      if (t.dependencies.length > 0) {
        hasRelations.add(t.id);
        t.dependencies.forEach(d => hasRelations.add(d));
      }
      // Check if anyone depends on this task
      const dependents = getDependents(t.id);
      if (dependents.length > 0) {
        hasRelations.add(t.id);
      }
    });
    return tasks.filter(t => !hasRelations.has(t.id) && t.dependencies.length === 0);
  }, [tasks]);

  const rendered = new Set<string>();

  return (
    <Box>
      {/* Dependency Trees */}
      {rootTasks.map(root => renderTaskTree(root, 0, rendered))}

      {/* Orphan Tasks (no dependencies, no dependents) */}
      {orphanTasks.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Independent Tasks
          </Typography>
          {orphanTasks.map(task => (
            <TaskNode key={task.id} task={task} allTasks={tasks} level={0} />
          ))}
        </Box>
      )}
    </Box>
  );
}

export default function FlowPage() {
  const [selectedProject, setSelectedProject] = useState<string>('');
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { data: tasks, isLoading: tasksLoading, error, mutate } = useProjectTasks(selectedProject || null);

  // Get active projects for dropdown
  const activeProjects = projects?.filter(p => ['active', 'planning'].includes(p.status)) || [];

  // Auto-select first project if none selected
  if (!selectedProject && activeProjects.length > 0 && !projectsLoading) {
    setSelectedProject(activeProjects[0].id);
  }

  const selectedProjectData = projects?.find(p => p.id === selectedProject);

  // Calculate stats
  const stats = useMemo(() => {
    if (!tasks) return null;
    const byStatus = tasks.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const blocked = tasks.filter(t =>
      t.status === 'todo' &&
      t.dependencies.length > 0 &&
      t.dependencies.some(depId => {
        const dep = tasks.find(d => d.id === depId);
        return dep && dep.status !== 'done';
      })
    ).length;

    return {
      total: tasks.length,
      byStatus,
      blocked,
      withDeps: tasks.filter(t => t.dependencies.length > 0).length,
    };
  }, [tasks]);

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
                Dependency Flow
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Critical path and task dependencies visualization
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <FormControl size="small" sx={{ minWidth: 250 }}>
              <InputLabel>Project</InputLabel>
              <Select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                label="Project"
              >
                {activeProjects.map(p => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.title}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Tooltip title="Refresh">
              <IconButton onClick={() => mutate()} disabled={tasksLoading}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Project Info */}
        {selectedProjectData && (
          <Paper sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="h6">{selectedProjectData.title}</Typography>
              <Chip
                label={`${selectedProjectData.progress}% Complete`}
                size="small"
                color={selectedProjectData.progress >= 100 ? 'success' : 'primary'}
              />
              {stats && (
                <>
                  <Badge badgeContent={stats.total} color="primary">
                    <Chip label="Tasks" size="small" variant="outlined" />
                  </Badge>
                  <Badge badgeContent={stats.withDeps} color="info">
                    <Chip label="With Dependencies" size="small" variant="outlined" />
                  </Badge>
                  {stats.blocked > 0 && (
                    <Badge badgeContent={stats.blocked} color="error">
                      <Chip label="Blocked" size="small" variant="outlined" color="error" />
                    </Badge>
                  )}
                </>
              )}
            </Box>
          </Paper>
        )}

        {/* Status Legend */}
        <Paper sx={{ p: 1.5, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              Status:
            </Typography>
            {Object.entries(STATUS_CONFIG).map(([status, config]) => (
              <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ color: config.color, display: 'flex' }}>{config.icon}</Box>
                <Typography variant="caption">{config.label}</Typography>
                {stats && stats.byStatus[status] && (
                  <Typography variant="caption" color="text.secondary">
                    ({stats.byStatus[status]})
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </Paper>

        {/* Error State */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Failed to load tasks: {error.message}
          </Alert>
        )}

        {/* Loading State */}
        {(projectsLoading || tasksLoading) && !tasks && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {/* No Project Selected */}
        {!selectedProject && !projectsLoading && activeProjects.length === 0 && (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">
              No active projects found. Create a project first.
            </Typography>
          </Paper>
        )}

        {/* Dependency Flow */}
        {tasks && tasks.length > 0 && (
          <Paper sx={{ p: 2 }}>
            <DependencyFlow tasks={tasks} />
          </Paper>
        )}

        {/* No Tasks */}
        {tasks && tasks.length === 0 && (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">
              No tasks in this project yet.
            </Typography>
          </Paper>
        )}
      </Box>
    </DashboardLayout>
  );
}
