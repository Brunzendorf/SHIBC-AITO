'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
} from '@mui/icons-material';
import { submitHumanDecision, type Decision } from '@/lib/api';

interface VotingDialogProps {
  decision: Decision | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const tierColors: Record<string, string> = {
  operational: '#00ff88',
  minor: '#ffd700',
  major: '#ff6b35',
  critical: '#ff0055',
};

export default function VotingDialog({ decision, open, onClose, onSuccess }: VotingDialogProps) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVote = async (vote: 'approve' | 'reject') => {
    if (!decision) return;

    setLoading(true);
    setError(null);

    try {
      const result = await submitHumanDecision(decision.id, vote, reason || undefined);

      if (result.error) {
        setError(result.error);
      } else {
        setReason('');
        onSuccess();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setReason('');
      setError(null);
      onClose();
    }
  };

  if (!decision) return null;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1a1a2e',
          border: '1px solid rgba(255,255,255,0.1)',
        }
      }}
    >
      <DialogTitle sx={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" component="span">
            Entscheidung
          </Typography>
          <Chip
            label={decision.decisionType}
            size="small"
            sx={{
              backgroundColor: `${tierColors[decision.decisionType] || '#666'}20`,
              color: tierColors[decision.decisionType] || '#666',
              fontWeight: 600,
            }}
          />
        </Box>
      </DialogTitle>

      <DialogContent sx={{ mt: 2 }}>
        <Typography variant="h6" gutterBottom>
          {decision.title}
        </Typography>

        {decision.description && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mb: 3,
              p: 2,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderRadius: 1,
              whiteSpace: 'pre-wrap',
            }}
          >
            {decision.description}
          </Typography>
        )}

        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Vorgeschlagen von: {decision.proposedBy?.substring(0, 8) || '—'}
          </Typography>
        </Box>

        {/* Votes from AI */}
        <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
          {decision.ceoVote && (
            <Chip
              label={`CEO: ${decision.ceoVote}`}
              size="small"
              sx={{
                backgroundColor: decision.ceoVote === 'approve' ? '#00ff8820' :
                               decision.ceoVote === 'veto' ? '#ff005520' : '#66666620',
                color: decision.ceoVote === 'approve' ? '#00ff88' :
                       decision.ceoVote === 'veto' ? '#ff0055' : '#666',
              }}
            />
          )}
          {decision.daoVote && (
            <Chip
              label={`DAO: ${decision.daoVote}`}
              size="small"
              sx={{
                backgroundColor: decision.daoVote === 'approve' ? '#00ff8820' :
                               decision.daoVote === 'veto' ? '#ff005520' : '#66666620',
                color: decision.daoVote === 'approve' ? '#00ff88' :
                       decision.daoVote === 'veto' ? '#ff0055' : '#666',
              }}
            />
          )}
        </Box>

        <TextField
          fullWidth
          multiline
          rows={3}
          label="Begründung (optional)"
          placeholder="Warum genehmigen/ablehnen Sie diese Entscheidung?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={loading}
          sx={{
            '& .MuiOutlinedInput-root': {
              '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
              '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.3)' },
            },
          }}
        />

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <Button
          onClick={handleClose}
          disabled={loading}
          sx={{ color: 'rgba(255,255,255,0.7)' }}
        >
          Abbrechen
        </Button>
        <Button
          variant="contained"
          color="error"
          startIcon={loading ? <CircularProgress size={16} /> : <RejectIcon />}
          onClick={() => handleVote('reject')}
          disabled={loading}
          sx={{
            backgroundColor: '#ff0055',
            '&:hover': { backgroundColor: '#cc0044' },
          }}
        >
          Ablehnen
        </Button>
        <Button
          variant="contained"
          color="success"
          startIcon={loading ? <CircularProgress size={16} /> : <ApproveIcon />}
          onClick={() => handleVote('approve')}
          disabled={loading}
          sx={{
            backgroundColor: '#00ff88',
            color: '#000',
            '&:hover': { backgroundColor: '#00cc6e' },
          }}
        >
          Genehmigen
        </Button>
      </DialogActions>
    </Dialog>
  );
}
