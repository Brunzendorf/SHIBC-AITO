'use client';

import { Card, CardContent, Typography, Box, Chip, Skeleton } from '@mui/material';
import {
  Storage as DbIcon,
  Memory as RedisIcon,
  Dns as DockerIcon,
  CheckCircle as HealthyIcon,
  Error as UnhealthyIcon,
} from '@mui/icons-material';
import { useHealth } from '@/hooks/useHealth';
import { statusColors } from '@/theme/theme';

interface ComponentStatusProps {
  name: string;
  icon: React.ReactNode;
  status: 'healthy' | 'unhealthy' | undefined;
  latency?: number;
}

function ComponentStatus({ name, icon, status, latency }: ComponentStatusProps) {
  const color = status === 'healthy' ? statusColors.healthy : statusColors.unhealthy;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        p: 1.5,
        borderRadius: 1,
        backgroundColor: 'rgba(255,255,255,0.05)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ color: 'text.secondary' }}>{icon}</Box>
        <Typography variant="body2">{name}</Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {latency !== undefined && (
          <Typography variant="caption" color="text.secondary">
            {latency}ms
          </Typography>
        )}
        {status === 'healthy' ? (
          <HealthyIcon sx={{ fontSize: 18, color }} />
        ) : (
          <UnhealthyIcon sx={{ fontSize: 18, color }} />
        )}
      </Box>
    </Box>
  );
}

export default function HealthWidget() {
  const { data: health, isLoading } = useHealth();

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6">System Health</Typography>
          {!isLoading && (
            <Chip
              label={health?.status === 'healthy' ? 'Healthy' : 'Issues'}
              size="small"
              sx={{
                backgroundColor: health?.status === 'healthy'
                  ? `${statusColors.healthy}20`
                  : `${statusColors.unhealthy}20`,
                color: health?.status === 'healthy' ? statusColors.healthy : statusColors.unhealthy,
                fontWeight: 600,
              }}
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {isLoading ? (
            <>
              <Skeleton variant="rounded" height={48} />
              <Skeleton variant="rounded" height={48} />
              <Skeleton variant="rounded" height={48} />
            </>
          ) : (
            <>
              <ComponentStatus
                name="Database"
                icon={<DbIcon />}
                status={health?.components?.database?.status}
                latency={health?.components?.database?.latencyMs}
              />
              <ComponentStatus
                name="Redis"
                icon={<RedisIcon />}
                status={health?.components?.redis?.status}
                latency={health?.components?.redis?.latencyMs}
              />
              <ComponentStatus
                name="Docker (Portainer)"
                icon={<DockerIcon />}
                status={health?.components?.docker?.status}
                latency={health?.components?.docker?.latencyMs}
              />
            </>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
