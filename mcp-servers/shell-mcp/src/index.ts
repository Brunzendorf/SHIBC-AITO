#!/usr/bin/env node
/**
 * Shell MCP Server for SHIBC CTO
 *
 * Provides secure command execution with restrictions and audit logging.
 *
 * Environment Variables:
 * - ALLOWED_PATHS: Comma-separated list of allowed working directories (default: /app/workspace)
 * - ALLOWED_COMMANDS: Comma-separated allowed command prefixes (default: npm,node,npx,tsc,vitest,docker,ls,cat,head,tail,wc,grep,find,pwd,echo)
 * - FORBIDDEN_PATTERNS: Comma-separated forbidden patterns (default: rm -rf /,sudo,chmod 777,eval,exec)
 * - DEFAULT_TIMEOUT: Default command timeout in ms (default: 30000)
 * - MAX_TIMEOUT: Maximum allowed timeout in ms (default: 300000)
 * - MAX_OUTPUT_SIZE: Maximum output size in bytes (default: 100000)
 *
 * Security:
 * - Command whitelist enforced
 * - Path restriction enforced
 * - Dangerous patterns blocked
 * - All operations logged
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// --- Configuration ---
const ALLOWED_PATHS = (process.env.ALLOWED_PATHS || '/app/workspace').split(',').map(p => p.trim());
const ALLOWED_COMMANDS = (process.env.ALLOWED_COMMANDS ||
  'npm,node,npx,tsc,vitest,docker,ls,cat,head,tail,wc,grep,find,pwd,echo,mkdir,cp,mv,touch'
).split(',').map(p => p.trim().toLowerCase());
const FORBIDDEN_PATTERNS = (process.env.FORBIDDEN_PATTERNS ||
  'rm -rf /,rm -rf /*,sudo,chmod 777,eval(,exec(,>/dev,|sh,|bash,;sh,;bash,&&sh,&&bash,`'
).split(',').map(p => p.trim().toLowerCase());
const DEFAULT_TIMEOUT = parseInt(process.env.DEFAULT_TIMEOUT || '30000', 10);
const MAX_TIMEOUT = parseInt(process.env.MAX_TIMEOUT || '300000', 10);
const MAX_OUTPUT_SIZE = parseInt(process.env.MAX_OUTPUT_SIZE || '100000', 10);

// --- Logging Helper ---
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: 'shell-mcp',
    msg: message,
    ...data
  };
  console.error(JSON.stringify(entry));
}

// --- Security: Path Validation ---
function isPathAllowed(targetPath: string): boolean {
  const normalizedTarget = path.resolve(targetPath);
  return ALLOWED_PATHS.some(allowedPath => {
    const normalizedAllowed = path.resolve(allowedPath);
    return normalizedTarget.startsWith(normalizedAllowed);
  });
}

function validatePath(targetPath: string): void {
  if (!isPathAllowed(targetPath)) {
    throw new Error(`Security: Path not allowed: ${targetPath}. Allowed paths: ${ALLOWED_PATHS.join(', ')}`);
  }
}

// --- Security: Command Validation ---
function isCommandAllowed(command: string): boolean {
  const lowerCommand = command.toLowerCase().trim();
  const firstWord = lowerCommand.split(/\s+/)[0];

  // Check if the base command is in the allowlist
  return ALLOWED_COMMANDS.some(allowed =>
    firstWord === allowed || firstWord.endsWith('/' + allowed)
  );
}

function hasForbiddenPattern(command: string): boolean {
  const lowerCommand = command.toLowerCase();
  return FORBIDDEN_PATTERNS.some(pattern => lowerCommand.includes(pattern));
}

function validateCommand(command: string): void {
  if (!isCommandAllowed(command)) {
    const firstWord = command.split(/\s+/)[0];
    throw new Error(`Security: Command not allowed: ${firstWord}. Allowed commands: ${ALLOWED_COMMANDS.join(', ')}`);
  }

  if (hasForbiddenPattern(command)) {
    throw new Error(`Security: Command contains forbidden pattern. Blocked patterns: ${FORBIDDEN_PATTERNS.join(', ')}`);
  }
}

// --- Command Executor ---
interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

async function executeCommand(
  command: string,
  cwd: string,
  timeout: number,
  env?: Record<string, string>
): Promise<ExecResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const shellArg = isWindows ? '/c' : '-c';

    const child = spawn(shell, [shellArg, command], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Force kill after 5 seconds
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeout);

    child.stdout?.on('data', (data: Buffer) => {
      if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += data.toString();
        if (stdout.length > MAX_OUTPUT_SIZE) {
          stdout = stdout.slice(0, MAX_OUTPUT_SIZE);
          truncated = true;
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += data.toString();
        if (stderr.length > MAX_OUTPUT_SIZE) {
          stderr = stderr.slice(0, MAX_OUTPUT_SIZE);
          truncated = true;
        }
      }
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timeoutId);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        signal: signal?.toString() || null,
        timedOut,
        truncated,
        durationMs: Date.now() - startTime,
      });
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      resolve({
        stdout: '',
        stderr: error.message,
        exitCode: 1,
        signal: null,
        timedOut: false,
        truncated: false,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

// --- Create MCP Server ---
const server = new Server(
  {
    name: 'shell-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- List available tools ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log('debug', 'Returning tools list');
  return {
    tools: [
      {
        name: 'shell_exec',
        description: 'Execute a shell command in a specified directory with timeout. Commands must be from the allowed list.',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Command to execute (must start with allowed command: npm, node, npx, tsc, vitest, docker, ls, cat, etc.)'
            },
            cwd: {
              type: 'string',
              description: 'Working directory (must be within allowed paths)'
            },
            timeout: {
              type: 'number',
              description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT}, max: ${MAX_TIMEOUT})`
            },
            env: {
              type: 'object',
              description: 'Additional environment variables',
              additionalProperties: { type: 'string' }
            },
          },
          required: ['command', 'cwd']
        }
      },
      {
        name: 'shell_which',
        description: 'Check if a command exists and get its path',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command name to check' },
          },
          required: ['command']
        }
      },
      {
        name: 'shell_env',
        description: 'Get environment variable value (safe variables only)',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Environment variable name' },
          },
          required: ['name']
        }
      },
      {
        name: 'shell_file_exists',
        description: 'Check if a file or directory exists',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to check' },
          },
          required: ['path']
        }
      },
      {
        name: 'shell_read_file',
        description: 'Read contents of a file (within allowed paths)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to read' },
            encoding: { type: 'string', description: 'File encoding (default: utf8)' },
            maxSize: { type: 'number', description: 'Maximum bytes to read (default: 100000)' },
          },
          required: ['path']
        }
      },
      {
        name: 'shell_write_file',
        description: 'Write contents to a file (within allowed paths)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to write' },
            content: { type: 'string', description: 'Content to write' },
            encoding: { type: 'string', description: 'File encoding (default: utf8)' },
          },
          required: ['path', 'content']
        }
      },
      {
        name: 'shell_list_dir',
        description: 'List directory contents with details',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path' },
            recursive: { type: 'boolean', description: 'List recursively (default: false)' },
            maxDepth: { type: 'number', description: 'Max recursion depth (default: 2)' },
          },
          required: ['path']
        }
      },
    ],
  };
});

// --- Safe environment variables (no secrets) ---
const SAFE_ENV_PREFIXES = ['NODE_', 'NPM_', 'PATH', 'HOME', 'USER', 'SHELL', 'PWD', 'LANG', 'LC_'];
const BLOCKED_ENV_PATTERNS = ['TOKEN', 'SECRET', 'KEY', 'PASSWORD', 'CREDENTIAL', 'AUTH'];

function isSafeEnvVar(name: string): boolean {
  const upperName = name.toUpperCase();

  // Block sensitive variables
  if (BLOCKED_ENV_PATTERNS.some(pattern => upperName.includes(pattern))) {
    return false;
  }

  // Allow safe prefixes
  return SAFE_ENV_PREFIXES.some(prefix => upperName.startsWith(prefix));
}

// --- List directory recursively ---
interface DirEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
  children?: DirEntry[];
}

function listDirectory(dirPath: string, recursive: boolean, maxDepth: number, currentDepth = 0): DirEntry[] {
  const entries: DirEntry[] = [];

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      const entry: DirEntry = {
        name: item.name,
        type: item.isFile() ? 'file' : item.isDirectory() ? 'directory' : item.isSymbolicLink() ? 'symlink' : 'other',
      };

      if (item.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          entry.size = stats.size;
        } catch {
          // Ignore stat errors
        }
      }

      if (recursive && item.isDirectory() && currentDepth < maxDepth) {
        try {
          entry.children = listDirectory(fullPath, recursive, maxDepth, currentDepth + 1);
        } catch {
          // Ignore unreadable directories
        }
      }

      entries.push(entry);
    }
  } catch {
    // Return empty if can't read directory
  }

  return entries.sort((a, b) => {
    // Directories first, then alphabetically
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
}

// --- Handle tool calls ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  log('info', `Tool called: ${name}`, { tool: name, args });

  try {
    switch (name) {
      case 'shell_exec': {
        const { command, cwd, timeout: requestedTimeout, env } = args as {
          command: string;
          cwd: string;
          timeout?: number;
          env?: Record<string, string>;
        };

        // Validate path and command
        validatePath(cwd);
        validateCommand(command);

        // Validate timeout
        const timeout = Math.min(requestedTimeout || DEFAULT_TIMEOUT, MAX_TIMEOUT);

        log('info', 'Executing command', { command, cwd, timeout });

        const result = await executeCommand(command, cwd, timeout, env);

        log('info', 'Command completed', {
          command,
          cwd,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: result.exitCode === 0,
            command,
            cwd,
            exitCode: result.exitCode,
            signal: result.signal,
            stdout: result.stdout,
            stderr: result.stderr,
            timedOut: result.timedOut,
            truncated: result.truncated,
            durationMs: result.durationMs,
          }, null, 2) }],
          isError: result.exitCode !== 0,
        };
      }

      case 'shell_which': {
        const { command: cmd } = args as { command: string };

        const isWindows = process.platform === 'win32';
        const whichCmd = isWindows ? 'where' : 'which';

        const result = await executeCommand(`${whichCmd} ${cmd}`, '/tmp', 5000);

        return {
          content: [{ type: 'text', text: JSON.stringify({
            command: cmd,
            exists: result.exitCode === 0,
            path: result.exitCode === 0 ? result.stdout.split('\n')[0] : null,
          }, null, 2) }],
        };
      }

      case 'shell_env': {
        const { name: envName } = args as { name: string };

        if (!isSafeEnvVar(envName)) {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              error: `Security: Cannot access sensitive environment variable: ${envName}`,
            }, null, 2) }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({
            name: envName,
            value: process.env[envName] || null,
            exists: envName in process.env,
          }, null, 2) }],
        };
      }

      case 'shell_file_exists': {
        const { path: filePath } = args as { path: string };

        validatePath(filePath);

        let exists = false;
        let type: string | null = null;

        try {
          const stats = fs.statSync(filePath);
          exists = true;
          type = stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : 'other';
        } catch {
          // File doesn't exist
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({
            path: filePath,
            exists,
            type,
          }, null, 2) }],
        };
      }

      case 'shell_read_file': {
        const { path: filePath, encoding = 'utf8', maxSize = 100000 } = args as {
          path: string;
          encoding?: BufferEncoding;
          maxSize?: number;
        };

        validatePath(filePath);

        const stats = fs.statSync(filePath);
        if (!stats.isFile()) {
          throw new Error('Path is not a file');
        }

        const actualMaxSize = Math.min(maxSize, MAX_OUTPUT_SIZE);
        const buffer = Buffer.alloc(actualMaxSize);
        const fd = fs.openSync(filePath, 'r');
        const bytesRead = fs.readSync(fd, buffer, 0, actualMaxSize, 0);
        fs.closeSync(fd);

        const content = buffer.slice(0, bytesRead).toString(encoding);
        const truncated = stats.size > actualMaxSize;

        log('info', 'File read', { path: filePath, size: stats.size, bytesRead, truncated });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            path: filePath,
            content,
            size: stats.size,
            bytesRead,
            truncated,
          }, null, 2) }],
        };
      }

      case 'shell_write_file': {
        const { path: filePath, content, encoding = 'utf8' } = args as {
          path: string;
          content: string;
          encoding?: BufferEncoding;
        };

        validatePath(filePath);

        // Create directory if needed
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, content, { encoding });
        const stats = fs.statSync(filePath);

        log('info', 'File written', { path: filePath, size: stats.size });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            path: filePath,
            size: stats.size,
          }, null, 2) }],
        };
      }

      case 'shell_list_dir': {
        const { path: dirPath, recursive = false, maxDepth = 2 } = args as {
          path: string;
          recursive?: boolean;
          maxDepth?: number;
        };

        validatePath(dirPath);

        const entries = listDirectory(dirPath, recursive, Math.min(maxDepth, 5));

        return {
          content: [{ type: 'text', text: JSON.stringify({
            path: dirPath,
            entries,
            count: entries.length,
          }, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log('error', `Tool failed: ${name}`, { error: errorMessage, durationMs: Date.now() - startTime });
    return {
      content: [{ type: 'text', text: `Shell operation failed: ${errorMessage}` }],
      isError: true,
    };
  }
});

// --- Start server ---
async function main(): Promise<void> {
  log('info', 'Shell MCP Server starting', {
    version: '1.0.0',
    allowedPaths: ALLOWED_PATHS,
    allowedCommands: ALLOWED_COMMANDS,
    forbiddenPatterns: FORBIDDEN_PATTERNS,
    defaultTimeout: DEFAULT_TIMEOUT,
    maxTimeout: MAX_TIMEOUT,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'Server connected via stdio');
}

main().catch((error) => {
  log('error', 'Fatal error', { error: error instanceof Error ? error.message : 'Unknown error' });
  process.exit(1);
});
