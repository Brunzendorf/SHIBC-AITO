/**
 * MCP Worker - Short-lived worker agent for MCP tasks
 * Uses dynamic MCP config with Claude Code --mcp-config flag
 *
 * Enhanced with API Knowledge System:
 * - Injects relevant API documentation into worker prompts
 * - Indexes successful API patterns for self-learning
 */

import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { createLogger } from '../lib/logger.js';
import { MCP_SERVERS_BY_AGENT, loadMCPConfig, type MCPServerConfig } from '../lib/mcp.js';
import { executeClaudeCodeWithMCP, isClaudeAvailable } from '../agents/claude.js';
import { publisher, channels } from '../lib/redis.js';
import { isDryRun } from '../lib/config.js';
import { getAPIsForTask, generateAPIPrompt, type APIDefinition } from '../lib/api-registry.js';
import { indexAPIUsage, searchAPIPatterns, buildContext } from '../lib/rag.js';
import type { AgentType, WorkerTask, WorkerResult } from '../lib/types.js';

const logger = createLogger('worker');

// Dry-run mode: log what WOULD happen without executing
async function executeDryRun(task: WorkerTask): Promise<WorkerResult> {
  const start = Date.now();

  logger.info({
    taskId: task.id,
    parentAgent: task.parentAgent,
    servers: task.servers,
    task: task.task,
    mode: 'DRY_RUN'
  }, '🔸 DRY-RUN: Would execute MCP task');

  // Log to Redis for dashboard visibility
  const dryRunLog = {
    timestamp: new Date().toISOString(),
    taskId: task.id,
    parentAgent: task.parentAgent,
    servers: task.servers,
    task: task.task,
    mode: 'DRY_RUN',
    wouldExecute: true,
    actuallyExecuted: false,
  };

  await publisher.publish(channels.workerLogs, JSON.stringify(dryRunLog));
  await publisher.lpush('worker:dryrun:history', JSON.stringify(dryRunLog));
  await publisher.ltrim('worker:dryrun:history', 0, 999);

  return {
    taskId: task.id,
    success: true,
    result: `[DRY-RUN] Would execute: "${task.task}" using servers: [${task.servers.join(', ')}]`,
    toolsUsed: ['DRY_RUN_SIMULATED'],
    duration: Date.now() - start,
    data: { dryRun: true, task: task.task, servers: task.servers },
  };
}

function generateDynamicMCPConfig(servers: string[], taskId: string): { configPath: string; serverConfigs: Record<string, MCPServerConfig> } {
  const fullConfig = loadMCPConfig();
  const filteredConfig: Record<string, MCPServerConfig> = {};
  for (const s of servers) { if (fullConfig[s]) filteredConfig[s] = fullConfig[s]; }
  const configPath = '/tmp/mcp-worker-' + taskId + '.json';
  writeFileSync(configPath, JSON.stringify({ mcpServers: filteredConfig }, null, 2));
  logger.debug({ configPath, servers: Object.keys(filteredConfig) }, 'Generated MCP config');
  return { configPath, serverConfigs: filteredConfig };
}

function cleanupMCPConfig(configPath: string): void {
  try { if (existsSync(configPath)) unlinkSync(configPath); } catch {}
}

async function logToolCalls(task: WorkerTask, toolsUsed: string[], result: WorkerResult): Promise<void> {
  try {
    const entry = { timestamp: new Date().toISOString(), taskId: task.id, parentAgent: task.parentAgent, servers: task.servers, toolsUsed, success: result.success, duration: result.duration, error: result.error };
    await publisher.publish(channels.workerLogs, JSON.stringify(entry));
    await publisher.lpush('worker:logs:history', JSON.stringify(entry));
    await publisher.ltrim('worker:logs:history', 0, 999);
  } catch {}
}

interface ParsedWorkerOutput extends Partial<WorkerResult> {
  toolsUsed?: string[];
  apiUsed?: string;
  endpoint?: string;
}

