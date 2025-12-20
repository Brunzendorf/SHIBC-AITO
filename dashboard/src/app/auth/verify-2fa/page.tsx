'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { createClient } from '@/lib/supabase/client';

export default function Verify2FAPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);

  useEffect(() => {
    const getFactors = async () => {
      const supabase = createClient();
      const { data: factors } = await supabase.auth.mfa.listFactors();

      if (factors?.totp && factors.totp.length > 0) {
        setFactorId(factors.totp[0].id);
      }
    };

    getFactors();
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!factorId) {
      setError('No 2FA factor found');
      return;
    }

    setLoading(true);
    setError(null);

    const supabase = createClient();

    const { error: challengeError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });

    if (challengeError) {
      setError(challengeError.message);
      setLoading(false);
      return;
    }

    router.push('/');
    router.refresh();
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/auth/login');
  };

  return (
    <Card elevation={8}>
      <CardContent sx={{ p: 4 }}>
        <Typography variant="h5" component="h1" gutterBottom align="center">
          Two-Factor Authentication
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          align="center"
          sx={{ mb: 4 }}
        >
          Enter the 6-digit code from your authenticator app
        </Typography>

        <Box component="form" onSubmit={handleVerify}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <TextField
            fullWidth
            label="Verification Code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            margin="normal"
            required
            autoFocus
            inputProps={{
              maxLength: 6,
              inputMode: 'numeric',
              pattern: '[0-9]*',
              style: { textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5rem' },
            }}
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={loading || code.length !== 6}
            sx={{ mt: 3 }}
          >
            {loading ? <CircularProgress size={24} /> : 'Verify'}
          </Button>

          <Button
            fullWidth
            variant="text"
            onClick={handleLogout}
            sx={{ mt: 2 }}
          >
            Back to Login
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
