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
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Stack,
  Divider,
  Alert,
} from '@mui/material';
import { usePendingEscalations, useEscalatedDecisions } from '@/hooks/useDecisions';
import { respondToEscalation, submitHumanDecision, Escalation, Decision } from '@/lib/api';
import { formatDistanceToNow } from '@/lib/utils';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';
import EmptyState from '@/components/common/EmptyState';
import {
  Warning as EscalationIcon,
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
  Gavel as DecisionIcon,
} from '@mui/icons-material';

const tierColors: Record<string, string> = {
  operational: '#00ff88',
  minor: '#ffd700',
  major: '#ff6b35',
  critical: '#ff0055',
};

const statusColors: Record<string, string> = {
  pending: '#ffa502',
  escalated: '#ff0055',
  resolved: '#00ff88',
};

export default function EscalationsPage() {
  const { data: escalations, error: escError, isLoading: escLoading, mutate: mutateEsc } = usePendingEscalations();
  const { data: escalatedDecisions, error: decError, isLoading: decLoading, mutate: mutateDec } = useEscalatedDecisions();

  const [selectedEscalation, setSelectedEscalation] = useState<Escalation | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [response, setResponse] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleRespondEscalation = async () => {
    if (!selectedEscalation || !response.trim()) return;
    setSubmitting(true);
    try {
      await respondToEscalation(selectedEscalation.id, response);
      mutateEsc();
      setSelectedEscalation(null);
      setResponse('');
    } catch (err) {
      console.error('Failed to respond:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleHumanDecision = async (decision: 'approve' | 'reject') => {
    if (!selectedDecision) return;
    setSubmitting(true);
    try {
      await submitHumanDecision(selectedDecision.id, decision, reason || undefined);
      mutateDec();
      setSelectedDecision(null);
      setReason('');
    } catch (err) {
      console.error('Failed to submit decision:', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (escLoading || decLoading) return <Loading message="Lade Eskalationen..." />;
  if (escError) return <ErrorDisplay error={escError} onRetry={() => mutateEsc()} />;
  if (decError) return <ErrorDisplay error={decError} onRetry={() => mutateDec()} />;

  const hasEscalatedDecisions = escalatedDecisions && escalatedDecisions.length > 0;
  const hasEscalations = escalations && escalations.length > 0;

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Eskalationen
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        Entscheidungen und Probleme, die menschliche Bestätigung benötigen
      </Typography>

      {/* Critical Decisions Section */}
      {hasEscalatedDecisions && (
        <Box sx={{ mb: 4 }}>
          <Alert severity="warning" sx={{ mb: 2, backgroundColor: 'rgba(255, 0, 85, 0.1)', borderColor: '#ff0055' }}>
            <Typography variant="subtitle2">
              {escalatedDecisions.length} kritische Entscheidung(en) warten auf deine Bestätigung
            </Typography>
          </Alert>

          <Card sx={{ borderLeft: '4px solid #ff0055' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <DecisionIcon sx={{ color: '#ff0055' }} />
                Kritische Entscheidungen
              </Typography>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Entscheidung</TableCell>
                      <TableCell>Tier</TableCell>
                      <TableCell>CEO</TableCell>
                      <TableCell>DAO</TableCell>
                      <TableCell>Erstellt</TableCell>
                      <TableCell>Aktion</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {escalatedDecisions.map((decision) => (
                      <TableRow key={decision.id} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>
                            {decision.title}
                          </Typography>
                          {decision.description && (
                            <Typography variant="caption" color="text.secondary">
                              {decision.description.substring(0, 100)}...
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={decision.decisionType}
                            size="small"
                            sx={{
                              backgroundColor: `${tierColors[decision.decisionType] || '#666'}20`,
                              color: tierColors[decision.decisionType] || '#666',
                              fontWeight: 600,
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={decision.ceoVote || '—'}
                            size="small"
                            sx={{
                              backgroundColor: decision.ceoVote === 'approve' ? 'rgba(0, 255, 136, 0.2)' :
                                             decision.ceoVote === 'veto' ? 'rgba(255, 0, 85, 0.2)' : 'rgba(102, 102, 102, 0.2)',
                              color: decision.ceoVote === 'approve' ? '#00ff88' :
                                     decision.ceoVote === 'veto' ? '#ff0055' : '#666',
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={decision.daoVote || '—'}
                            size="small"
                            sx={{
                              backgroundColor: decision.daoVote === 'approve' ? 'rgba(0, 255, 136, 0.2)' :
                                             decision.daoVote === 'veto' ? 'rgba(255, 0, 85, 0.2)' : 'rgba(102, 102, 102, 0.2)',
                              color: decision.daoVote === 'approve' ? '#00ff88' :
                                     decision.daoVote === 'veto' ? '#ff0055' : '#666',
                            }}
                          />
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {formatDistanceToNow(decision.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1}>
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              startIcon={<ApproveIcon />}
                              onClick={() => setSelectedDecision(decision)}
                              sx={{ backgroundColor: '#00ff88', color: '#000', '&:hover': { backgroundColor: '#00cc6a' } }}
                            >
                              Approve
                            </Button>
                            <Button
                              size="small"
                              variant="contained"
                              color="error"
                              startIcon={<RejectIcon />}
                              onClick={() => setSelectedDecision(decision)}
                              sx={{ backgroundColor: '#ff0055', '&:hover': { backgroundColor: '#cc0044' } }}
                            >
                              Reject
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Box>
      )}

      {/* General Escalations Section */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <EscalationIcon sx={{ color: '#ffa502' }} />
            Allgemeine Eskalationen
          </Typography>

          {!hasEscalations && !hasEscalatedDecisions ? (
            <EmptyState
              title="Keine offenen Eskalationen"
              description="Aktuell gibt es keine Probleme, die menschliche Intervention benötigen."
              icon={<EscalationIcon sx={{ fontSize: 64 }} />}
            />
          ) : !hasEscalations ? (
            <Typography variant="body2" color="text.secondary">
              Keine allgemeinen Eskalationen vorhanden.
            </Typography>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Grund</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Kanäle</TableCell>
                    <TableCell>Erstellt</TableCell>
                    <TableCell>Aktion</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {escalations.map((escalation) => (
                    <TableRow key={escalation.id} hover>
                      <TableCell>
                        <Typography variant="body2">
                          {escalation.reason}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={escalation.status}
                          size="small"
                          sx={{
                            backgroundColor: `${statusColors[escalation.status] || '#666'}20`,
                            color: statusColors[escalation.status] || '#666',
                            fontWeight: 600,
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        {escalation.channelsNotified?.join(', ') || 'Keine'}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {formatDistanceToNow(escalation.createdAt)}
                      </TableCell>
                      <TableCell>
                        {escalation.status === 'pending' && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => setSelectedEscalation(escalation)}
                          >
                            Antworten
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Human Decision Dialog */}
      <Dialog
        open={!!selectedDecision}
        onClose={() => { setSelectedDecision(null); setReason(''); }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DecisionIcon sx={{ color: '#ff0055' }} />
          Entscheidung bestätigen
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              {selectedDecision?.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {selectedDecision?.description}
            </Typography>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              CEO Vote: <strong>{selectedDecision?.ceoVote || '—'}</strong> |
              DAO Vote: <strong>{selectedDecision?.daoVote || '—'}</strong>
            </Typography>
          </Box>

          <TextField
            multiline
            rows={3}
            fullWidth
            label="Begründung (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional: Erkläre deine Entscheidung..."
          />
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button onClick={() => { setSelectedDecision(null); setReason(''); }}>
            Abbrechen
          </Button>
          <Button
            onClick={() => handleHumanDecision('reject')}
            variant="contained"
            color="error"
            disabled={submitting}
            startIcon={<RejectIcon />}
            sx={{ backgroundColor: '#ff0055' }}
          >
            Ablehnen
          </Button>
          <Button
            onClick={() => handleHumanDecision('approve')}
            variant="contained"
            color="success"
            disabled={submitting}
            startIcon={<ApproveIcon />}
            sx={{ backgroundColor: '#00ff88', color: '#000' }}
          >
            Genehmigen
          </Button>
        </DialogActions>
      </Dialog>

      {/* General Escalation Response Dialog */}
      <Dialog
        open={!!selectedEscalation}
        onClose={() => setSelectedEscalation(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Auf Eskalation antworten</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {selectedEscalation?.reason}
          </Typography>
          <TextField
            autoFocus
            multiline
            rows={4}
            fullWidth
            label="Deine Antwort"
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Gib deine Entscheidung oder Anweisungen ein..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedEscalation(null)}>Abbrechen</Button>
          <Button
            onClick={handleRespondEscalation}
            variant="contained"
            disabled={!response.trim() || submitting}
          >
            {submitting ? 'Wird gesendet...' : 'Antwort senden'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
