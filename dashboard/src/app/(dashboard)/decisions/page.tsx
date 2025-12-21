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
  Tabs,
  Tab,
  Tooltip,
  IconButton,
  Snackbar,
  Alert,
} from '@mui/material';
import {
  HowToVote as DecisionIcon,
  History as HistoryIcon,
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
} from '@mui/icons-material';
import { usePendingDecisions, useAllDecisions, useEscalatedDecisions } from '@/hooks/useDecisions';
import { useAgents } from '@/hooks/useAgents';
import { formatDistanceToNow } from '@/lib/utils';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';
import EmptyState from '@/components/common/EmptyState';
import VotingDialog from '@/components/decisions/VotingDialog';
import type { Decision } from '@/lib/api';

const statusColors: Record<string, string> = {
  pending: '#ffa502',
  approved: '#00ff88',
  rejected: '#ff0055',
  vetoed: '#ff6b35',
  escalated: '#ff0055',
};

const tierColors: Record<string, string> = {
  operational: '#00ff88',
  minor: '#ffd700',
  major: '#ff6b35',
  critical: '#ff0055',
};

const voteColors: Record<string, string> = {
  approve: '#00ff88',
  veto: '#ff0055',
  abstain: '#666666',
};

const statusLabels: Record<string, string> = {
  pending: 'Ausstehend',
  approved: 'Genehmigt',
  rejected: 'Abgelehnt',
  vetoed: 'Veto',
  escalated: 'Eskaliert',
};

