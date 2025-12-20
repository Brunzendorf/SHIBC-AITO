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
} from '@mui/material';
import { usePendingDecisions, useAllDecisions } from '@/hooks/useDecisions';
import { useAgents } from '@/hooks/useAgents';
import { formatDistanceToNow } from '@/lib/utils';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';
import EmptyState from '@/components/common/EmptyState';
import { HowToVote as DecisionIcon, History as HistoryIcon } from '@mui/icons-material';

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
  const { data: pending, error: pendingError, isLoading: pendingLoading, mutate: mutatePending } = usePendingDecisions();
  const { data: all, error: allError, isLoading: allLoading, mutate: mutateAll } = useAllDecisions(100);
  const { data: agents } = useAgents();

  // Map agent ID to name
  const getAgentName = (id?: string): string => {
    if (!id || !agents) return '—';
    const agent = agents.find(a => a.id === id);
    return agent ? agent.type.toUpperCase() : id.substring(0, 8);
  };

  const isLoading = tab === 0 ? pendingLoading : allLoading;
  const error = tab === 0 ? pendingError : allError;
  const mutate = tab === 0 ? mutatePending : mutateAll;
  const decisions = tab === 0 ? pending : all;

  if (isLoading) return <Loading message="Lade Entscheidungen..." />;
  if (error) return <ErrorDisplay error={error} onRetry={() => mutate()} />;

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Entscheidungen
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Alle Governance-Entscheidungen im System
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 3, '& .MuiTab-root': { color: 'rgba(255,255,255,0.7)' }, '& .Mui-selected': { color: '#ffd700' } }}
      >
        <Tab icon={<DecisionIcon />} iconPosition="start" label={`Ausstehend (${pending?.length || 0})`} />
        <Tab icon={<HistoryIcon />} iconPosition="start" label="History" />
      </Tabs>

      {!decisions?.length ? (
        <EmptyState
          title={tab === 0 ? "Keine ausstehenden Entscheidungen" : "Keine Entscheidungen"}
          description={tab === 0 ? "Alle Entscheidungen wurden bearbeitet." : "Noch keine Entscheidungen im System."}
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
