'use client';

import { useState, ReactNode } from 'react';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Badge,
  Chip,
  useTheme,
  useMediaQuery,
  Dialog,
  DialogTitle,
  DialogContent,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Divider,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  SmartToy as AgentIcon,
  HowToVote as DecisionIcon,
  Warning as EscalationIcon,
  History as EventIcon,
  Memory as WorkerIcon,
  Circle as StatusIcon,
  CheckCircle as HealthyIcon,
  Cancel as UnhealthyIcon,
  Close as CloseIcon,
  Chat as ChatIcon,
} from '@mui/icons-material';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePendingDecisions, usePendingEscalations } from '@/hooks/useDecisions';
import { useHealth } from '@/hooks/useHealth';

const DRAWER_WIDTH = 260;

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  badge?: number;
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [healthDialogOpen, setHealthDialogOpen] = useState(false);
  const pathname = usePathname();

  // Fetch counts for badges
  const { data: decisions } = usePendingDecisions();
  const { data: escalations } = usePendingEscalations();
  const { data: health } = useHealth();

  const pendingDecisionCount = decisions?.length || 0;
  const pendingEscalationCount = escalations?.length || 0;

  // Count healthy/unhealthy components (excluding agents which has different structure)
  const infraComponents = health?.components ?
    Object.entries(health.components).filter(([key]) => key !== 'agents') : [];
  const unhealthyInfra = infraComponents.filter(([, c]) =>
    typeof c === 'object' && 'status' in c && c.status !== 'healthy'
  );
  const agentsHealth = health?.components?.agents;
  const unhealthyAgentCount = agentsHealth?.unhealthy || 0;
  const allHealthy = health?.status === 'healthy' && unhealthyInfra.length === 0 && unhealthyAgentCount === 0;
  const totalIssues = unhealthyInfra.length + unhealthyAgentCount;

  const navItems: NavItem[] = [
    { label: 'Overview', href: '/', icon: <DashboardIcon /> },
    { label: 'Agents', href: '/agents', icon: <AgentIcon /> },
    { label: 'Messages', href: '/messages', icon: <ChatIcon /> },
    { label: 'Workers', href: '/workers', icon: <WorkerIcon /> },
    {
      label: 'Decisions',
      href: '/decisions',
      icon: <DecisionIcon />,
      badge: pendingDecisionCount,
    },
    {
      label: 'Escalations',
      href: '/escalations',
      icon: <EscalationIcon />,
      badge: pendingEscalationCount,
    },
    { label: 'Events', href: '/events', icon: <EventIcon /> },
  ];

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const drawer = (
    <Box>
      {/* Logo Section */}
      <Box sx={{ p: 2, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <Typography
          variant="h5"
          sx={{
            fontWeight: 700,
            background: 'linear-gradient(90deg, #ffd700 0%, #ffe54c 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          AITO
        </Typography>
        <Typography variant="caption" color="text.secondary">
          AI Team Orchestrator
        </Typography>
      </Box>

      {/* Navigation */}
      <List sx={{ pt: 2 }}>
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));

          return (
            <ListItem key={item.href} disablePadding>
              <ListItemButton
                component={Link}
                href={item.href}
                selected={isActive}
                onClick={() => isMobile && setMobileOpen(false)}
              >
                <ListItemIcon sx={{ color: isActive ? 'primary.main' : 'text.secondary' }}>
                  {item.badge ? (
                    <Badge badgeContent={item.badge} color="error">
                      {item.icon}
                    </Badge>
                  ) : (
                    item.icon
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'primary.main' : 'text.primary',
                  }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>

      {/* System Status - Clickable */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          p: 2,
          borderTop: '1px solid rgba(255,255,255,0.1)',
          cursor: 'pointer',
          '&:hover': {
            backgroundColor: 'rgba(255,255,255,0.05)',
          },
          transition: 'background-color 0.2s',
        }}
        onClick={() => setHealthDialogOpen(true)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <StatusIcon
            sx={{
              fontSize: 12,
              color: allHealthy ? 'success.main' : 'error.main',
            }}
          />
          <Typography variant="caption" color="text.secondary">
            System Status
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            Click for details
          </Typography>
        </Box>
        <Chip
          label={allHealthy ? 'All Systems Operational' : `${totalIssues} Issue${totalIssues !== 1 ? 's' : ''} Detected`}
          size="small"
          color={allHealthy ? 'success' : 'error'}
          sx={{ width: '100%' }}
        />
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* AppBar */}
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { md: `${DRAWER_WIDTH}px` },
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
            Dashboard
          </Typography>
          {/* Connection indicator */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <StatusIcon
              sx={{
                fontSize: 10,
                color: health ? 'success.main' : 'error.main',
                animation: health ? 'pulse 2s infinite' : 'none',
                '@keyframes pulse': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0.5 },
                },
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {health ? 'Connected' : 'Disconnected'}
            </Typography>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Sidebar Drawer */}
      <Box
        component="nav"
        sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}
      >
        {/* Mobile drawer */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: DRAWER_WIDTH,
            },
          }}
        >
          {drawer}
        </Drawer>

        {/* Desktop drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: DRAWER_WIDTH,
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          mt: '64px',
        }}
      >
        {children}
      </Box>

      {/* Health Details Dialog */}
      <Dialog
        open={healthDialogOpen}
        onClose={() => setHealthDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {allHealthy ? (
              <HealthyIcon color="success" />
            ) : (
              <UnhealthyIcon color="error" />
            )}
            System Health Details
          </Box>
          <IconButton onClick={() => setHealthDialogOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {/* Infrastructure Components */}
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            Infrastructure Components
          </Typography>
          <Table size="small" sx={{ mb: 3 }}>
            <TableBody>
              {infraComponents.map(([name, component]) => {
                const comp = component as { status: string; latencyMs?: number; message?: string };
                return (
                  <TableRow key={name}>
                    <TableCell sx={{ width: 40 }}>
                      {comp.status === 'healthy' ? (
                        <HealthyIcon color="success" fontSize="small" />
                      ) : (
                        <UnhealthyIcon color="error" fontSize="small" />
                      )}
                    </TableCell>
                    <TableCell sx={{ fontWeight: 500, textTransform: 'capitalize' }}>
                      {name}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={comp.status}
                        size="small"
                        color={comp.status === 'healthy' ? 'success' : 'error'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>
                      {comp.latencyMs !== undefined && `${comp.latencyMs}ms`}
                      {comp.message && comp.message}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <Divider sx={{ my: 2 }} />

          {/* Agent Status */}
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
            Agent Status ({agentsHealth?.healthy || 0}/{agentsHealth?.total || 0} healthy)
          </Typography>
          {agentsHealth?.details && Object.keys(agentsHealth.details).length > 0 ? (
            <Table size="small">
              <TableBody>
                {Object.entries(agentsHealth.details).map(([agentType, agent]) => (
                  <TableRow key={agent.agentId}>
                    <TableCell sx={{ width: 40 }}>
                      {agent.status === 'healthy' ? (
                        <HealthyIcon color="success" fontSize="small" />
                      ) : agent.status === 'unhealthy' ? (
                        <UnhealthyIcon color="error" fontSize="small" />
                      ) : (
                        <StatusIcon sx={{ fontSize: 20, color: 'warning.main' }} />
                      )}
                    </TableCell>
                    <TableCell sx={{ fontWeight: 500, textTransform: 'uppercase' }}>
                      {agentType}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={agent.containerStatus || agent.status}
                        size="small"
                        color={
                          agent.status === 'healthy' ? 'success' :
                          agent.status === 'unhealthy' ? 'error' : 'warning'
                        }
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>
                      {agent.memoryUsage !== undefined && `${(agent.memoryUsage / 1024 / 1024).toFixed(1)} MB`}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>
                      {agent.lastCheck && (
                        <>Last: {new Date(agent.lastCheck).toLocaleTimeString()}</>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No agent data available
            </Typography>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
