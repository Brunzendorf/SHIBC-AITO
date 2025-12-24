#!/usr/bin/env node
/**
 * Git MCP Server for SHIBC CTO
 *
 * Provides secure local git operations with path restrictions and audit logging.
 *
 * Environment Variables:
 * - ALLOWED_PATHS: Comma-separated list of allowed paths (default: /app/workspace/projects)
 * - GIT_AUTHOR_NAME: Git author name (default: SHIBC CTO)
 * - GIT_AUTHOR_EMAIL: Git author email (default: cto@shibaclassic.io)
 * - FORBIDDEN_COMMANDS: Comma-separated forbidden commands (default: push --force,reset --hard)
 *
 * Security:
 * - Path restriction enforced
 * - Dangerous commands blocked
 * - All operations logged
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';

// --- Configuration ---
const ALLOWED_PATHS = (process.env.ALLOWED_PATHS || '/app/workspace/projects').split(',').map(p => p.trim());
const GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || 'SHIBC CTO';
const GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || 'cto@shibaclassic.io';
const FORBIDDEN_PATTERNS = (process.env.FORBIDDEN_COMMANDS || 'push --force,reset --hard,clean -fd,push -f').split(',').map(p => p.trim().toLowerCase());

// --- Logging Helper ---
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: 'git-mcp',
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
function isForbiddenCommand(command: string): boolean {
  const lowerCommand = command.toLowerCase();
  return FORBIDDEN_PATTERNS.some(pattern => lowerCommand.includes(pattern));
}

// --- Git Instance Factory ---
function getGit(baseDir: string): SimpleGit {
  validatePath(baseDir);

  const options: Partial<SimpleGitOptions> = {
    baseDir,
    binary: 'git',
    maxConcurrentProcesses: 1,
    trimmed: true,
  };

  const git = simpleGit(options);

  // Set author for commits
  git.addConfig('user.name', GIT_AUTHOR_NAME);
  git.addConfig('user.email', GIT_AUTHOR_EMAIL);

  return git;
}

// --- Create MCP Server ---
const server = new Server(
  {
    name: 'git-mcp',
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
        name: 'git_clone',
        description: 'Clone a git repository to a local path',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Repository URL (https or ssh)' },
            path: { type: 'string', description: 'Local path to clone to' },
            branch: { type: 'string', description: 'Branch to clone (optional)' },
            depth: { type: 'number', description: 'Shallow clone depth (optional)' },
          },
          required: ['url', 'path']
        }
      },
      {
        name: 'git_status',
        description: 'Get the status of a git repository',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' },
          },
          required: ['path']
        }
      },
      {
        name: 'git_add',
        description: 'Stage files for commit',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Files to stage (use ["."] for all)'
            },
          },
          required: ['path', 'files']
        }
      },
      {
        name: 'git_commit',
        description: 'Create a commit with staged changes',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' },
            message: { type: 'string', description: 'Commit message (conventional commits format)' },
          },
          required: ['path', 'message']
        }
      },
      {
        name: 'git_push',
        description: 'Push commits to remote repository',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' },
            remote: { type: 'string', description: 'Remote name (default: origin)' },
            branch: { type: 'string', description: 'Branch to push (default: current)' },
            setUpstream: { type: 'boolean', description: 'Set upstream tracking (-u flag)' },
          },
          required: ['path']
        }
      },
      {
        name: 'git_pull',
        description: 'Pull changes from remote repository',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' },
            remote: { type: 'string', description: 'Remote name (default: origin)' },
            branch: { type: 'string', description: 'Branch to pull (default: current)' },
            rebase: { type: 'boolean', description: 'Use rebase instead of merge' },
          },
          required: ['path']
        }
      },
      {
        name: 'git_branch',
        description: 'List, create, or switch branches',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' },
            action: { type: 'string', enum: ['list', 'create', 'switch', 'delete'], description: 'Action to perform' },
            name: { type: 'string', description: 'Branch name (for create/switch/delete)' },
          },
          required: ['path', 'action']
        }
      },
      {
        name: 'git_log',
        description: 'Get commit history',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' },
            limit: { type: 'number', description: 'Number of commits to show (default: 10)' },
            file: { type: 'string', description: 'Filter by file path (optional)' },
          },
          required: ['path']
        }
      },
      {
        name: 'git_diff',
        description: 'Show changes between commits or working tree',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' },
            staged: { type: 'boolean', description: 'Show staged changes only' },
            file: { type: 'string', description: 'Specific file to diff (optional)' },
          },
          required: ['path']
        }
      },
      {
        name: 'git_stash',
        description: 'Stash or restore changes',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' },
            action: { type: 'string', enum: ['push', 'pop', 'list', 'drop'], description: 'Stash action' },
            message: { type: 'string', description: 'Stash message (for push)' },
          },
          required: ['path', 'action']
        }
      },
      {
        name: 'git_merge',
        description: 'Merge a branch into current branch',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' },
            branch: { type: 'string', description: 'Branch to merge' },
            noFastForward: { type: 'boolean', description: 'Create merge commit even if fast-forward possible' },
          },
          required: ['path', 'branch']
        }
      },
      {
        name: 'git_init',
        description: 'Initialize a new git repository',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to initialize' },
            defaultBranch: { type: 'string', description: 'Default branch name (default: main)' },
          },
          required: ['path']
        }
      },
      {
        name: 'git_remote',
        description: 'Manage remote repositories',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' },
            action: { type: 'string', enum: ['list', 'add', 'remove'], description: 'Action to perform' },
            name: { type: 'string', description: 'Remote name (for add/remove)' },
            url: { type: 'string', description: 'Remote URL (for add)' },
          },
          required: ['path', 'action']
        }
      },
    ],
  };
});

// --- Handle tool calls ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  log('info', `Tool called: ${name}`, { tool: name, args });

  try {
    // Security check for forbidden commands
    const argsStr = JSON.stringify(args || {});
    if (isForbiddenCommand(argsStr)) {
      log('warn', 'Forbidden command blocked', { tool: name, args });
      return {
        content: [{ type: 'text', text: `Security: This operation is forbidden. Blocked patterns: ${FORBIDDEN_PATTERNS.join(', ')}` }],
        isError: true,
      };
    }

    switch (name) {
      case 'git_clone': {
        const { url, path: targetPath, branch, depth } = args as {
          url: string;
          path: string;
          branch?: string;
          depth?: number;
        };

        validatePath(targetPath);

        // Create parent directory if needed
        const parentDir = path.dirname(targetPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        const git = simpleGit();
        const options: string[] = [];
        if (branch) options.push('--branch', branch);
        if (depth) options.push('--depth', String(depth));

        await git.clone(url, targetPath, options);

        // Configure author in cloned repo
        const clonedGit = getGit(targetPath);
        await clonedGit.addConfig('user.name', GIT_AUTHOR_NAME);
        await clonedGit.addConfig('user.email', GIT_AUTHOR_EMAIL);

        log('info', 'Repository cloned', { url, path: targetPath, branch });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'clone',
            url,
            path: targetPath,
            branch: branch || 'default',
          }, null, 2) }],
        };
      }

      case 'git_status': {
        const { path: repoPath } = args as { path: string };
        const git = getGit(repoPath);

        const status = await git.status();

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            current: status.current,
            tracking: status.tracking,
            ahead: status.ahead,
            behind: status.behind,
            staged: status.staged,
            modified: status.modified,
            deleted: status.deleted,
            not_added: status.not_added,
            conflicted: status.conflicted,
            isClean: status.isClean(),
          }, null, 2) }],
        };
      }

      case 'git_add': {
        const { path: repoPath, files } = args as { path: string; files: string[] };
        const git = getGit(repoPath);

        await git.add(files);
        const status = await git.status();

        log('info', 'Files staged', { path: repoPath, files, stagedCount: status.staged.length });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'add',
            files,
            staged: status.staged,
          }, null, 2) }],
        };
      }

      case 'git_commit': {
        const { path: repoPath, message } = args as { path: string; message: string };
        const git = getGit(repoPath);

        const result = await git.commit(message);

        log('info', 'Commit created', {
          path: repoPath,
          commit: result.commit,
          author: GIT_AUTHOR_NAME,
          summary: result.summary
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'commit',
            commit: result.commit,
            branch: result.branch,
            author: `${GIT_AUTHOR_NAME} <${GIT_AUTHOR_EMAIL}>`,
            summary: {
              changes: result.summary.changes,
              insertions: result.summary.insertions,
              deletions: result.summary.deletions,
            },
          }, null, 2) }],
        };
      }

      case 'git_push': {
        const { path: repoPath, remote = 'origin', branch, setUpstream } = args as {
          path: string;
          remote?: string;
          branch?: string;
          setUpstream?: boolean;
        };
        const git = getGit(repoPath);

        const pushOptions: string[] = [];
        if (setUpstream) pushOptions.push('-u');

        const result = await git.push(remote, branch, pushOptions);

        log('info', 'Push completed', { path: repoPath, remote, branch });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'push',
            remote,
            branch: branch || 'current',
            pushed: result.pushed,
          }, null, 2) }],
        };
      }

      case 'git_pull': {
        const { path: repoPath, remote = 'origin', branch, rebase } = args as {
          path: string;
          remote?: string;
          branch?: string;
          rebase?: boolean;
        };
        const git = getGit(repoPath);

        const options: Record<string, null | string> = {};
        if (rebase) options['--rebase'] = null;

        const result = await git.pull(remote, branch, options);

        log('info', 'Pull completed', { path: repoPath, remote, branch, summary: result.summary });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'pull',
            remote,
            branch: branch || 'current',
            summary: result.summary,
            files: result.files,
          }, null, 2) }],
        };
      }

      case 'git_branch': {
        const { path: repoPath, action, name: branchName } = args as {
          path: string;
          action: 'list' | 'create' | 'switch' | 'delete';
          name?: string;
        };
        const git = getGit(repoPath);

        switch (action) {
          case 'list': {
            const branches = await git.branch();
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: true,
                current: branches.current,
                all: branches.all,
                branches: branches.branches,
              }, null, 2) }],
            };
          }
          case 'create': {
            if (!branchName) throw new Error('Branch name required');
            await git.checkoutLocalBranch(branchName);
            log('info', 'Branch created', { path: repoPath, branch: branchName });
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: true,
                action: 'create',
                branch: branchName,
              }, null, 2) }],
            };
          }
          case 'switch': {
            if (!branchName) throw new Error('Branch name required');
            await git.checkout(branchName);
            log('info', 'Branch switched', { path: repoPath, branch: branchName });
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: true,
                action: 'switch',
                branch: branchName,
              }, null, 2) }],
            };
          }
          case 'delete': {
            if (!branchName) throw new Error('Branch name required');
            await git.deleteLocalBranch(branchName);
            log('info', 'Branch deleted', { path: repoPath, branch: branchName });
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: true,
                action: 'delete',
                branch: branchName,
              }, null, 2) }],
            };
          }
        }
        break;
      }

      case 'git_log': {
        const { path: repoPath, limit = 10, file } = args as {
          path: string;
          limit?: number;
          file?: string;
        };
        const git = getGit(repoPath);

        const options = file ? { file, maxCount: limit } : { maxCount: limit };
        const logResult = await git.log(options);

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            total: logResult.total,
            commits: logResult.all.map(c => ({
              hash: c.hash,
              date: c.date,
              message: c.message,
              author_name: c.author_name,
              author_email: c.author_email,
            })),
          }, null, 2) }],
        };
      }

      case 'git_diff': {
        const { path: repoPath, staged, file } = args as {
          path: string;
          staged?: boolean;
          file?: string;
        };
        const git = getGit(repoPath);

        let diff: string;
        if (staged) {
          diff = file ? await git.diff(['--cached', file]) : await git.diff(['--cached']);
        } else {
          diff = file ? await git.diff([file]) : await git.diff();
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            staged: !!staged,
            file: file || 'all',
            diff: diff.slice(0, 10000), // Limit output size
            truncated: diff.length > 10000,
          }, null, 2) }],
        };
      }

      case 'git_stash': {
        const { path: repoPath, action, message } = args as {
          path: string;
          action: 'push' | 'pop' | 'list' | 'drop';
          message?: string;
        };
        const git = getGit(repoPath);

        switch (action) {
          case 'push': {
            const options = message ? ['push', '-m', message] : ['push'];
            await git.stash(options);
            log('info', 'Changes stashed', { path: repoPath, message });
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: true,
                action: 'stash_push',
                message: message || 'WIP',
              }, null, 2) }],
            };
          }
          case 'pop': {
            await git.stash(['pop']);
            log('info', 'Stash popped', { path: repoPath });
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: true,
                action: 'stash_pop',
              }, null, 2) }],
            };
          }
          case 'list': {
            const list = await git.stashList();
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: true,
                action: 'stash_list',
                stashes: list.all,
              }, null, 2) }],
            };
          }
          case 'drop': {
            await git.stash(['drop']);
            log('info', 'Stash dropped', { path: repoPath });
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: true,
                action: 'stash_drop',
              }, null, 2) }],
            };
          }
        }
        break;
      }

      case 'git_merge': {
        const { path: repoPath, branch, noFastForward } = args as {
          path: string;
          branch: string;
          noFastForward?: boolean;
        };
        const git = getGit(repoPath);

        const options = noFastForward ? ['--no-ff'] : [];
        const result = await git.merge([branch, ...options]);

        log('info', 'Merge completed', { path: repoPath, branch, result });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'merge',
            branch,
            result: result.result,
            merges: result.merges,
          }, null, 2) }],
        };
      }

      case 'git_init': {
        const { path: repoPath, defaultBranch = 'main' } = args as {
          path: string;
          defaultBranch?: string;
        };

        validatePath(repoPath);

        if (!fs.existsSync(repoPath)) {
          fs.mkdirSync(repoPath, { recursive: true });
        }

        const git = simpleGit(repoPath);
        await git.init(['--initial-branch', defaultBranch]);
        await git.addConfig('user.name', GIT_AUTHOR_NAME);
        await git.addConfig('user.email', GIT_AUTHOR_EMAIL);

        log('info', 'Repository initialized', { path: repoPath, defaultBranch });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'init',
            path: repoPath,
            defaultBranch,
            author: `${GIT_AUTHOR_NAME} <${GIT_AUTHOR_EMAIL}>`,
          }, null, 2) }],
        };
      }

      case 'git_remote': {
        const { path: repoPath, action, name: remoteName, url } = args as {
          path: string;
          action: 'list' | 'add' | 'remove';
          name?: string;
          url?: string;
        };
        const git = getGit(repoPath);

        switch (action) {
          case 'list': {
            const remotes = await git.getRemotes(true);
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: true,
                remotes: remotes.map(r => ({
                  name: r.name,
                  fetch: r.refs.fetch,
                  push: r.refs.push,
                })),
              }, null, 2) }],
            };
          }
          case 'add': {
            if (!remoteName || !url) throw new Error('Remote name and URL required');
            await git.addRemote(remoteName, url);
            log('info', 'Remote added', { path: repoPath, remote: remoteName, url });
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: true,
                action: 'remote_add',
                name: remoteName,
                url,
              }, null, 2) }],
            };
          }
          case 'remove': {
            if (!remoteName) throw new Error('Remote name required');
            await git.removeRemote(remoteName);
            log('info', 'Remote removed', { path: repoPath, remote: remoteName });
            return {
              content: [{ type: 'text', text: JSON.stringify({
                success: true,
                action: 'remote_remove',
                name: remoteName,
              }, null, 2) }],
            };
          }
        }
        break;
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    // Fallback for unhandled cases
    return {
      content: [{ type: 'text', text: 'Operation completed' }],
    };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log('error', `Tool failed: ${name}`, { error: errorMessage, durationMs: Date.now() - startTime });
    return {
      content: [{ type: 'text', text: `Git operation failed: ${errorMessage}` }],
      isError: true,
    };
  }
});

// --- Start server ---
async function main(): Promise<void> {
  log('info', 'Git MCP Server starting', {
    version: '1.0.0',
    allowedPaths: ALLOWED_PATHS,
    author: `${GIT_AUTHOR_NAME} <${GIT_AUTHOR_EMAIL}>`,
    forbiddenPatterns: FORBIDDEN_PATTERNS,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'Server connected via stdio');
}

main().catch((error) => {
  log('error', 'Fatal error', { error: error instanceof Error ? error.message : 'Unknown error' });
  process.exit(1);
});
