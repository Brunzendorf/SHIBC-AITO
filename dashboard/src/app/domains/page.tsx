'use client';

import { useState, useMemo } from 'react';
import {
  Typography,
  Box,
  Card,
  CardContent,
  Chip,
  TextField,
  InputAdornment,
  IconButton,
  Tooltip,
  Stack,
  Paper,
  Avatar,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
  Security as SecurityIcon,
  Language as DomainIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Warning as WarningIcon,
  Schedule as PendingIcon,
  Check as CheckIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useDomainApprovals, usePendingDomainApprovals, useWhitelist, useWhitelistCategories } from '@/hooks/useDomains';
import { approveDomainRequest, rejectDomainRequest, addToWhitelist, removeFromWhitelist } from '@/lib/api';
import { formatDistanceToNow, formatDate } from '@/lib/utils';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';
import EmptyState from '@/components/common/EmptyState';
import type { DomainApprovalRequest, WhitelistDomain } from '@/lib/api';

// Agent colors for visual distinction
const agentColors: Record<string, string> = {
  ceo: '#ffd700',
  dao: '#9b59b6',
  cmo: '#e91e63',
  cto: '#2196f3',
  cfo: '#4caf50',
  coo: '#ff9800',
  cco: '#00bcd4',
};

const agentEmojis: Record<string, string> = {
  ceo: '👔',
  dao: '🏛️',
  cmo: '📣',
  cto: '💻',
  cfo: '💰',
  coo: '⚙️',
  cco: '📋',
};

// Category colors
const categoryColors: Record<string, string> = {
  crypto_data: '#ffd700',
  blockchain: '#9b59b6',
  news: '#e91e63',
  social: '#2196f3',
  development: '#4caf50',
  internal: '#ff9800',
  audit: '#00bcd4',
  documentation: '#8bc34a',
  api: '#ff5722',
  general: '#607d8b',
  auto_approved: '#9e9e9e',
};

function getSecurityColor(score: number): string {
  if (score >= 70) return '#4caf50';
  if (score >= 50) return '#ff9800';
  return '#f44336';
}

function getStatusColor(status: string): 'success' | 'error' | 'warning' | 'default' {
  switch (status) {
    case 'approved':
    case 'auto_approved':
      return 'success';
    case 'rejected':
      return 'error';
    case 'pending':
      return 'warning';
    default:
      return 'default';
  }
}

