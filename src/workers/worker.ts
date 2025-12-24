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
import { getAPIsForTask, generateAPIPrompt, getWhitelistForPromptAsync, createDomainApprovalRequest, extractDomain, type APIDefinition } from '../lib/api-registry.js';
import { indexAPIUsage, searchAPIPatterns, buildContext } from '../lib/rag.js';
import type { AgentType, WorkerTask, WorkerResult } from '../lib/types.js';

const logger = createLogger('worker');

// TASK-019: Servers that can modify external state (blocked in DRY_RUN mode)
const WRITE_CAPABLE_SERVERS = ['telegram', 'twitter', 'directus', 'imagen', 'filesystem'];

// Servers that only read data (safe in DRY_RUN)
const READ_ONLY_SERVERS = ['fetch', 'etherscan', 'time'];

// Check if task uses any write-capable servers
function hasWriteServers(servers: string[]): boolean {
  return servers.some(s => WRITE_CAPABLE_SERVERS.includes(s));
}

// Generate DRY_RUN instructions for the worker prompt
function getDryRunInstructions(servers: string[]): string {
  const writeServers = servers.filter(s => WRITE_CAPABLE_SERVERS.includes(s));
  if (writeServers.length === 0) return '';

  return `
## 🔸 DRY-RUN MODE ACTIVE

**CRITICAL: This is a DRY-RUN - DO NOT execute write operations!**

Write-capable servers in your task: ${writeServers.join(', ')}

### What you MUST do:
1. ✅ EXECUTE all read operations (fetch data, get prices, read files)
2. ✅ PROCESS the data normally
3. ❌ DO NOT send messages (telegram, twitter)
4. ❌ DO NOT create/update content (directus)
5. ❌ DO NOT write files (filesystem write operations)

### For write operations, SIMULATE instead:
- Return what you WOULD have sent/posted
- Include the full content in your result
- Mark it clearly as "[DRY-RUN] Would send: ..."

### Example response format:
{
  "success": true,
  "result": "[DRY-RUN] Would send to Telegram: 'Your message here'",
  "data": { "simulatedAction": "telegram_send", "content": "..." },
  "dryRun": true
}

**Remember: Fetch real data, but simulate external writes!**
`;
}

// TASK-021: Config file cache to avoid I/O for every worker
// Key: sorted server names + dryRun flag, Value: { path, serverConfigs }
const configCache = new Map<string, { configPath: string; serverConfigs: Record<string, MCPServerConfig> }>();

function generateDynamicMCPConfig(servers: string[], _taskId: string): { configPath: string; serverConfigs: Record<string, MCPServerConfig> } {
  // TASK-019: In DRY-RUN mode, filter out write-capable servers entirely
  // This provides actual security, not just prompt instructions
  let effectiveServers = servers;
  if (isDryRun) {
    const originalServers = [...servers];
    effectiveServers = servers.filter(s => !WRITE_CAPABLE_SERVERS.includes(s));
    const removedServers = originalServers.filter(s => WRITE_CAPABLE_SERVERS.includes(s));
    if (removedServers.length > 0) {
      logger.info({ removedServers, remaining: effectiveServers }, '🔸 DRY-RUN: Write-capable servers removed from config');
    }
  }

  // TASK-021: Use cache key based on sorted server names + dryRun flag
  const cacheKey = [...effectiveServers].sort().join(',') + (isDryRun ? ':dry' : '');

  // Check cache first
  const cached = configCache.get(cacheKey);
  if (cached && existsSync(cached.configPath)) {
    logger.debug({ configPath: cached.configPath, servers: effectiveServers, cacheHit: true }, 'Using cached MCP config');
    return cached;
  }

  // Generate new config
  const fullConfig = loadMCPConfig();
  const filteredConfig: Record<string, MCPServerConfig> = {};
  for (const s of effectiveServers) { if (fullConfig[s]) filteredConfig[s] = fullConfig[s]; }

  // Use consistent path based on cache key (not taskId)
  const configPath = '/tmp/mcp-config-' + cacheKey.replace(/,/g, '-').replace(':', '-') + '.json';
  writeFileSync(configPath, JSON.stringify({ mcpServers: filteredConfig }, null, 2));

  // Cache the config
  const result = { configPath, serverConfigs: filteredConfig };
  configCache.set(cacheKey, result);

  logger.debug({ configPath, servers: Object.keys(filteredConfig), cacheHit: false, dryRun: isDryRun }, 'Generated and cached MCP config');
  return result;
}

