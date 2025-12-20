'use client';

import { useState } from 'react';
import {
  Typography,
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Alert,
  Snackbar,
  Chip,
  Paper,
} from '@mui/material';
import {
  Send as SendIcon,
  Person as PersonIcon,
  History as HistoryIcon,
  Campaign as CampaignIcon,
} from '@mui/icons-material';
import { useAgents } from '@/hooks/useAgents';
import { sendMessageToAgent, broadcastMessage } from '@/lib/api';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';

type Priority = 'low' | 'normal' | 'high' | 'critical';

interface SentMessage {
  id: string;
  target: string;
  message: string;
  priority: Priority;
  timestamp: Date;
  success: boolean;
}

const priorityColors: Record<Priority, string> = {
  low: '#666',
  normal: '#00ff88',
  high: '#ffd700',
  critical: '#ff0055',
};

export default function MessagesPage() {
  const { data: agents, error, isLoading, mutate } = useAgents();
  const [selectedAgent, setSelectedAgent] = useState<string>('ceo');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [sending, setSending] = useState(false);
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([]);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const handleSendToAgent = async () => {
    if (!message.trim() || !selectedAgent) return;
    setSending(true);

    try {
      const result = await sendMessageToAgent(selectedAgent, message, priority);
      if (result.error) {
        throw new Error(result.error);
      }

      setSentMessages((prev) => [
        {
          id: result.data?.messageId || Date.now().toString(),
          target: selectedAgent.toUpperCase(),
          message,
          priority,
          timestamp: new Date(),
          success: true,
        },
        ...prev,
      ]);

      setSnackbar({
        open: true,
        message: `Nachricht an ${selectedAgent.toUpperCase()} gesendet!`,
        severity: 'success',
      });
      setMessage('');
    } catch (err) {
      setSnackbar({
        open: true,
        message: `Fehler: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`,
        severity: 'error',
      });
      setSentMessages((prev) => [
        {
          id: Date.now().toString(),
          target: selectedAgent.toUpperCase(),
          message,
          priority,
          timestamp: new Date(),
          success: false,
        },
        ...prev,
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleBroadcast = async () => {
    if (!message.trim()) return;
    setSending(true);

    try {
      const result = await broadcastMessage(message, priority);
      if (result.error) {
        throw new Error(result.error);
      }

      setSentMessages((prev) => [
        {
          id: result.data?.messageId || Date.now().toString(),
          target: 'ALLE AGENTS',
          message,
          priority,
          timestamp: new Date(),
          success: true,
        },
        ...prev,
      ]);

      setSnackbar({
        open: true,
        message: 'Broadcast an alle Agents gesendet!',
        severity: 'success',
      });
      setMessage('');
    } catch (err) {
      setSnackbar({
        open: true,
        message: `Fehler: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`,
        severity: 'error',
      });
    } finally {
      setSending(false);
    }
  };

  if (isLoading) return <Loading message="Lade Agents..." />;
  if (error) return <ErrorDisplay error={error} onRetry={() => mutate()} />;

  const agentTypes = ['ceo', 'cmo', 'cto', 'cfo', 'coo', 'cco', 'dao'];

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Agent Kommunikation
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        Sende Nachrichten direkt an Agents oder an alle gleichzeitig
      </Typography>

      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
        {/* Compose Message Card */}
        <Card sx={{ borderLeft: '4px solid #ffd700' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
              <SendIcon sx={{ color: '#ffd700' }} />
              Nachricht verfassen
            </Typography>

            <Stack spacing={3}>
              {/* Agent Selection */}
              <FormControl fullWidth>
                <InputLabel>Agent auswahlen</InputLabel>
                <Select
                  value={selectedAgent}
                  label="Agent auswahlen"
                  onChange={(e) => setSelectedAgent(e.target.value)}
                >
                  {agentTypes.map((type) => {
                    const agent = agents?.find((a) => a.type === type);
                    const isOnline = agent?.status === 'active';
                    return (
                      <MenuItem key={type} value={type}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                          <PersonIcon fontSize="small" />
                          <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>{type}</span>
                          <Chip
                            label={isOnline ? 'Online' : 'Offline'}
                            size="small"
                            sx={{
                              ml: 'auto',
                              backgroundColor: isOnline ? 'rgba(0, 255, 136, 0.2)' : 'rgba(102, 102, 102, 0.2)',
                              color: isOnline ? '#00ff88' : '#666',
                              height: 20,
                              fontSize: '0.7rem',
                            }}
                          />
                        </Box>
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>

              {/* Priority Selection */}
              <FormControl fullWidth>
                <InputLabel>Prioritat</InputLabel>
                <Select
                  value={priority}
                  label="Prioritat"
                  onChange={(e) => setPriority(e.target.value as Priority)}
                >
                  <MenuItem value="low">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: priorityColors.low }} />
                      Niedrig
                    </Box>
                  </MenuItem>
                  <MenuItem value="normal">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: priorityColors.normal }} />
                      Normal
                    </Box>
                  </MenuItem>
                  <MenuItem value="high">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: priorityColors.high }} />
                      Hoch
                    </Box>
                  </MenuItem>
                  <MenuItem value="critical">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: priorityColors.critical }} />
                      Kritisch
                    </Box>
                  </MenuItem>
                </Select>
              </FormControl>

              {/* Message Input */}
              <TextField
                multiline
                rows={4}
                fullWidth
                label="Nachricht"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Schreibe deine Nachricht an den Agent..."
              />

              {/* Action Buttons */}
              <Stack direction="row" spacing={2}>
                <Button
                  variant="contained"
                  startIcon={<SendIcon />}
                  onClick={handleSendToAgent}
                  disabled={!message.trim() || sending}
                  sx={{
                    flex: 1,
                    backgroundColor: '#ffd700',
                    color: '#000',
                    '&:hover': { backgroundColor: '#e6c200' },
                  }}
                >
                  {sending ? 'Wird gesendet...' : `An ${selectedAgent.toUpperCase()} senden`}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<CampaignIcon />}
                  onClick={handleBroadcast}
                  disabled={!message.trim() || sending}
                  sx={{
                    borderColor: '#ff6b35',
                    color: '#ff6b35',
                    '&:hover': { borderColor: '#ff8555', backgroundColor: 'rgba(255, 107, 53, 0.1)' },
                  }}
                >
                  Broadcast
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {/* Sent Messages History */}
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
              <HistoryIcon sx={{ color: '#00ff88' }} />
              Gesendete Nachrichten
            </Typography>

            {sentMessages.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  Noch keine Nachrichten gesendet.
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Gesendete Nachrichten werden hier angezeigt.
                </Typography>
              </Box>
            ) : (
              <Stack spacing={2} sx={{ maxHeight: 400, overflowY: 'auto' }}>
                {sentMessages.map((msg) => (
                  <Paper
                    key={msg.id}
                    sx={{
                      p: 2,
                      backgroundColor: msg.success ? 'rgba(0, 255, 136, 0.05)' : 'rgba(255, 0, 85, 0.05)',
                      borderLeft: `3px solid ${msg.success ? '#00ff88' : '#ff0055'}`,
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Chip
                        label={msg.target}
                        size="small"
                        sx={{
                          backgroundColor: 'rgba(255, 215, 0, 0.2)',
                          color: '#ffd700',
                          fontWeight: 600,
                        }}
                      />
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip
                          label={msg.priority}
                          size="small"
                          sx={{
                            backgroundColor: `${priorityColors[msg.priority]}20`,
                            color: priorityColors[msg.priority],
                            height: 20,
                            fontSize: '0.7rem',
                          }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {msg.timestamp.toLocaleTimeString()}
                        </Typography>
                      </Stack>
                    </Box>
                    <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                      {msg.message}
                    </Typography>
                    {!msg.success && (
                      <Alert severity="error" sx={{ mt: 1, py: 0 }}>
                        Senden fehlgeschlagen
                      </Alert>
                    )}
                  </Paper>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Box>

      {/* Quick Actions */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Schnellaktionen
          </Typography>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                setSelectedAgent('ceo');
                setMessage('Status Report bitte - was ist der aktuelle Stand aller Projekte?');
                setPriority('normal');
              }}
            >
              CEO Status anfordern
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                setSelectedAgent('cfo');
                setMessage('Treasury Update: Wie ist der aktuelle Stand der Finanzen?');
                setPriority('normal');
              }}
            >
              CFO Treasury Check
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                setMessage('HALT: Alle nicht-kritischen Operationen stoppen und auf weitere Anweisungen warten.');
                setPriority('critical');
              }}
            >
              Notfall Stopp (Broadcast)
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
