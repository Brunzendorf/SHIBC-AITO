'use client';

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
  Paper,
} from '@mui/material';
import { usePendingDecisions } from '@/hooks/useDecisions';
import { formatDistanceToNow, formatDate } from '@/lib/utils';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';
import EmptyState from '@/components/common/EmptyState';
import { HowToVote as DecisionIcon } from '@mui/icons-material';

const statusColors: Record<string, string> = {
  pending: '#45b7d1',
  approved: '#00ff88',
  rejected: '#ff4757',
  vetoed: '#ffa502',
};

const voteColors: Record<string, string> = {
  approve: '#00ff88',
  reject: '#ff4757',
  abstain: '#666666',
};

export default function DecisionsPage() {
  const { data: decisions, error, isLoading, mutate } = usePendingDecisions();

  if (isLoading) return <Loading message="Loading decisions..." />;
  if (error) return <ErrorDisplay error={error} onRetry={() => mutate()} />;

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Pending Decisions
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        Decisions awaiting votes or human intervention
      </Typography>

      {!decisions?.length ? (
        <EmptyState
          title="No pending decisions"
          description="All decisions have been resolved."
          icon={<DecisionIcon sx={{ fontSize: 64 }} />}
        />
      ) : (
        <Card>
          <CardContent>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Title</TableCell>
                    <TableCell>Proposed By</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Veto Round</TableCell>
                    <TableCell>CEO Vote</TableCell>
                    <TableCell>DAO Vote</TableCell>
                    <TableCell>Created</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {decisions.map((decision) => (
                    <TableRow key={decision.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {decision.title}
                        </Typography>
                        {decision.description && (
                          <Typography variant="caption" color="text.secondary">
                            {decision.description.slice(0, 100)}...
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{decision.proposedBy}</TableCell>
                      <TableCell>
                        <Chip
                          label={decision.status}
                          size="small"
                          sx={{
                            backgroundColor: `${statusColors[decision.status] || '#666'}20`,
                            color: statusColors[decision.status] || '#666',
                            fontWeight: 600,
                          }}
                        />
                      </TableCell>
                      <TableCell>{decision.vetoRound}</TableCell>
                      <TableCell>
                        {decision.ceoVote ? (
                          <Chip
                            label={decision.ceoVote}
                            size="small"
                            sx={{
                              backgroundColor: `${voteColors[decision.ceoVote] || '#666'}20`,
                              color: voteColors[decision.ceoVote] || '#666',
                            }}
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            Pending
                          </Typography>
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
                            }}
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            Pending
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {formatDistanceToNow(decision.createdAt)}
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