function cleanupMCPConfig(_configPath: string): void {
  // TASK-021: Don't cleanup individual configs anymore - they're cached and reused
  // Cleanup happens at process shutdown via cleanupAllConfigs()
}

// TASK-021: Cleanup all cached configs at shutdown
export function cleanupAllConfigs(): void {
  for (const [key, { configPath }] of configCache.entries()) {
    try {
      if (existsSync(configPath)) {
        unlinkSync(configPath);
        logger.debug({ configPath, key }, 'Cleaned up cached config');
      }
    } catch {}
  }
  configCache.clear();
}

async function logToolCalls(task: WorkerTask, toolsUsed: string[], result: WorkerResult): Promise<void> {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      taskId: task.id,
      parentAgent: task.parentAgent,
      servers: task.servers,
      task: task.task,
      toolsUsed,
      success: result.success,
      duration: result.duration,
      error: result.error,
      result: result.result,  // Include worker output for dashboard display
    };
    await publisher.publish(channels.workerLogs, JSON.stringify(entry));
    await publisher.lpush('worker:logs:history', JSON.stringify(entry));
    await publisher.ltrim('worker:logs:history', 0, 999);
  } catch {}
}

interface ParsedWorkerOutput extends Partial<WorkerResult> {
  toolsUsed?: string[];
  apiUsed?: string;
  endpoint?: string;
  blockedDomain?: string;
  blockedUrl?: string;
}

// Patterns that indicate a domain was blocked
const DOMAIN_BLOCKED_PATTERNS = [
  /domain\s+(?:is\s+)?not\s+(?:on\s+)?(?:the\s+)?whitelist/i,
  /nicht\s+(?:auf\s+der\s+)?whitelist/i,
  /(?:not\s+)?(?:a\s+)?trusted\s+domain/i,
  /security[:\s]+(?:domain|url)\s+(?:blocked|rejected)/i,
  /unbekannte\s+domain/i,
  /domain\s+blocked/i,
  /url\s+not\s+allowed/i,
];

