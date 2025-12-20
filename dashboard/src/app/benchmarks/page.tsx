'use client';

import { useState } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Paper,
  LinearProgress,
  Alert,
  IconButton,
  Tooltip,
  Collapse,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  PlayArrow as RunIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  Speed as SpeedIcon,
  Assessment as ScoreIcon,
} from '@mui/icons-material';
import { useLatestBenchmark, useBenchmarkRuns } from '@/hooks/useBenchmarks';
import { runBenchmark } from '@/lib/api';
import type { BenchmarkResult, ModelResponse, OpusEvaluation } from '@/lib/api';
import Loading from '@/components/common/Loading';
import ErrorDisplay from '@/components/common/ErrorDisplay';
import EmptyState from '@/components/common/EmptyState';

type SortBy = 'score' | 'speed' | 'model';
type GroupBy = 'task' | 'model';

export default function BenchmarksPage() {
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runSuccess, setRunSuccess] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortBy>('score');
  const [groupBy, setGroupBy] = useState<GroupBy>('task');
  const [enableTools, setEnableTools] = useState(true);

  const { data: latest, error: latestError, isLoading: latestLoading, mutate: mutateLatest } = useLatestBenchmark();
  const { data: runs, mutate: mutateRuns } = useBenchmarkRuns(10);

  const handleRunBenchmark = async () => {
    setIsRunning(true);
    setRunError(null);
    setRunSuccess(null);

    const result = await runBenchmark({ enableTools });

    if (result.error) {
      setRunError(result.error);
      setIsRunning(false);
      return;
    }

    setRunSuccess(`Benchmark started! (Tools: ${enableTools ? 'Enabled' : 'Disabled'}) This will take several minutes...`);
    setIsRunning(false);

    // Refresh after delay
    setTimeout(() => {
      mutateLatest();
      mutateRuns();
      setRunSuccess(null);
    }, 60000);
  };

  const handleRefresh = () => {
    mutateLatest();
    mutateRuns();
  };

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  // Format duration
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Get evaluation for a response
  const getEvaluation = (taskId: string, modelName: string): OpusEvaluation | undefined => {
    if (!latest) return undefined;
    return latest.evaluations.find(e => e.taskId === taskId && e.modelName === modelName);
  };

  // Group responses by task or model
  const getGroupedData = () => {
    if (!latest) return [];

    if (groupBy === 'task') {
      // Group by task
      return latest.tasks.map(task => {
        const taskResponses = latest.responses
          .filter(r => r.taskId === task.id)
          .map(response => {
            const evaluation = getEvaluation(task.id, response.modelName);
            return {
              ...response,
              evaluation,
              task,
            };
          });

        // Sort responses
        if (sortBy === 'score') {
          taskResponses.sort((a, b) => (b.evaluation?.overallScore || 0) - (a.evaluation?.overallScore || 0));
        } else if (sortBy === 'speed') {
          taskResponses.sort((a, b) => a.durationMs - b.durationMs);
        } else {
          taskResponses.sort((a, b) => a.modelName.localeCompare(b.modelName));
        }

        return {
          type: 'task' as const,
          task,
          responses: taskResponses,
        };
      });
    } else {
      // Group by model
      const modelNames = Array.from(new Set(latest.responses.map(r => r.modelName)));
      return modelNames.map(modelName => {
        const modelResponses = latest.responses
          .filter(r => r.modelName === modelName)
          .map(response => {
            const task = latest.tasks.find(t => t.id === response.taskId);
            const evaluation = getEvaluation(response.taskId, modelName);
            return {
              ...response,
              evaluation,
              task,
            };
          });

        // Sort responses
        if (sortBy === 'score') {
          modelResponses.sort((a, b) => (b.evaluation?.overallScore || 0) - (a.evaluation?.overallScore || 0));
        } else if (sortBy === 'speed') {
          modelResponses.sort((a, b) => a.durationMs - b.durationMs);
        }

        const avgScore = modelResponses.reduce((sum, r) => sum + (r.evaluation?.overallScore || 0), 0) / modelResponses.length;
        const avgSpeed = modelResponses.reduce((sum, r) => sum + r.durationMs, 0) / modelResponses.length;

        return {
          type: 'model' as const,
          modelName,
          avgScore,
          avgSpeed,
          responses: modelResponses,
        };
      });
    }
  };

  if (latestLoading) {
    return <Loading message="Loading benchmarks..." />;
  }

  if (latestError) {
    return <ErrorDisplay error={latestError} onRetry={handleRefresh} />;
  }

  if (!latest && !latestLoading) {
    return (
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Box>
            <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
              LLM Benchmarks
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Compare all models across different task types
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={enableTools}
                  onChange={(e) => setEnableTools(e.target.checked)}
                  color="primary"
                />
              }
              label={
                <Tooltip title="Enable LLM tools (Read, Write, Edit, Bash) for benchmark tasks. When disabled, LLMs provide text-only responses.">
                  <span>Enable Tools</span>
                </Tooltip>
              }
            />
            <Button
              variant="contained"
              startIcon={<RunIcon />}
              onClick={handleRunBenchmark}
              disabled={isRunning}
            >
              {isRunning ? 'Running...' : 'Run Benchmark'}
            </Button>
          </Box>
        </Box>
        <EmptyState
          title="No Benchmark Data"
          description="Run your first benchmark to compare LLM models"
          icon={<ScoreIcon sx={{ fontSize: 64 }} />}
        />
      </Box>
    );
  }

  const groupedData = getGroupedData();

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
            LLM Benchmarks
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Task + Response + Score + Speed Analysis
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh data">
            <IconButton onClick={handleRefresh} color="primary">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            startIcon={<RunIcon />}
            onClick={handleRunBenchmark}
            disabled={isRunning}
          >
            {isRunning ? 'Running...' : 'Run Benchmark'}
          </Button>
        </Box>
      </Box>

      {/* Status Messages */}
      {runSuccess && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setRunSuccess(null)}>
          {runSuccess}
        </Alert>
      )}
      {runError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setRunError(null)}>
          {runError}
        </Alert>
      )}
      {isRunning && <LinearProgress sx={{ mb: 2 }} />}

      {/* Controls */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <FormControl fullWidth>
            <InputLabel>Group By</InputLabel>
            <Select
              value={groupBy}
              label="Group By"
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            >
              <MenuItem value="task">By Task Type</MenuItem>
              <MenuItem value="model">By Model</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} md={4}>
          <FormControl fullWidth>
            <InputLabel>Sort By</InputLabel>
            <Select
              value={sortBy}
              label="Sort By"
              onChange={(e) => setSortBy(e.target.value as SortBy)}
            >
              <MenuItem value="score">Best Score First</MenuItem>
              <MenuItem value="speed">Fastest First</MenuItem>
              <MenuItem value="model">Model Name</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} md={4}>
          <FormControlLabel
            control={
              <Checkbox
                checked={enableTools}
                onChange={(e) => setEnableTools(e.target.checked)}
                color="primary"
              />
            }
            label={
              <Tooltip title="Enable LLM tools (Read, Write, Edit, Bash) for benchmark tasks. When disabled, LLMs provide text-only responses.">
                <span>Enable Tools (Read, Write, Bash)</span>
              </Tooltip>
            }
            sx={{ mt: 1 }}
          />
        </Grid>
      </Grid>

      {/* Results */}
      {groupedData.map((group, groupIndex) => (
        <Card key={groupIndex} sx={{ mb: 3 }}>
          <CardContent>
            {group.type === 'task' ? (
              <>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                  {group.task.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Category: {group.task.category} • Difficulty: {group.task.difficultyLevel}/5
                </Typography>
                <Typography variant="body2" sx={{ mb: 2, p: 2, bgcolor: 'background.paper', borderRadius: 1 }}>
                  <strong>Task:</strong> {group.task.prompt}
                </Typography>
              </>
            ) : (
              <>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    {group.modelName}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <Chip
                      icon={<ScoreIcon />}
                      label={`Avg: ${group.avgScore.toFixed(1)}/100`}
                      color="primary"
                      variant="outlined"
                    />
                    <Chip
                      icon={<SpeedIcon />}
                      label={`Avg: ${formatDuration(group.avgSpeed)}`}
                      color="secondary"
                      variant="outlined"
                    />
                  </Box>
                </Box>
              </>
            )}

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell width={40}></TableCell>
                    {group.type === 'task' ? (
                      <TableCell>Model</TableCell>
                    ) : (
                      <TableCell>Task</TableCell>
                    )}
                    <TableCell align="right">Score</TableCell>
                    <TableCell align="right">Speed</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {group.responses.map((response, idx) => {
                    const rowId = `${groupIndex}-${idx}`;
                    const isExpanded = expandedRows.has(rowId);

                    return (
                      <>
                        <TableRow key={idx} hover sx={{ cursor: 'pointer' }} onClick={() => toggleRow(rowId)}>
                          <TableCell>
                            <IconButton size="small">
                              {isExpanded ? <CollapseIcon /> : <ExpandIcon />}
                            </IconButton>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {group.type === 'task' ? response.modelName : response.task?.title}
                            </Typography>
                            {group.type === 'model' && response.task && (
                              <Typography variant="caption" color="text.secondary">
                                {response.task.category}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <Chip
                              label={`${response.evaluation?.overallScore || 0}/100`}
                              size="small"
                              color={
                                (response.evaluation?.overallScore || 0) >= 90 ? 'success' :
                                (response.evaluation?.overallScore || 0) >= 70 ? 'primary' : 'warning'
                              }
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" color="text.secondary">
                              {formatDuration(response.durationMs)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            {response.success ? (
                              <Chip label="Success" size="small" color="success" variant="outlined" />
                            ) : (
                              <Chip label="Failed" size="small" color="error" variant="outlined" />
                            )}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={5} sx={{ p: 0 }}>
                            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                              <Box sx={{ p: 2, bgcolor: 'background.default' }}>
                                <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                                  Response:
                                </Typography>
                                <Paper sx={{ p: 2, mb: 2, bgcolor: 'background.paper' }}>
                                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                                    {response.response}
                                  </Typography>
                                </Paper>

                                {response.evaluation && (
                                  <>
                                    <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                                      Evaluation:
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                      {response.evaluation.feedback}
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                                      <Chip label={`Accuracy: ${response.evaluation.accuracy}`} size="small" variant="outlined" />
                                      <Chip label={`Coherence: ${response.evaluation.clarity}`} size="small" variant="outlined" />
                                      <Chip label={`Completeness: ${response.evaluation.completeness}`} size="small" variant="outlined" />
                                    </Box>
                                    {response.evaluation.strengths.length > 0 && (
                                      <Typography variant="caption" color="success.main">
                                        ✓ {response.evaluation.strengths.join(', ')}
                                      </Typography>
                                    )}
                                    {response.evaluation.weaknesses.length > 0 && (
                                      <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                                        ⚠ {response.evaluation.weaknesses.join(', ')}
                                      </Typography>
                                    )}
                                  </>
                                )}
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}
