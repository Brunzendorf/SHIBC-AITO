'use client';

import { Grid, Card, CardContent, Typography, Box, Skeleton } from '@mui/material';
import {
  SmartToy as AgentIcon,
  CheckCircle as HealthyIcon,
  HowToVote as DecisionIcon,
  Warning as EscalationIcon,
} from '@mui/icons-material';
import { useAgents } from '@/hooks/useAgents';
import { usePendingDecisions, usePendingEscalations } from '@/hooks/useDecisions';
import { agentColors, statusColors } from '@/theme/theme';

interface SummaryCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  loading?: boolean;
}

function SummaryCard({ title, value, icon, color, loading }: SummaryCardProps) {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="caption" color="text.secondary" gutterBottom>
              {title}
            </Typography>
            {loading ? (
              <Skeleton width={60} height={40} />
            ) : (
              <Typography variant="h4" sx={{ fontWeight: 700, color }}>
                {value}
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              p: 1,
              borderRadius: 2,
              backgroundColor: `${color}20`,
              color,
            }}
          >
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function SummaryCards() {
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: decisions, isLoading: decisionsLoading } = usePendingDecisions();
  const { data: escalations, isLoading: escalationsLoading } = usePendingEscalations();

  const totalAgents = agents?.length || 0;
  const healthyAgents = agents?.filter(
    (a) => a.status === 'active' || a.status === 'healthy'
  ).length || 0;
  const pendingDecisions = decisions?.length || 0;
  const pendingEscalations = escalations?.length || 0;

  return (
    <Grid container spacing={3}>
      <Grid item xs={6} md={3}>
        <SummaryCard
          title="Total Agents"
          value={totalAgents}
          icon={<AgentIcon />}
          color={agentColors.ceo}
          loading={agentsLoading}
        />
      </Grid>
      <Grid item xs={6} md={3}>
        <SummaryCard
          title="Healthy"
          value={healthyAgents}
          icon={<HealthyIcon />}
          color={statusColors.healthy}
          loading={agentsLoading}
        />
      </Grid>
      <Grid item xs={6} md={3}>
        <SummaryCard
          title="Pending Decisions"
          value={pendingDecisions}
          icon={<DecisionIcon />}
          color={statusColors.pending}
          loading={decisionsLoading}
        />
      </Grid>
      <Grid item xs={6} md={3}>
        <SummaryCard
          title="Escalations"
          value={pendingEscalations}
          icon={<EscalationIcon />}
          color={pendingEscalations > 0 ? statusColors.unhealthy : statusColors.inactive}
          loading={escalationsLoading}
        />
      </Grid>
    </Grid>
  );
}