export default function DecisionsPage() {
  const [tab, setTab] = useState(0);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const { data: pending, error: pendingError, isLoading: pendingLoading, mutate: mutatePending } = usePendingDecisions();
  const { data: escalated, error: escalatedError, isLoading: escalatedLoading, mutate: mutateEscalated } = useEscalatedDecisions();
  const { data: all, error: allError, isLoading: allLoading, mutate: mutateAll } = useAllDecisions(100);
  const { data: agents } = useAgents();

  // Map agent ID to name
  const getAgentName = (id?: string): string => {
    if (!id || !agents) return '—';
    const agent = agents.find(a => a.id === id);
    return agent ? agent.type.toUpperCase() : id.substring(0, 8);
  };

  // Tab 0: Escalated (requires human decision)
  // Tab 1: Pending (AI is voting)
  // Tab 2: History
  const tabConfig = [
    { label: 'Eskaliert', data: escalated, error: escalatedError, loading: escalatedLoading, mutate: mutateEscalated },
    { label: 'Ausstehend', data: pending, error: pendingError, loading: pendingLoading, mutate: mutatePending },
    { label: 'History', data: all, error: allError, loading: allLoading, mutate: mutateAll },
  ];

  const currentTab = tabConfig[tab];
  const decisions = currentTab.data;

  const handleVoteClick = (decision: Decision) => {
    setSelectedDecision(decision);
    setDialogOpen(true);
  };

  const handleVoteSuccess = () => {
    setSuccessMessage('Entscheidung erfolgreich abgestimmt!');
    // Refresh all lists
    mutatePending();
    mutateEscalated();
    mutateAll();
  };

  if (currentTab.loading) return <Loading message="Lade Entscheidungen..." />;
  if (currentTab.error) return <ErrorDisplay error={currentTab.error} onRetry={() => currentTab.mutate()} />;

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Entscheidungen
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Governance-Entscheidungen im System. Eskalierte Entscheidungen erfordern menschliche Intervention.
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 3, '& .MuiTab-root': { color: 'rgba(255,255,255,0.7)' }, '& .Mui-selected': { color: '#ffd700' } }}
      >
        <Tab
          icon={<DecisionIcon />}
          iconPosition="start"
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <span>Eskaliert</span>
              {(escalated?.length || 0) > 0 && (
                <Chip
                  label={escalated?.length}
                  size="small"
                  sx={{ backgroundColor: '#ff0055', color: '#fff', height: 20, fontSize: '0.7rem' }}
                />
              )}
            </Box>
          }
        />
        <Tab
          icon={<DecisionIcon />}
          iconPosition="start"
          label={`Ausstehend (${pending?.length || 0})`}
        />
        <Tab icon={<HistoryIcon />} iconPosition="start" label="History" />
      </Tabs>

      {/* Info banner for escalated tab */}
      {tab === 0 && (escalated?.length || 0) > 0 && (
        <Alert
          severity="warning"
          sx={{
            mb: 2,
            backgroundColor: 'rgba(255,165,2,0.1)',
            border: '1px solid rgba(255,165,2,0.3)',
          }}
        >
          Diese Entscheidungen erfordern Ihre Abstimmung. CEO und DAO konnten sich nicht einigen.
        </Alert>
      )}

      {!decisions?.length ? (
        <EmptyState
          title={
            tab === 0 ? "Keine eskalierten Entscheidungen" :
            tab === 1 ? "Keine ausstehenden Entscheidungen" :
            "Keine Entscheidungen"
          }
          description={
            tab === 0 ? "Keine Entscheidungen erfordern menschliche Intervention." :
            tab === 1 ? "Alle Entscheidungen wurden bearbeitet." :
            "Noch keine Entscheidungen im System."
          }
          icon={<DecisionIcon sx={{ fontSize: 64 }} />}
        />
      ) : (
        <Card>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Titel</TableCell>
                    <TableCell>Tier</TableCell>
                    <TableCell>Von</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>CEO</TableCell>
                    <TableCell>DAO</TableCell>
                    <TableCell>Erstellt</TableCell>
                    {tab === 0 && <TableCell align="center">Aktion</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {decisions.map((decision) => (
                    <TableRow
                      key={decision.id}
                      hover
                      sx={{
                        opacity: decision.status === 'pending' || decision.status === 'escalated' ? 1 : 0.7,
                        '&:hover': { opacity: 1 },
                        backgroundColor: decision.status === 'escalated' ? 'rgba(255,0,85,0.05)' : 'transparent',
                      }}
                    >
                      <TableCell sx={{ maxWidth: 300 }}>
                        <Tooltip title={decision.description || decision.title}>
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {decision.title}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={decision.decisionType}
                          size="small"
                          sx={{
                            backgroundColor: `${tierColors[decision.decisionType] || '#666'}20`,
                            color: tierColors[decision.decisionType] || '#666',
                            fontWeight: 600,
                            fontSize: '0.7rem',
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={getAgentName(decision.proposedBy)}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: '0.7rem' }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={statusLabels[decision.status] || decision.status}
                          size="small"
                          sx={{
                            backgroundColor: `${statusColors[decision.status] || '#666'}20`,
                            color: statusColors[decision.status] || '#666',
                            fontWeight: 600,
                            fontSize: '0.7rem',
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        {decision.ceoVote ? (
                          <Chip
                            label={decision.ceoVote}
                            size="small"
                            sx={{
                              backgroundColor: `${voteColors[decision.ceoVote] || '#666'}20`,
                              color: voteColors[decision.ceoVote] || '#666',
                              fontSize: '0.7rem',
                            }}
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {decision.daoVote ? (
                          <Chip
                            label={decision.daoVote}
                            size="small"
                            sx={{
                              backgroundColor: `${voteColors[decision.daoVote] || '#666'}20`,
                              color: voteColors[decision.daoVote] || '#666',
                              fontSize: '0.7rem',
                            }}
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Typography variant="caption">
                          {formatDistanceToNow(decision.createdAt)}
                        </Typography>
                      </TableCell>
                      {tab === 0 && (
                        <TableCell align="center">
                          <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                            <Tooltip title="Genehmigen">
                              <IconButton
                                size="small"
                                onClick={() => handleVoteClick(decision)}
                                sx={{
                                  color: '#00ff88',
                                  '&:hover': { backgroundColor: 'rgba(0,255,136,0.1)' },
                                }}
                              >
                                <ApproveIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Ablehnen">
                              <IconButton
                                size="small"
                                onClick={() => handleVoteClick(decision)}
                                sx={{
                                  color: '#ff0055',
                                  '&:hover': { backgroundColor: 'rgba(255,0,85,0.1)' },
                                }}
                              >
                                <RejectIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {/* Voting Dialog */}
      <VotingDialog
        decision={selectedDecision}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={handleVoteSuccess}
      />

      {/* Success Snackbar */}
      <Snackbar
        open={!!successMessage}
        autoHideDuration={4000}
        onClose={() => setSuccessMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
}
