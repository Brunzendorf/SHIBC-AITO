'use client';

import { Typography, Box, Grid } from '@mui/material';
import SummaryCards from '@/components/widgets/SummaryCards';
import HealthWidget from '@/components/widgets/HealthWidget';
import AgentGrid from '@/components/agents/AgentGrid';
import RecentActivity from '@/components/widgets/RecentActivity';

export default function DashboardPage() {
  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Overview
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        Monitor your AI agent team in real-time
      </Typography>

      {/* Summary Cards */}
      <Box sx={{ mb: 4 }}>
        <SummaryCards />
      </Box>

      {/* Health + Activity Row */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} md={4}>
          <HealthWidget />
        </Grid>
        <Grid item xs={12} md={8}>
          <RecentActivity />
        </Grid>
      </Grid>

      {/* Agent Grid */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="h5" gutterBottom sx={{ fontWeight: 600 }}>
          Agents
        </Typography>
      </Box>
      <AgentGrid />
    </Box>
  );
}
