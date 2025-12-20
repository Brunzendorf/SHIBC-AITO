'use client';

import { useState, useEffect } from 'react';
import {
  Typography,
  Box,
  Card,
  CardContent,
  CardHeader,
  TextField,
  Button,
  Stack,
  Tabs,
  Tab,
  Alert,
  Snackbar,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Divider,
  Chip,
  IconButton,
  Tooltip,
  Paper,
  Grid,
} from '@mui/material';
import {
  Save as SaveIcon,
  Refresh as RefreshIcon,
  Speed as SpeedIcon,
  Schedule as ScheduleIcon,
  Psychology as LLMIcon,
  Notifications as NotificationsIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import { useSettings, saveSetting } from '@/hooks/useSettings';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';

const categoryLabels: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  queue: {
    label: 'Queue Delays',
    icon: <SpeedIcon />,
    description: 'Configure priority-based delays for task processing',
  },
  agents: {
    label: 'Agent Intervals',
    icon: <ScheduleIcon />,
    description: 'Configure how often each agent runs its scheduled loop',
  },
  llm: {
    label: 'LLM Routing',
    icon: <LLMIcon />,
    description: 'Configure which AI models are used and how',
  },
  feedback: {
    label: 'Feedback & Notifications',
    icon: <NotificationsIcon />,
    description: 'Configure how agents communicate with each other',
  },
  initiative: {
    label: 'Initiative Settings',
    icon: <SettingsIcon />,
    description: 'Configure how agents generate their own work',
  },
};

const priorityOrder = ['critical', 'urgent', 'high', 'normal', 'low', 'operational'];
const agentOrder = ['ceo', 'dao', 'cmo', 'cto', 'cfo', 'coo', 'cco'];