export default function DomainsPage() {
  const [tabIndex, setTabIndex] = useState(0);
  const [filter, setFilter] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<DomainApprovalRequest | null>(null);
  const [actionDialog, setActionDialog] = useState<'approve' | 'reject' | null>(null);
  const [actionNotes, setActionNotes] = useState('');
  const [actionCategory, setActionCategory] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [addDomainDialog, setAddDomainDialog] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [newCategory, setNewCategory] = useState('general');
  const [newDescription, setNewDescription] = useState('');

  // Fetch data
  const { approvals, error: approvalsError, isLoading: approvalsLoading, mutate: mutateApprovals } = useDomainApprovals();
  const { pendingApprovals, pendingCount, mutate: mutatePending } = usePendingDomainApprovals();
  const { whitelist, error: whitelistError, isLoading: whitelistLoading, mutate: mutateWhitelist } = useWhitelist();
  const { categories } = useWhitelistCategories();

  // Filter functions
  const filteredApprovals = useMemo(() => {
    if (!filter) return approvals;
    const search = filter.toLowerCase();
    return approvals.filter((req) =>
      req.domain.toLowerCase().includes(search) ||
      req.requestedBy.toLowerCase().includes(search) ||
      req.taskContext?.toLowerCase().includes(search) ||
      req.suggestedCategory?.toLowerCase().includes(search)
    );
  }, [approvals, filter]);

  const filteredWhitelist = useMemo(() => {
    if (!filter) return whitelist;
    const search = filter.toLowerCase();
    return whitelist.filter((domain) =>
      domain.domain.toLowerCase().includes(search) ||
      domain.category.toLowerCase().includes(search) ||
      domain.description?.toLowerCase().includes(search)
    );
  }, [whitelist, filter]);

  // Group whitelist by category
  const whitelistByCategory = useMemo(() => {
    const grouped: Record<string, WhitelistDomain[]> = {};
    for (const domain of filteredWhitelist) {
      if (!grouped[domain.category]) {
        grouped[domain.category] = [];
      }
      grouped[domain.category].push(domain);
    }
    return grouped;
  }, [filteredWhitelist]);

  // Action handlers
  const handleApprove = async () => {
    if (!selectedRequest) return;
    setActionLoading(true);
    try {
      await approveDomainRequest(selectedRequest.id, 'human', actionNotes, actionCategory || selectedRequest.suggestedCategory);
      mutateApprovals();
      mutatePending();
      mutateWhitelist();
      setActionDialog(null);
      setSelectedRequest(null);
      setActionNotes('');
      setActionCategory('');
    } catch (error) {
      console.error('Failed to approve:', error);
    }
    setActionLoading(false);
  };

  const handleReject = async () => {
    if (!selectedRequest) return;
    setActionLoading(true);
    try {
      await rejectDomainRequest(selectedRequest.id, 'human', actionNotes);
      mutateApprovals();
      mutatePending();
      setActionDialog(null);
      setSelectedRequest(null);
      setActionNotes('');
    } catch (error) {
      console.error('Failed to reject:', error);
    }
    setActionLoading(false);
  };

  const handleAddDomain = async () => {
    if (!newDomain) return;
    setActionLoading(true);
    try {
      await addToWhitelist(newDomain, newCategory, newDescription);
      mutateWhitelist();
      setAddDomainDialog(false);
      setNewDomain('');
      setNewCategory('general');
      setNewDescription('');
    } catch (error) {
      console.error('Failed to add domain:', error);
    }
    setActionLoading(false);
  };

  const handleRemoveDomain = async (domain: string) => {
    if (!confirm(`Domain "${domain}" wirklich entfernen?`)) return;
    try {
      await removeFromWhitelist(domain);
      mutateWhitelist();
    } catch (error) {
      console.error('Failed to remove domain:', error);
    }
  };

  const handleRefresh = () => {
    mutateApprovals();
    mutatePending();
    mutateWhitelist();
  };

  if (approvalsLoading || whitelistLoading) return <Loading message="Loading domain data..." />;
  if (approvalsError) return <ErrorDisplay error={approvalsError} onRetry={handleRefresh} />;
  if (whitelistError) return <ErrorDisplay error={whitelistError} onRetry={handleRefresh} />;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
            Domain Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Domain Whitelist und Approval Requests verwalten
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Aktualisieren">
            <IconButton onClick={handleRefresh}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Pending Alert */}
      {pendingCount > 0 && (
        <Alert
          severity="warning"
          icon={<WarningIcon />}
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => setTabIndex(0)}>
              Anzeigen
            </Button>
          }
        >
          {pendingCount} Domain-Approval-Request{pendingCount !== 1 ? 's' : ''} warten auf Genehmigung
        </Alert>
      )}

      {/* Stats Summary */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Card sx={{ minWidth: 120, bgcolor: 'rgba(255,152,0,0.1)' }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="caption" color="text.secondary">Pending</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#ff9800' }}>{pendingCount}</Typography>
          </CardContent>
        </Card>
        <Card sx={{ minWidth: 120, bgcolor: 'rgba(76, 175, 80, 0.1)' }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="caption" color="text.secondary">Whitelisted</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#4caf50' }}>{whitelist.length}</Typography>
          </CardContent>
        </Card>
        <Card sx={{ minWidth: 120, bgcolor: 'rgba(255,255,255,0.02)' }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="caption" color="text.secondary">Kategorien</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{categories.length}</Typography>
          </CardContent>
        </Card>
        <Card sx={{ minWidth: 120, bgcolor: 'rgba(255,255,255,0.02)' }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="caption" color="text.secondary">Total Requests</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{approvals.length}</Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Tabs */}
      <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} sx={{ mb: 2 }}>
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <PendingIcon />
              Approval Requests
              {pendingCount > 0 && (
                <Chip label={pendingCount} size="small" color="warning" sx={{ height: 20 }} />
              )}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <SecurityIcon />
              Whitelist ({whitelist.length})
            </Box>
          }
        />
      </Tabs>

      {/* Filter */}
      <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Filter nach Domain, Kategorie..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon color="action" />
              </InputAdornment>
            ),
          }}
          sx={{ width: 300 }}
        />
        {tabIndex === 1 && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setAddDomainDialog(true)}
            size="small"
          >
            Domain hinzufügen
          </Button>
        )}
      </Box>

      {/* Tab Content */}
      {tabIndex === 0 && (
        /* Approval Requests Tab */
        !filteredApprovals.length ? (
          <EmptyState
            title="Keine Approval Requests"
            description="Approval Requests erscheinen hier wenn Agents versuchen, nicht-gewhitelistete Domains abzurufen."
            icon={<DomainIcon sx={{ fontSize: 64 }} />}
          />
        ) : (
          <Stack spacing={1}>
            {filteredApprovals.map((req) => {
              const agentColor = agentColors[req.requestedBy] || '#666';
              const isPending = req.status === 'pending';

              return (
                <Card
                  key={req.id}
                  sx={{
                    backgroundColor: isPending
                      ? 'rgba(255, 152, 0, 0.08)'
                      : req.status === 'approved' || req.status === 'auto_approved'
                        ? 'rgba(76, 175, 80, 0.05)'
                        : 'rgba(244, 67, 54, 0.08)',
                    borderLeft: `4px solid ${isPending ? '#ff9800' : req.status === 'approved' || req.status === 'auto_approved' ? '#4caf50' : '#f44336'}`,
                  }}
                >
                  <CardContent sx={{ py: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
                      {/* Domain Info */}
                      <Box sx={{ flex: 1, minWidth: 200 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <DomainIcon sx={{ color: 'text.secondary' }} />
                          <Typography variant="h6" sx={{ fontWeight: 600 }}>
                            {req.domain}
                          </Typography>
                          <Chip
                            label={req.status}
                            size="small"
                            color={getStatusColor(req.status)}
                          />
                        </Box>

                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {req.url}
                        </Typography>

                        <Typography variant="body2" sx={{ mb: 1 }}>
                          <strong>Kontext:</strong> {req.taskContext?.slice(0, 150)}
                          {req.taskContext && req.taskContext.length > 150 && '...'}
                        </Typography>

                        {req.reviewNotes && (
                          <Typography variant="body2" color="text.secondary">
                            <strong>Notes:</strong> {req.reviewNotes}
                          </Typography>
                        )}
                      </Box>

                      {/* Meta Info */}
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 150 }}>
                        {/* Requested By */}
                        <Chip
                          avatar={
                            <Avatar sx={{ bgcolor: agentColor + '40', width: 24, height: 24, fontSize: '0.75rem' }}>
                              {agentEmojis[req.requestedBy] || '🤖'}
                            </Avatar>
                          }
                          label={req.requestedBy?.toUpperCase()}
                          size="small"
                          sx={{
                            fontWeight: 600,
                            bgcolor: agentColor + '20',
                            color: agentColor,
                          }}
                        />

                        {/* Category Suggestion */}
                        {req.suggestedCategory && (
                          <Chip
                            label={req.suggestedCategory}
                            size="small"
                            sx={{
                              bgcolor: (categoryColors[req.suggestedCategory] || '#666') + '20',
                              color: categoryColors[req.suggestedCategory] || '#666',
                            }}
                          />
                        )}

                        {/* Security Score */}
                        {req.securityScore !== undefined && req.securityScore !== null && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <SecurityIcon sx={{ fontSize: 16, color: getSecurityColor(req.securityScore) }} />
                            <Typography variant="caption" sx={{ color: getSecurityColor(req.securityScore) }}>
                              Score: {req.securityScore}/100
                            </Typography>
                          </Box>
                        )}

                        {/* Timestamp */}
                        <Tooltip title={formatDate(req.createdAt)}>
                          <Typography variant="caption" color="text.secondary">
                            {formatDistanceToNow(req.createdAt)}
                          </Typography>
                        </Tooltip>
                      </Box>

                      {/* Actions */}
                      {isPending && (
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Tooltip title="Genehmigen">
                            <IconButton
                              color="success"
                              onClick={() => {
                                setSelectedRequest(req);
                                setActionCategory(req.suggestedCategory || '');
                                setActionDialog('approve');
                              }}
                            >
                              <ApproveIcon />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Ablehnen">
                            <IconButton
                              color="error"
                              onClick={() => {
                                setSelectedRequest(req);
                                setActionDialog('reject');
                              }}
                            >
                              <RejectIcon />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        )
      )}

      {tabIndex === 1 && (
        /* Whitelist Tab */
        !filteredWhitelist.length ? (
          <EmptyState
            title="Keine Domains in der Whitelist"
            description="Füge Domains hinzu, die Workers abrufen dürfen."
            icon={<SecurityIcon sx={{ fontSize: 64 }} />}
          />
        ) : (
          <Stack spacing={3}>
            {Object.entries(whitelistByCategory).sort().map(([category, domains]) => (
              <Box key={category}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Chip
                    label={category}
                    size="small"
                    sx={{
                      bgcolor: (categoryColors[category] || '#666') + '30',
                      color: categoryColors[category] || '#666',
                      fontWeight: 600,
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {domains.length} Domain{domains.length !== 1 ? 's' : ''}
                  </Typography>
                </Box>

                <TableContainer component={Paper} sx={{ bgcolor: 'rgba(255,255,255,0.02)' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Domain</TableCell>
                        <TableCell>Beschreibung</TableCell>
                        <TableCell>Hinzugefügt von</TableCell>
                        <TableCell>Datum</TableCell>
                        <TableCell align="right">Aktionen</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {domains.map((domain) => (
                        <TableRow key={domain.id} hover>
                          <TableCell sx={{ fontWeight: 500 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <DomainIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                              {domain.domain}
                            </Box>
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary' }}>
                            {domain.description || '-'}
                          </TableCell>
                          <TableCell>
                            <Chip label={domain.addedBy} size="small" variant="outlined" />
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary' }}>
                            {formatDistanceToNow(domain.createdAt)}
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip title="Entfernen">
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => handleRemoveDomain(domain.domain)}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            ))}
          </Stack>
        )
      )}

      {/* Approve/Reject Dialog */}
      <Dialog open={!!actionDialog} onClose={() => setActionDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {actionDialog === 'approve' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ApproveIcon color="success" />
              Domain genehmigen
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <RejectIcon color="error" />
              Domain ablehnen
            </Box>
          )}
        </DialogTitle>
        <DialogContent>
          {selectedRequest && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {selectedRequest.domain}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Angefragt von: {selectedRequest.requestedBy?.toUpperCase()}
              </Typography>
            </Box>
          )}

          {actionDialog === 'approve' && (
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Kategorie</InputLabel>
              <Select
                value={actionCategory}
                label="Kategorie"
                onChange={(e) => setActionCategory(e.target.value)}
              >
                {[...categories, 'general', 'api', 'documentation'].filter((v, i, a) => a.indexOf(v) === i).map((cat) => (
                  <MenuItem key={cat} value={cat}>{cat}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <TextField
            fullWidth
            multiline
            rows={3}
            label="Notizen (optional)"
            value={actionNotes}
            onChange={(e) => setActionNotes(e.target.value)}
            placeholder={actionDialog === 'approve' ? 'Warum genehmigt?' : 'Warum abgelehnt?'}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setActionDialog(null)}>Abbrechen</Button>
          <Button
            variant="contained"
            color={actionDialog === 'approve' ? 'success' : 'error'}
            onClick={actionDialog === 'approve' ? handleApprove : handleReject}
            disabled={actionLoading}
            startIcon={actionDialog === 'approve' ? <CheckIcon /> : <CloseIcon />}
          >
            {actionLoading ? 'Wird verarbeitet...' : actionDialog === 'approve' ? 'Genehmigen' : 'Ablehnen'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Domain Dialog */}
      <Dialog open={addDomainDialog} onClose={() => setAddDomainDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AddIcon />
            Domain zur Whitelist hinzufügen
          </Box>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              fullWidth
              label="Domain"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="z.B. api.example.com"
              helperText="Ohne http:// oder https://"
            />

            <FormControl fullWidth>
              <InputLabel>Kategorie</InputLabel>
              <Select
                value={newCategory}
                label="Kategorie"
                onChange={(e) => setNewCategory(e.target.value)}
              >
                {[...categories, 'general', 'api', 'crypto_data', 'blockchain', 'news', 'social', 'development', 'documentation'].filter((v, i, a) => a.indexOf(v) === i).map((cat) => (
                  <MenuItem key={cat} value={cat}>{cat}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              fullWidth
              label="Beschreibung (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Was ist diese Domain?"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDomainDialog(false)}>Abbrechen</Button>
          <Button
            variant="contained"
            onClick={handleAddDomain}
            disabled={actionLoading || !newDomain}
            startIcon={<AddIcon />}
          >
            {actionLoading ? 'Wird hinzugefügt...' : 'Hinzufügen'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
