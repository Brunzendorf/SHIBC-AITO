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
} from '@mui/material';
import { usePendingEscalations } from '@/hooks/useDecisions';
import { respondToEscalation, Escalation } from '@/lib/api';
import { formatDistanceToNow, formatDate } from '@/lib/utils';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';
import EmptyState from '@/components/common/EmptyState';
import { Warning as EscalationIcon } from '@mui/icons-material';

const statusColors: Record<string, string> = {
  pending: '#ffa502',
  resolved: '#00ff88',
};

export default function EscalationsPage() {
  const { data: escalations, error, isLoading, mutate } = usePendingEscalations();
  const [selectedEscalation, setSelectedEscalation] = useState<Escalation | null>(null);
  const [response, setResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleRespond = async () => {
    if (!selectedEscalation || !response.trim()) return;

    setSubmitting(true);
    try {
      await respondToEscalation(selectedEscalation.id, response);
      mutate();
      setSelectedEscalation(null);
      setResponse('');
    } catch (err) {
      console.error('Failed to respond:', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) return <Loading message="Loading escalations..." />;
  if (error) return <ErrorDisplay error={error} onRetry={() => mutate()} />;

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Escalations
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        Issues requiring human intervention
      </Typography>

      {!escalations?.length ? (
        <EmptyState
          title="No pending escalations"
          description="No issues require human intervention at this time."
          icon={<EscalationIcon sx={{ fontSize: 64 }} />}
        />
      ) : (
        <Card>
          <CardContent>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Reason</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Channels Notified</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell>Actions</TableCell>
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
                        {escalation.channelsNotified?.join(', ') || 'None'}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {formatDistanceToNow(escalation.createdAt)}
                      </TableCell>
                      <TableCell>
                        {escalation.status === 'pending' && (
                          <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            onClick={() => setSelectedEscalation(escalation)}
                          >
                            Respond
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {/* Response Dialog */}
      <Dialog
        open={!!selectedEscalation}
        onClose={() => setSelectedEscalation(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Respond to Escalation</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {selectedEscalation?.reason}
          </Typography>
          <TextField
            autoFocus
            multiline
            rows={4}
            fullWidth
            label="Your Response"
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Enter your decision or instructions..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedEscalation(null)}>Cancel</Button>
          <Button
            onClick={handleRespond}
            variant="contained"
            disabled={!response.trim() || submitting}
          >
            {submitting ? 'Submitting...' : 'Submit Response'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
