'use client';

import { Grid } from '@mui/material';
import AgentCard from './AgentCard';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';
import EmptyState from '@/components/common/EmptyState';
import { useAgents } from '@/hooks/useAgents';
import { startAgent, stopAgent, restartAgent } from '@/lib/api';
import { SmartToy as AgentIcon } from '@mui/icons-material';

export default function AgentGrid() {
  const { data: agents, error, isLoading, mutate } = useAgents();

  const handleStart = async (type: string) => {
    await startAgent(type);
    mutate();
  };

  const handleStop = async (type: string) => {
    await stopAgent(type);
    mutate();
  };

  const handleRestart = async (type: string) => {
    await restartAgent(type);
    mutate();
  };

  if (isLoading) return <Loading message="Loading agents..." />;
  if (error) return <ErrorDisplay error={error} onRetry={() => mutate()} />;
  if (!agents?.length) {
    return (
      <EmptyState
        title="No Agents"
        description="No agents have been registered yet."
        icon={<AgentIcon sx={{ fontSize: 64 }} />}
      />
    );
  }

  return (
    <Grid container spacing={3}>
      {agents.map((agent) => (
        <Grid item xs={12} sm={6} lg={4} key={agent.id}>
          <AgentCard
            agent={agent}
            onStart={() => handleStart(agent.type)}
            onStop={() => handleStop(agent.type)}
            onRestart={() => handleRestart(agent.type)}
          />
        </Grid>
      ))}
    </Grid>
  );
}