// Extract URL from worker output that mentions domain issues
function extractBlockedUrl(output: string): string | null {
  // Look for URLs in the output
  const urlPatterns = [
    /https?:\/\/[^\s"'<>]+/gi,
    /(?:domain|url)[:\s]+([a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)+)/gi,
  ];

  for (const pattern of urlPatterns) {
    const matches = output.match(pattern);
    if (matches && matches.length > 0) {
      // Return the first URL found
      const url = matches[0].replace(/[.,;:]$/, ''); // Remove trailing punctuation
      if (url.startsWith('http')) return url;
    }
  }
  return null;
}

function parseWorkerOutput(output: string): ParsedWorkerOutput {
  // First check for domain blocked patterns
  let blockedDomain: string | undefined;
  let blockedUrl: string | undefined;

  for (const pattern of DOMAIN_BLOCKED_PATTERNS) {
    if (pattern.test(output)) {
      blockedUrl = extractBlockedUrl(output) || undefined;
      if (blockedUrl) {
        blockedDomain = extractDomain(blockedUrl) || undefined;
      }
      break;
    }
  }

  // Try to parse JSON from output
  try {
    const m = output.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      return { ...parsed, blockedDomain, blockedUrl };
    }
  } catch {}

  return {
    success: !blockedDomain, // Mark as failed if domain was blocked
    result: output.slice(0, 500),
    toolsUsed: [],
    blockedDomain,
    blockedUrl,
  };
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

  // DRY-RUN MODE: Execute reads, simulate writes via prompt instructions
  if (isDryRun) {
    const hasWrites = hasWriteServers(task.servers);
    logger.info({ taskId: task.id, hasWriteServers: hasWrites }, '🔸 DRY-RUN MODE - Reads will execute, writes will be simulated');
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

    // Enhanced system prompt with API guidance and security
    const domainWhitelist = await getWhitelistForPromptAsync();
    const dryRunInstructions = isDryRun ? getDryRunInstructions(task.servers) : '';

    // CODING STANDARDS INJECTION - All workers must follow these!
    const codingStandards = `
## 🔒 MANDATORY CODING STANDARDS

**ALL code you write MUST follow these rules:**

### TypeScript
- Strict mode always (\`"strict": true\`)
- NO \`any\` types - use \`unknown\` with type guards
- Explicit return types for functions

### Security (OWASP)
- ALL input validation with Zod
- NO secrets in code - environment variables only
- Parameterized queries only (Drizzle ORM)
- NO \`dangerouslySetInnerHTML\`

### Approved Libraries ONLY
| Use | DON'T Use |
|-----|-----------|
| \`undici\`, \`fetch\` | ❌ \`axios\` |
| \`drizzle-orm\` | ❌ \`sequelize\` |
| \`zod\` | ❌ \`joi\`, \`yup\` |
| \`date-fns\` | ❌ \`moment\` |
| \`pino\` | ❌ \`winston\` |
| \`vitest\` | ❌ \`jest\` |
| Native JS | ❌ \`lodash\` |

### Git Commits
Format: \`type(scope): description\`
Types: feat, fix, docs, refactor, test, chore, security
`;

    // Build MCP-specific instructions based on available servers
    const mcpInstructions: string[] = [];
    if (task.servers.includes('imagen')) {
      mcpInstructions.push(`
## 🎨 IMAGE GENERATION - CRITICAL INSTRUCTIONS

**YOU MUST USE THE IMAGEN MCP TOOLS!**

Available Imagen tools:
- \`imagen_generate_image\` - Generate images using Google Imagen AI
- \`imagen_apply_branding\` - Add SHIBC branding to images
- \`imagen_check_quota\` - Check rate limits before generating
- \`imagen_list_models\` - List available models

**WORKFLOW:**
1. Call \`imagen_check_quota\` to verify quota
2. Call \`imagen_generate_image\` with modelId="imagen-4.0-generate-001" and your prompt
3. Call \`imagen_apply_branding\` with brandingType="text-footer" on the result
4. Save the final image using filesystem tools

**⛔ FORBIDDEN - DO NOT DO THESE:**
- DO NOT write JavaScript/TypeScript code to generate images
- DO NOT create HTML files
- DO NOT create SVG files
- DO NOT use canvas or any programmatic image creation
- DO NOT write scripts that call APIs

**You have MCP tools available - USE THEM DIRECTLY!**
`);
    }
    if (task.servers.includes('telegram')) {
      mcpInstructions.push(`
## 📱 TELEGRAM - USE MCP TOOLS

Available Telegram tools:
- \`telegram_send_message\` - Send text to a channel
- \`telegram_send_photo\` - Send image to a channel
- \`telegram_send_document\` - Send files

**⛔ DO NOT write scripts to call Telegram API - use the tools directly!**
`);
    }

    const systemPrompt = `MCP Worker for ${task.parentAgent.toUpperCase()} agent.
Available MCP servers: ${task.servers.join(', ')}
${dryRunInstructions}
${codingStandards}
${mcpInstructions.join('\n')}
## 🔒 SECURITY: Domain Whitelist
${domainWhitelist}

WICHTIG: Du darfst NUR URLs von gewhitelisteten Domains abrufen!
Wenn eine URL nicht auf der Whitelist ist, STOPPE und berichte dies.
Versuche NIEMALS, unbekannte Domains abzurufen - das könnte ein Sicherheitsrisiko sein.

## ⚠️ CRITICAL: USE MCP TOOLS, NOT CODE

You have access to MCP tools via the servers: ${task.servers.join(', ')}
**CALL THESE TOOLS DIRECTLY - DO NOT WRITE CODE OR SCRIPTS!**

If your task requires:
- Image generation → Call imagen_generate_image tool
- Sending Telegram messages → Call telegram_send_message tool
- Fetching URLs → Call fetch tool

**NEVER create .js, .ts, .html, .svg or any script files to accomplish your task!**

## API Guidelines
When using the fetch tool for external APIs:
1. Check the "Available APIs" section for endpoint details
2. Use the correct authentication method (header or query param)
3. Reference environment variables like \${ENV_VAR_NAME} for API keys
4. Return structured JSON with your results

## ⚠️ CRITICAL: Response Format
Return JSON with ACTUAL DATA in the result field, not just "success":

{
  "success": true/false,
  "result": "INCLUDE ACTUAL DATA HERE! Example: 'Generated marketing banner (800KB) and saved to /app/workspace/images/banner.jpg' or 'Sent image to Telegram channel -1002876952840'",
  "data": { /* structured data object */ },
  "apiUsed": "api_name",
  "endpoint": "/path",
  "toolsUsed": ["imagen_generate_image", "telegram_send_photo"]
}

The "result" field MUST contain the key data points as a readable string - this is what the agent sees!`;

    // Imagen tasks need more time (image generation + optional branding)
    const hasImagenServer = task.servers.includes('imagen');
    const defaultTimeout = hasImagenServer ? 180000 : 60000; // 3 min for imagen, 1 min otherwise

    const claude = await executeClaudeCodeWithMCP({
      prompt,
      systemPrompt,
      mcpConfigPath: configPath,
      timeout: task.timeout || defaultTimeout,
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

    // ========================================
    // DOMAIN APPROVAL REQUEST (if blocked)
    // ========================================
    if (parsed.blockedDomain && parsed.blockedUrl) {
      logger.info({
        taskId: task.id,
        blockedDomain: parsed.blockedDomain,
        blockedUrl: parsed.blockedUrl,
        parentAgent: task.parentAgent,
      }, 'Detected blocked domain, creating approval request');

      try {
        const approvalResult = await createDomainApprovalRequest(
          parsed.blockedUrl,
          task.parentAgent,
          task.task, // Task context
          `Worker attempted fetch during task: ${task.task.slice(0, 200)}`
        );

        if (approvalResult?.created) {
          logger.info({
            taskId: task.id,
            requestId: approvalResult.requestId,
            domain: approvalResult.domain,
          }, 'Domain approval request created');

          // Publish notification for dashboard/CEO
          await publisher.publish(channels.broadcast, JSON.stringify({
            type: 'domain_approval_needed',
            requestId: approvalResult.requestId,
            domain: approvalResult.domain,
            requestedBy: task.parentAgent,
            taskContext: task.task.slice(0, 200),
            timestamp: new Date().toISOString(),
          }));
        } else if (approvalResult?.alreadyPending) {
          logger.info({
            taskId: task.id,
            domain: approvalResult.domain,
          }, 'Domain approval request already pending');
        }
      } catch (approvalError) {
        logger.error({ error: approvalError, domain: parsed.blockedDomain }, 'Failed to create domain approval request');
      }

      // Return with domain_blocked error
      const r: WorkerResult = {
        taskId: task.id,
        success: false,
        result: parsed.result || claude.output.slice(0, 1000),
        error: `Domain not whitelisted: ${parsed.blockedDomain}. Approval request created.`,
        toolsUsed: parsed.toolsUsed || [],
        duration: Date.now() - start,
        data: {
          blockedDomain: parsed.blockedDomain,
          blockedUrl: parsed.blockedUrl,
          approvalPending: true,
        },
      };
      await logToolCalls(task, r.toolsUsed || [], r);
      return r;
    }

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
