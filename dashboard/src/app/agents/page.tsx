'use client';

import { Typography, Box } from '@mui/material';
import AgentGrid from '@/components/agents/AgentGrid';

export default function AgentsPage() {
  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Agents
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        Manage your AI agent team
      </Typography>

      <AgentGrid />
    </Box>
  );
}
