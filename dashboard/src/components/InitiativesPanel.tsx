'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  LinearProgress,
  Link,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  OpenInNew as OpenIcon,
  ExpandMore as ExpandIcon,
  Lightbulb as IdeaIcon,
  TrendingUp as RevenueIcon,
  Schedule as EffortIcon,
  Person as AssigneeIcon,
} from '@mui/icons-material';
import { getInitiatives, type Initiative } from '@/lib/api';

const PRIORITY_COLORS: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error',
  high: 'warning',
  medium: 'info',
  low: 'default',
};

const AGENT_COLORS: Record<string, string> = {
  ceo: '#FFD700',
  cmo: '#E74C3C',
  cto: '#3498DB',
  cfo: '#2ECC71',
  coo: '#F39C12',
  cco: '#1ABC9C',
  dao: '#9B59B6',
};

export default function InitiativesPanel() {
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInitiatives = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getInitiatives();
      if (response.data) {
        // API returns { success, data, timestamp } - extract the actual array
        const data = response.data as { data?: Initiative[] } | Initiative[];
        const initiativesList = Array.isArray(data) ? data : (data?.data || []);
        setInitiatives(Array.isArray(initiativesList) ? initiativesList : []);
      } else if (response.error) {
        setError(response.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load initiatives');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitiatives();
  }, [loadInitiatives]);

  if (loading) {
    return (
      <Paper sx={{ p: 3, textAlign: 'center' }}>
        <CircularProgress size={40} />
        <Typography sx={{ mt: 2 }}>Loading initiatives...</Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IdeaIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            Initiatives
          </Typography>
          <Chip
            label={initiatives.length}
            size="small"
            color="primary"
            variant="outlined"
          />
        </Box>
        <Tooltip title="Refresh">
          <IconButton onClick={loadInitiatives} size="small">
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Auto-generated initiatives by agents based on current focus settings.
      </Typography>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>
      )}

      <Divider sx={{ mb: 2 }} />

      {/* Initiatives List */}
      {initiatives.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <IdeaIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
          <Typography color="text.secondary">
            No initiatives yet. Agents will create them automatically.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {initiatives.map((initiative, index) => (
            <Accordion key={index} disableGutters>
              <AccordionSummary expandIcon={<ExpandIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, mr: 2 }}>
                  <Chip
                    label={initiative.priority}
                    size="small"
                    color={PRIORITY_COLORS[initiative.priority] || 'default'}
                    sx={{ minWidth: 70 }}
                  />
                  <Typography variant="subtitle2" sx={{ flex: 1 }}>
                    {initiative.title}
                  </Typography>
                  {initiative.issueUrl && (
                    <Tooltip title="Open GitHub Issue">
                      <IconButton
                        size="small"
                        component={Link}
                        href={initiative.issueUrl}
                        target="_blank"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <OpenIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Description */}
                  <Typography variant="body2" color="text.secondary">
                    {initiative.description}
                  </Typography>

                  {/* Metrics */}
                  <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {/* Revenue Impact */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <RevenueIcon fontSize="small" color="success" />
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Revenue Impact
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={initiative.revenueImpact * 10}
                          sx={{ width: 80, height: 6, borderRadius: 1 }}
                          color="success"
                        />
                      </Box>
                      <Typography variant="body2" fontWeight={600}>
                        {initiative.revenueImpact}/10
                      </Typography>
                    </Box>

                    {/* Effort */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <EffortIcon fontSize="small" color="warning" />
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Effort
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={initiative.effort * 10}
                          sx={{ width: 80, height: 6, borderRadius: 1 }}
                          color="warning"
                        />
                      </Box>
                      <Typography variant="body2" fontWeight={600}>
                        {initiative.effort}/10
                      </Typography>
                    </Box>

                    {/* Assignee */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <AssigneeIcon
                        fontSize="small"
                        sx={{ color: AGENT_COLORS[initiative.suggestedAssignee] || '#666' }}
                      />
                      <Typography variant="body2">
                        {initiative.suggestedAssignee.toUpperCase()}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Tags */}
                  {initiative.tags && initiative.tags.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {initiative.tags.map((tag, i) => (
                        <Chip key={i} label={tag} size="small" variant="outlined" />
                      ))}
                    </Box>
                  )}

                  {/* Timestamp */}
                  {initiative.createdAt && (
                    <Typography variant="caption" color="text.secondary">
                      Created: {new Date(initiative.createdAt).toLocaleString()}
                    </Typography>
                  )}
                </Box>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}
    </Paper>
  );
}
