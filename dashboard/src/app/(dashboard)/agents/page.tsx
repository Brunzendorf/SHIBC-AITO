'use client';

import { Typography, Box, Divider } from '@mui/material';
import AgentGrid from '@/components/agents/AgentGrid';
import AgentStatusBoard from '@/components/agents/AgentStatusBoard';

export default function AgentsPage() {
  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Agents
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        Manage your AI agent team
      </Typography>

      {/* Live Status Board (TASK-108) */}
      <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
        Live Status
      </Typography>
      <AgentStatusBoard />

      <Divider sx={{ my: 4 }} />

      {/* Container Management */}
      <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
        Container Management
      </Typography>
      <AgentGrid />
    </Box>
  );
}