function formatDelay(ms: number): string {
  if (ms === 0) return 'Immediate';
  if (ms < 60000) return `${ms / 1000}s`;
  return `${ms / 60000} min`;
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)}h`;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

export default function SettingsPage() {
  const { settings, isLoading, isError, refresh } = useSettings();
  const [activeTab, setActiveTab] = useState(0);
  const [editedSettings, setEditedSettings] = useState<Record<string, Record<string, unknown>>>({});
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Initialize edited settings from loaded settings
  useEffect(() => {
    if (settings) {
      const initial: Record<string, Record<string, unknown>> = {};
      for (const [category, group] of Object.entries(settings)) {
        initial[category] = {};
        for (const [key, settingValue] of Object.entries(group)) {
          initial[category][key] = settingValue.value;
        }
      }
      setEditedSettings(initial);
    }
  }, [settings]);

  const handleValueChange = (category: string, key: string, value: unknown) => {
    setEditedSettings(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [key]: value,
      },
    }));
  };

  const handleSave = async (category: string, key: string) => {
    setSaving(true);
    try {
      const value = editedSettings[category]?.[key];
      await saveSetting(category, key, value);
      setSnackbar({ open: true, message: `Saved ${key}`, severity: 'success' });
      refresh();
    } catch {
      setSnackbar({ open: true, message: `Failed to save ${key}`, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async (category: string) => {
    setSaving(true);
    try {
      const updates = editedSettings[category] || {};
      for (const [key, value] of Object.entries(updates)) {
        await saveSetting(category, key, value);
      }
      setSnackbar({ open: true, message: `Saved all ${category} settings`, severity: 'success' });
      refresh();
    } catch {
      setSnackbar({ open: true, message: `Failed to save settings`, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <Loading />;
  if (isError) return <ErrorDisplay error="Failed to load settings" />;
  if (!settings) return <ErrorDisplay error="No settings found" />;

  const categories = Object.keys(settings).filter(c => categoryLabels[c]);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          System Settings
        </Typography>
        <Tooltip title="Refresh">
          <IconButton onClick={refresh}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Alert severity="info" sx={{ mb: 3 }}>
        Changes are applied immediately and will affect all running agents. Some changes may require container restart to take effect.
      </Alert>

      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_, newValue) => setActiveTab(newValue)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {categories.map((category) => {
            const catInfo = categoryLabels[category];
            return (
              <Tab
                key={category}
                label={catInfo?.label || category}
                icon={catInfo?.icon as React.ReactElement}
                iconPosition="start"
              />
            );
          })}
        </Tabs>
      </Paper>

      {categories.map((category, index) => (
        <TabPanel key={category} value={activeTab} index={index}>
          <Card>
            <CardHeader
              title={categoryLabels[category]?.label || category}
              subheader={categoryLabels[category]?.description}
              action={
                <Button
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={() => handleSaveAll(category)}
                  disabled={saving}
                >
                  Save All
                </Button>
              }
            />
            <CardContent>
              {category === 'queue' && (
                <QueueSettings
                  settings={settings.queue}
                  edited={editedSettings.queue || {}}
                  onChange={(key, value) => handleValueChange('queue', key, value)}
                  onSave={(key) => handleSave('queue', key)}
                  saving={saving}
                />
              )}
              {category === 'agents' && (
                <AgentSettings
                  settings={settings.agents}
                  edited={editedSettings.agents || {}}
                  onChange={(key, value) => handleValueChange('agents', key, value)}
                  onSave={(key) => handleSave('agents', key)}
                  saving={saving}
                />
              )}
              {category === 'llm' && (
                <LLMSettings
                  settings={settings.llm}
                  edited={editedSettings.llm || {}}
                  onChange={(key, value) => handleValueChange('llm', key, value)}
                  onSave={(key) => handleSave('llm', key)}
                  saving={saving}
                />
              )}
              {category === 'feedback' && (
                <FeedbackSettings
                  settings={settings.feedback}
                  edited={editedSettings.feedback || {}}
                  onChange={(key, value) => handleValueChange('feedback', key, value)}
                  onSave={(key) => handleSave('feedback', key)}
                  saving={saving}
                />
              )}
              {category === 'initiative' && (
                <InitiativeSettings
                  settings={settings.initiative}
                  edited={editedSettings.initiative || {}}
                  onChange={(key, value) => handleValueChange('initiative', key, value)}
                  onSave={(key) => handleSave('initiative', key)}
                  saving={saving}
                />
              )}
            </CardContent>
          </Card>
        </TabPanel>
      ))}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

// Queue Delays Component
interface SettingsComponentProps {
  settings: Record<string, { value: unknown; description: string | null }>;
  edited: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onSave: (key: string) => void;
  saving: boolean;
}

function QueueSettings({ settings, edited, onChange, onSave, saving }: SettingsComponentProps) {
  const sortedKeys = Object.keys(settings || {})
    .filter(k => k.startsWith('delay_'))
    .sort((a, b) => {
      const pa = priorityOrder.indexOf(a.replace('delay_', ''));
      const pb = priorityOrder.indexOf(b.replace('delay_', ''));
      return pa - pb;
    });

  return (
    <Grid container spacing={3}>
      {sortedKeys.map((key) => {
        const priority = key.replace('delay_', '');
        const value = Number(edited[key] ?? settings[key]?.value ?? 0);
        return (
          <Grid item xs={12} sm={6} md={4} key={key}>
            <Card variant="outlined">
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                  <Chip
                    label={priority.toUpperCase()}
                    size="small"
                    color={priority === 'critical' ? 'error' : priority === 'urgent' ? 'warning' : 'default'}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {formatDelay(value)}
                  </Typography>
                </Stack>
                <TextField
                  fullWidth
                  label="Delay (ms)"
                  type="number"
                  value={value}
                  onChange={(e) => onChange(key, parseInt(e.target.value) || 0)}
                  size="small"
                  helperText={settings[key]?.description}
                />
                <Button
                  size="small"
                  onClick={() => onSave(key)}
                  disabled={saving}
                  sx={{ mt: 1 }}
                >
                  Save
                </Button>
              </CardContent>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
}

function AgentSettings({ settings, edited, onChange, onSave, saving }: SettingsComponentProps) {
  const sortedKeys = Object.keys(settings || {})
    .filter(k => k.startsWith('loop_interval_'))
    .sort((a, b) => {
      const aa = a.replace('loop_interval_', '');
      const ab = b.replace('loop_interval_', '');
      return agentOrder.indexOf(aa) - agentOrder.indexOf(ab);
    });

  return (
    <Grid container spacing={3}>
      {sortedKeys.map((key) => {
        const agent = key.replace('loop_interval_', '');
        const value = Number(edited[key] ?? settings[key]?.value ?? 3600);
        return (
          <Grid item xs={12} sm={6} md={4} key={key}>
            <Card variant="outlined">
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                  <Chip label={agent.toUpperCase()} size="small" color="primary" />
                  <Typography variant="caption" color="text.secondary">
                    {formatInterval(value)}
                  </Typography>
                </Stack>
                <TextField
                  fullWidth
                  label="Interval (seconds)"
                  type="number"
                  value={value}
                  onChange={(e) => onChange(key, parseInt(e.target.value) || 3600)}
                  size="small"
                  helperText={settings[key]?.description}
                />
                <Button
                  size="small"
                  onClick={() => onSave(key)}
                  disabled={saving}
                  sx={{ mt: 1 }}
                >
                  Save
                </Button>
              </CardContent>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
}

function LLMSettings({ settings, edited, onChange, onSave, saving }: SettingsComponentProps) {
  const routingStrategy = String(edited.routing_strategy ?? settings?.routing_strategy?.value ?? 'claude-only');
  const enableFallback = edited.enable_fallback ?? settings?.enable_fallback?.value ?? false;
  const preferGemini = edited.prefer_gemini ?? settings?.prefer_gemini?.value ?? false;
  const geminiModel = String(edited.gemini_default_model ?? settings?.gemini_default_model?.value ?? 'gemini-2.5-flash');

  return (
    <Stack spacing={3}>
      <FormControl fullWidth>
        <InputLabel>Routing Strategy</InputLabel>
        <Select
          value={routingStrategy}
          label="Routing Strategy"
          onChange={(e) => onChange('routing_strategy', e.target.value)}
        >
          <MenuItem value="claude-only">Claude Only</MenuItem>
          <MenuItem value="task-type">Task-Type Based</MenuItem>
          <MenuItem value="agent-role">Agent-Role Based</MenuItem>
          <MenuItem value="load-balance">Load Balance</MenuItem>
          <MenuItem value="gemini-prefer">Gemini Preferred</MenuItem>
        </Select>
        <Button size="small" onClick={() => onSave('routing_strategy')} disabled={saving} sx={{ mt: 1, alignSelf: 'flex-start' }}>
          Save
        </Button>
      </FormControl>

      <Divider />

      <FormControlLabel
        control={
          <Switch
            checked={Boolean(enableFallback)}
            onChange={(e) => {
              onChange('enable_fallback', e.target.checked);
              setTimeout(() => onSave('enable_fallback'), 100);
            }}
          />
        }
        label="Enable Fallback (use alternative LLM if primary fails)"
      />

      <FormControlLabel
        control={
          <Switch
            checked={Boolean(preferGemini)}
            onChange={(e) => {
              onChange('prefer_gemini', e.target.checked);
              setTimeout(() => onSave('prefer_gemini'), 100);
            }}
          />
        }
        label="Prefer Gemini (cost optimization)"
      />

      <Divider />

      <TextField
        fullWidth
        label="Gemini Default Model"
        value={geminiModel}
        onChange={(e) => onChange('gemini_default_model', e.target.value)}
        helperText={settings?.gemini_default_model?.description}
      />
      <Button size="small" onClick={() => onSave('gemini_default_model')} disabled={saving} sx={{ alignSelf: 'flex-start' }}>
        Save
      </Button>
    </Stack>
  );
}

function FeedbackSettings({ settings, edited, onChange, onSave, saving }: SettingsComponentProps) {
  const notifyCeo = edited.operational_notify_ceo ?? settings?.operational_notify_ceo?.value ?? true;
  const broadcastDecisions = edited.broadcast_decisions ?? settings?.broadcast_decisions?.value ?? true;
  const targetedFeedback = edited.targeted_feedback ?? settings?.targeted_feedback?.value ?? true;

  return (
    <Stack spacing={2}>
      <FormControlLabel
        control={
          <Switch
            checked={Boolean(notifyCeo)}
            onChange={(e) => {
              onChange('operational_notify_ceo', e.target.checked);
              setTimeout(() => onSave('operational_notify_ceo'), 100);
            }}
          />
        }
        label="Notify CEO on operational task completion"
      />

      <FormControlLabel
        control={
          <Switch
            checked={Boolean(broadcastDecisions)}
            onChange={(e) => {
              onChange('broadcast_decisions', e.target.checked);
              setTimeout(() => onSave('broadcast_decisions'), 100);
            }}
          />
        }
        label="Broadcast decision results to all agents"
      />

      <FormControlLabel
        control={
          <Switch
            checked={Boolean(targetedFeedback)}
            onChange={(e) => {
              onChange('targeted_feedback', e.target.checked);
              setTimeout(() => onSave('targeted_feedback'), 100);
            }}
          />
        }
        label="Use targeted feedback instead of broadcast (reduces API calls)"
      />
    </Stack>
  );
}

function InitiativeSettings({ settings, edited, onChange, onSave, saving }: SettingsComponentProps) {
  const cooldownHours = Number(edited.cooldown_hours ?? settings?.cooldown_hours?.value ?? 4);
  const maxPerDay = Number(edited.max_per_day ?? settings?.max_per_day?.value ?? 3);
  const onlyOnScheduled = edited.only_on_scheduled ?? settings?.only_on_scheduled?.value ?? true;

  return (
    <Stack spacing={3}>
      <TextField
        label="Cooldown Hours"
        type="number"
        value={cooldownHours}
        onChange={(e) => onChange('cooldown_hours', parseInt(e.target.value) || 4)}
        helperText="Hours between initiative generation per agent"
      />
      <Button size="small" onClick={() => onSave('cooldown_hours')} disabled={saving} sx={{ alignSelf: 'flex-start' }}>
        Save
      </Button>

      <TextField
        label="Max Initiatives Per Day"
        type="number"
        value={maxPerDay}
        onChange={(e) => onChange('max_per_day', parseInt(e.target.value) || 3)}
        helperText="Maximum initiatives per agent per day"
      />
      <Button size="small" onClick={() => onSave('max_per_day')} disabled={saving} sx={{ alignSelf: 'flex-start' }}>
        Save
      </Button>

      <FormControlLabel
        control={
          <Switch
            checked={Boolean(onlyOnScheduled)}
            onChange={(e) => {
              onChange('only_on_scheduled', e.target.checked);
              setTimeout(() => onSave('only_on_scheduled'), 100);
            }}
          />
        }
        label="Only generate initiatives during scheduled loops (not after task completion)"
      />
    </Stack>
  );
}
