'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Slider,
  Button,
  Chip,
  Divider,
  Alert,
  CircularProgress,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  TrendingUp as RevenueIcon,
  Groups as CommunityIcon,
  Campaign as MarketingIcon,
  Code as DevIcon,
  Speed as SpeedIcon,
  Security as SecurityIcon,
  Refresh as RefreshIcon,
  Save as SaveIcon,
  AutoAwesome as AutoIcon,
} from '@mui/icons-material';
import { api } from '@/lib/api';

export interface FocusSettings {
  revenueFocus: number;       // 0-100: Revenue generation priority
  communityGrowth: number;    // 0-100: Community building priority
  marketingVsDev: number;     // 0=Dev, 100=Marketing
  riskTolerance: number;      // 0=Conservative, 100=Aggressive
  timeHorizon: number;        // 0=Short-term, 100=Long-term
  updatedAt?: string;
  updatedBy?: string;
}

const DEFAULT_SETTINGS: FocusSettings = {
  revenueFocus: 80,
  communityGrowth: 60,
  marketingVsDev: 50,
  riskTolerance: 40,
  timeHorizon: 30,
};

interface SliderConfig {
  key: keyof FocusSettings;
  label: string;
  leftLabel: string;
  rightLabel: string;
  leftIcon: React.ReactNode;
  rightIcon: React.ReactNode;
  description: string;
}

const SLIDERS: SliderConfig[] = [
  {
    key: 'revenueFocus',
    label: 'Revenue Focus',
    leftLabel: 'Growth First',
    rightLabel: 'Revenue First',
    leftIcon: <CommunityIcon />,
    rightIcon: <RevenueIcon />,
    description: 'How aggressively to pursue revenue-generating activities',
  },
  {
    key: 'communityGrowth',
    label: 'Community Priority',
    leftLabel: 'Product Focus',
    rightLabel: 'Community Focus',
    leftIcon: <DevIcon />,
    rightIcon: <CommunityIcon />,
    description: 'Balance between product development and community building',
  },
  {
    key: 'marketingVsDev',
    label: 'Marketing vs Development',
    leftLabel: 'Development',
    rightLabel: 'Marketing',
    leftIcon: <DevIcon />,
    rightIcon: <MarketingIcon />,
    description: 'Resource allocation between technical and marketing work',
  },
  {
    key: 'riskTolerance',
    label: 'Risk Tolerance',
    leftLabel: 'Conservative',
    rightLabel: 'Aggressive',
    leftIcon: <SecurityIcon />,
    rightIcon: <SpeedIcon />,
    description: 'Willingness to take risks for potential rewards',
  },
  {
    key: 'timeHorizon',
    label: 'Time Horizon',
    leftLabel: 'Quick Wins',
    rightLabel: 'Long-term',
    leftIcon: <SpeedIcon />,
    rightIcon: <AutoIcon />,
    description: 'Focus on immediate results vs strategic investments',
  },
];

export default function FocusPanel() {
  const [settings, setSettings] = useState<FocusSettings>(DEFAULT_SETTINGS);
  const [originalSettings, setOriginalSettings] = useState<FocusSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Load settings from API
  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<FocusSettings>('/focus');
      if (response.data) {
        // API returns { success, data, timestamp } - extract actual settings
        const rawData = response.data as { data?: FocusSettings } | FocusSettings;
        const settings = (rawData && 'revenueFocus' in rawData) ? rawData : (rawData?.data || DEFAULT_SETTINGS);
        setSettings(settings as FocusSettings);
        setOriginalSettings(settings as FocusSettings);
      }
    } catch (err) {
      console.error('Failed to load focus settings:', err);
      // Use defaults if API fails
      setSettings(DEFAULT_SETTINGS);
      setOriginalSettings(DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Check for changes
  useEffect(() => {
    const changed = SLIDERS.some(
      s => settings[s.key] !== originalSettings[s.key]
    );
    setHasChanges(changed);
  }, [settings, originalSettings]);

  // Handle slider change
  const handleSliderChange = (key: keyof FocusSettings) => (
    _event: Event,
    value: number | number[]
  ) => {
    setSettings(prev => ({
      ...prev,
      [key]: value as number,
    }));
  };

  // Save settings
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post('/focus', settings);
      setOriginalSettings(settings);
      setHasChanges(false);
    } catch (err) {
      console.error('Failed to save focus settings:', err);
      setError('Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Reset to original
  const handleReset = () => {
    setSettings(originalSettings);
  };

  // Get color based on value
  const getSliderColor = (value: number): 'primary' | 'secondary' | 'warning' => {
    if (value < 33) return 'primary';
    if (value < 66) return 'secondary';
    return 'warning';
  };

  if (loading) {
    return (
      <Paper sx={{ p: 3, textAlign: 'center' }}>
        <CircularProgress size={40} />
        <Typography sx={{ mt: 2 }}>Loading focus settings...</Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            Strategic Focus
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={loadSettings} size="small">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          {hasChanges && (
            <Chip
              label="Unsaved changes"
              color="warning"
              size="small"
              variant="outlined"
            />
          )}
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Adjust these sliders to guide agent priorities. Changes affect initiative generation and task prioritization.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Divider sx={{ mb: 3 }} />

      {/* Sliders */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {SLIDERS.map((slider) => (
          <Box key={slider.key}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Tooltip title={slider.description}>
                <Typography variant="subtitle2" sx={{ cursor: 'help' }}>
                  {slider.label}
                </Typography>
              </Tooltip>
              <Chip
                label={`${settings[slider.key]}%`}
                size="small"
                color={getSliderColor(settings[slider.key] as number)}
                variant="outlined"
              />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 100 }}>
                {slider.leftIcon}
                <Typography variant="caption" color="text.secondary">
                  {slider.leftLabel}
                </Typography>
              </Box>
              <Slider
                value={settings[slider.key] as number}
                onChange={handleSliderChange(slider.key)}
                min={0}
                max={100}
                step={5}
                color={getSliderColor(settings[slider.key] as number)}
                sx={{ flex: 1 }}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 100, justifyContent: 'flex-end' }}>
                <Typography variant="caption" color="text.secondary">
                  {slider.rightLabel}
                </Typography>
                {slider.rightIcon}
              </Box>
            </Box>
          </Box>
        ))}
      </Box>

      <Divider sx={{ my: 3 }} />

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button
          variant="outlined"
          onClick={handleReset}
          disabled={!hasChanges || saving}
        >
          Reset
        </Button>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
          onClick={handleSave}
          disabled={!hasChanges || saving}
        >
          {saving ? 'Saving...' : 'Save Focus'}
        </Button>
      </Box>

      {/* Last updated */}
      {settings.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          Last updated: {new Date(settings.updatedAt).toLocaleString()}
          {settings.updatedBy && ` by ${settings.updatedBy}`}
        </Typography>
      )}
    </Paper>
  );
}