function parseWorkerOutput(output: string): ParsedWorkerOutput {
  try { const m = output.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch {}
  return { success: true, result: output.slice(0, 500), toolsUsed: [] };
}

export function validateServerAccess(agentType: AgentType, servers: string[]): { valid: boolean; denied: string[] } {
  const allowed = MCP_SERVERS_BY_AGENT[agentType] || [];
  const denied = servers.filter(s => !allowed.includes(s));
  return { valid: denied.length === 0, denied };
}

export async function executeWorker(task: WorkerTask): Promise<WorkerResult> {
  const start = Date.now();
  let configPath: string | null = null;
  let matchedAPIs: APIDefinition[] = [];

  logger.info({ taskId: task.id, parentAgent: task.parentAgent, servers: task.servers, dryRun: isDryRun }, 'Starting MCP worker');

  // DRY-RUN MODE: Log but don't execute external MCP calls
  if (isDryRun) {
    logger.warn({ taskId: task.id }, '⚠️ DRY-RUN MODE ACTIVE - External calls will be simulated');
    return executeDryRun(task);
  }

  const access = validateServerAccess(task.parentAgent, task.servers);
  if (!access.valid) {
    const r: WorkerResult = { taskId: task.id, success: false, error: 'Access denied: ' + access.denied.join(', '), duration: Date.now() - start };
    await logToolCalls(task, [], r);
    return r;
  }

  if (!(await isClaudeAvailable())) {
    const r: WorkerResult = { taskId: task.id, success: false, error: 'Claude not available', duration: Date.now() - start };
    await logToolCalls(task, [], r);
    return r;
  }

  try {
    const { configPath: p, serverConfigs } = generateDynamicMCPConfig(task.servers, task.id);
    configPath = p;
    if (Object.keys(serverConfigs).length === 0) throw new Error('No MCP servers found');

    logger.info({ taskId: task.id, servers: Object.keys(serverConfigs), configPath }, 'MCP config generated');

    // ========================================
    // API KNOWLEDGE INJECTION (Self-Learning)
    // ========================================

    // 1. Find relevant APIs from registry for this task
    matchedAPIs = getAPIsForTask(task.task, task.parentAgent);

    // 2. Search RAG for previous successful API patterns
    let previousPatterns = '';
    try {
      const ragResults = await searchAPIPatterns(task.task, task.parentAgent, 3);
      if (ragResults.length > 0) {
        previousPatterns = '\n\n## Previous Successful API Patterns\n' + buildContext(ragResults, 500);
      }
    } catch (e) {
      logger.debug({ error: e }, 'RAG search for API patterns failed (non-critical)');
    }

    // 3. Generate API documentation prompt
    const apiKnowledge = generateAPIPrompt(matchedAPIs);

    logger.info({
      taskId: task.id,
      matchedAPIs: matchedAPIs.map(a => a.name),
      hasPreviousPatterns: previousPatterns.length > 0,
    }, 'API knowledge injected');

    // Build enhanced prompt with API knowledge
    let prompt = '# Task\n' + task.task;

    if (task.context) {
      prompt += '\n\n# Context\n' + JSON.stringify(task.context);
    }

    if (apiKnowledge) {
      prompt += '\n\n' + apiKnowledge;
    }

    if (previousPatterns) {
      prompt += previousPatterns;
    }

    // Enhanced system prompt with API guidance
    const systemPrompt = `MCP Worker for ${task.parentAgent.toUpperCase()} agent.
Available MCP servers: ${task.servers.join(', ')}

IMPORTANT: When using the fetch tool for external APIs:
1. Check the "Available APIs" section for endpoint details
2. Use the correct authentication method (header or query param)
3. Reference environment variables like \${ENV_VAR_NAME} for API keys
4. Return structured JSON with your results

Execute the task and return JSON with: { "success": true/false, "result": "description", "data": {...}, "apiUsed": "api_name", "endpoint": "/path" }`;

    const claude = await executeClaudeCodeWithMCP({
      prompt,
      systemPrompt,
      mcpConfigPath: configPath,
      timeout: task.timeout || 60000,
    });

    if (!claude.success) {
      const r: WorkerResult = { taskId: task.id, success: false, error: claude.error || 'Failed', duration: Date.now() - start };
      await logToolCalls(task, [], r);

      // Index failed pattern for learning
      if (matchedAPIs.length > 0) {
        try {
          await indexAPIUsage(
            matchedAPIs[0].name,
            'unknown',
            'GET',
            {},
            '',
            false,
            task.parentAgent,
            claude.error || 'Execution failed'
          );
        } catch {}
      }

      return r;
    }

    const parsed = parseWorkerOutput(claude.output);
    const result: WorkerResult = {
      taskId: task.id,
      success: parsed.success ?? true,
      result: parsed.result || claude.output.slice(0, 1000),
      data: parsed.data,
      toolsUsed: parsed.toolsUsed || [],
      duration: Date.now() - start
    };

    await logToolCalls(task, result.toolsUsed || [], result);

    // ========================================
    // INDEX SUCCESSFUL API PATTERN
    // ========================================
    if (result.success && parsed.apiUsed) {
      try {
        await indexAPIUsage(
          parsed.apiUsed as string,
          (parsed.endpoint as string) || 'unknown',
          'GET',
          {},
          JSON.stringify(parsed.data || {}).slice(0, 200),
          true,
          task.parentAgent
        );
        logger.info({ apiUsed: parsed.apiUsed, endpoint: parsed.endpoint }, 'Indexed successful API pattern');
      } catch (e) {
        logger.debug({ error: e }, 'Failed to index API pattern (non-critical)');
      }
    }

    logger.info({ taskId: task.id, success: result.success, duration: result.duration }, 'MCP worker completed');
    return result;

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const r: WorkerResult = { taskId: task.id, success: false, error: msg, duration: Date.now() - start };
    logger.error({ taskId: task.id, error: msg }, 'MCP worker failed');
    await logToolCalls(task, [], r);
    return r;
  } finally {
    if (configPath) cleanupMCPConfig(configPath);
  }
}

export function validateWorkerTask(task: Partial<WorkerTask>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!task.id) errors.push('Missing id');
  if (!task.parentAgent) errors.push('Missing parentAgent');
  if (!task.task) errors.push('Missing task');
  if (!task.servers?.length) errors.push('Missing servers');
  return { valid: errors.length === 0, errors };
}
