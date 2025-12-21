import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promisify } from 'util';
import type { ExecException } from 'child_process';

// Mock modules before importing workspace
vi.mock('child_process', () => ({
  exec: vi.fn<any, any>(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn<any, any>(),
}));

vi.mock('../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock executeClaudeAgent for PR creation (workspace now uses pr-creator agent)
const mockExecuteClaudeAgent = vi.fn<any, any>();
vi.mock('./claude.js', () => ({
  executeClaudeAgent: mockExecuteClaudeAgent,
}));

vi.mock('../lib/config.js', () => ({
  config: {
    GITHUB_TOKEN: 'ghp_test_token_123',
    PORT: '8080',
    NODE_ENV: 'test',
    POSTGRES_URL: 'postgresql://test',
    REDIS_URL: 'redis://test',
    WORKSPACE_REPO_URL: 'https://github.com/test/repo.git',
    WORKSPACE_BRANCH: 'main',
    WORKSPACE_AUTO_COMMIT: 'true',
    WORKSPACE_USE_PR: 'true',
    WORKSPACE_AUTO_MERGE: 'false',
  },
  workspaceConfig: {
    repoUrl: 'https://github.com/test/repo.git',
    branch: 'main',
    autoCommit: true,
    usePR: true,
    autoMerge: false,
    getAuthenticatedUrl: vi.fn(() => 'https://ghp_test_token_123@github.com/test/repo.git'),
    getRepoSlug: vi.fn(() => 'test/repo'),
  },
}));

describe('Workspace Manager', () => {
  let exec: any;
  let existsSync: any;
  let workspaceModule: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockExecuteClaudeAgent.mockReset();
    const childProcess = await import('child_process');
    const fs = await import('fs');
    exec = childProcess.exec;
    existsSync = fs.existsSync;

    // Mock exec to call callback with success by default
    exec.mockImplementation((cmd: string, options: any, callback: any) => {
      // Handle both (cmd, callback) and (cmd, options, callback) signatures
      const cb = typeof options === 'function' ? options : callback;
      if (cb) {
        process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
      }
      return { stdout: '', stderr: '' };
    });

    // Default existsSync to false
    existsSync.mockReturnValue(false);

    // Import workspace module fresh
    vi.resetModules();
    workspaceModule = await import('./workspace.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initializeWorkspace', () => {
    it('should clone repository when workspace does not exist', async () => {
      existsSync.mockReturnValue(false);

      const result = await workspaceModule.initializeWorkspace('ceo');

      expect(result).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git clone'),
        expect.anything(),
        expect.anything()
      );
    });

    it('should pull latest when workspace already exists', async () => {
      existsSync.mockReturnValue(true);

      const result = await workspaceModule.initializeWorkspace('cmo');

      expect(result).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git fetch origin'),
        expect.anything(),
        expect.anything()
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git pull --rebase'),
        expect.anything(),
        expect.anything()
      );
    });

    it('should configure git user with agent-specific details', async () => {
      existsSync.mockReturnValue(false);

      await workspaceModule.initializeWorkspace('cto');

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git config user.name "CTO Agent"'),
        expect.anything()
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git config user.email "cto@aito.shibaclassic.io"'),
        expect.anything()
      );
    });

    it('should handle clone failure gracefully', async () => {
      existsSync.mockReturnValue(false);

      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git clone')) {
          process.nextTick(() => cb(new Error('Clone failed'), { stdout: '', stderr: 'fatal: repository not found' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.initializeWorkspace('ceo');

      expect(result).toBe(false);
    });

    it('should checkout main branch on init if workspace exists', async () => {
      existsSync.mockReturnValue(true);

      await workspaceModule.initializeWorkspace('dao');

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git checkout main'),
        expect.anything()
      );
    });

    it('should use authenticated URL with GitHub token', async () => {
      existsSync.mockReturnValue(false);

      await workspaceModule.initializeWorkspace('cfo');

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('https://ghp_test_token_123@github.com'),
        expect.anything(),
        expect.anything()
      );
    });

    it('should set up gh CLI auth when GitHub token is available', async () => {
      existsSync.mockReturnValue(false);

      await workspaceModule.initializeWorkspace('cco');

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('gh auth setup-git'),
        expect.anything()
      );
    });
  });

  describe('pullWorkspace', () => {
    it('should fetch and pull with rebase', async () => {
      const result = await workspaceModule.pullWorkspace();

      expect(result.success).toBe(true);
      expect(result.conflicted).toBeUndefined();
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git fetch origin'),
        expect.objectContaining({ timeout: 30000 }),
        expect.anything()
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git pull --rebase origin main'),
        expect.objectContaining({ timeout: 30000 }),
        expect.anything()
      );
    });

    it('should return failure on pull error', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git pull')) {
          process.nextTick(() => cb(new Error('Pull failed'), null));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.pullWorkspace();

      expect(result.success).toBe(false);
      expect(result.conflicted).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should detect and abort conflicts', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git pull')) {
          process.nextTick(() => cb(new Error('CONFLICT (content): Merge conflict in file.ts'), null));
        } else if (cmd.includes('git rebase --abort')) {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.pullWorkspace();

      expect(result.success).toBe(false);
      expect(result.conflicted).toBe(true);
      expect(result.aborted).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git rebase --abort'),
        expect.anything()
      );
    });
  });

  describe('createBranch', () => {
    it('should create feature branch with correct naming', async () => {
      const branchName = await workspaceModule.createBranch('cmo', 5);

      expect(branchName).toMatch(/^feature\/cmo-\d{4}-\d{2}-\d{2}-loop5$/);
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git checkout -b'),
        expect.anything()
      );
    });

    it('should checkout main before creating branch', async () => {
      await workspaceModule.createBranch('cto', 3);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git checkout main'),
        expect.anything()
      );
    });

    it('should pull latest changes before creating branch', async () => {
      await workspaceModule.createBranch('ceo', 1);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git fetch origin'),
        expect.anything(),
        expect.anything()
      );
    });

    it('should throw error on branch creation failure', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git checkout -b')) {
          process.nextTick(() => cb(new Error('Branch already exists'), null));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      await expect(workspaceModule.createBranch('cfo', 2)).rejects.toThrow();
    });
  });

  describe('commitAndCreatePR', () => {
    it('should return early if autoCommit is disabled', async () => {
      const { workspaceConfig } = await import('../lib/config.js');
      workspaceConfig.autoCommit = false;

      const result = await workspaceModule.commitAndCreatePR('ceo', 'Test commit', 1);

      expect(result.success).toBe(true);
      expect(exec).not.toHaveBeenCalledWith(
        expect.stringContaining('git add'),
        expect.anything()
      );

      // Reset for other tests
      workspaceConfig.autoCommit = true;
    });

    it('should return early if no changes to commit', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.commitAndCreatePR('cmo', 'No changes', 1);

      expect(result.success).toBe(true);
      expect(result.filesChanged).toBe(0);
    });

    it('should create branch when usePR is enabled', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file1.ts\n M file2.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'abc123\n', stderr: '' }));
        } else if (cmd.includes('gh pr create')) {
          process.nextTick(() => cb(null, { stdout: 'https://github.com/test/repo/pull/42\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.commitAndCreatePR('cto', 'Add feature', 3);

      expect(result.success).toBe(true);
      expect(result.branchName).toMatch(/^feature\/cto-/);
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git checkout -b'),
        expect.anything()
      );
    });

    it('should stage all changes', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'def456\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      await workspaceModule.commitAndCreatePR('cfo', 'Update files', 2);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git add -A'),
        expect.anything()
      );
    });

    it('should create commit with agent-prefixed message', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'ghi789\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      await workspaceModule.commitAndCreatePR('coo', 'Fix bug', 1);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('[COO] Fix bug'),
        expect.anything()
      );
    });

    it('should push branch to remote', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'jkl012\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.commitAndCreatePR('cco', 'Update docs', 4);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git push -u origin'),
        expect.objectContaining({ timeout: 30000 }),
        expect.anything()
      );
    });

    it('should create PR with correct title via pr-creator agent', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file1.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'mno345\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      // Workspace now uses pr-creator agent for PR creation
      mockExecuteClaudeAgent.mockResolvedValue({
        success: true,
        output: 'PR_CREATED: https://github.com/test/repo/pull/10',
      });

      const result = await workspaceModule.commitAndCreatePR('cmo', 'Add new content strategy', 5);

      // Verify commit message format
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('[CMO] Add new content strategy'),
        expect.anything()
      );
      // Verify pr-creator agent was called
      expect(mockExecuteClaudeAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'pr-creator',
          prompt: expect.stringContaining('Add new content strategy'),
        })
      );
      expect(result.prNumber).toBe(10);
      expect(result.prUrl).toBe('https://github.com/test/repo/pull/10');
    });

    it('should extract PR number from agent output', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'pqr678\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      // Workspace parses PR URL from pr-creator agent output
      mockExecuteClaudeAgent.mockResolvedValue({
        success: true,
        output: 'Done! PR_CREATED: https://github.com/test/repo/pull/99',
      });

      const result = await workspaceModule.commitAndCreatePR('cto', 'Deploy feature', 2);

      expect(result.prNumber).toBe(99);
    });

    it('should switch back to main branch after PR creation', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'stu901\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      await workspaceModule.commitAndCreatePR('dao', 'Governance update', 1);

      // Should checkout main at the end
      const calls = exec.mock.calls;
      const lastCheckoutCall = calls.filter((call: any[]) => call[0].includes('git checkout main')).pop();
      expect(lastCheckoutCall).toBeDefined();
    });

    it('should return filesChanged count', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file1.ts\n M file2.ts\n M file3.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'vwx234\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.commitAndCreatePR('ceo', 'Multiple changes', 3);

      expect(result.filesChanged).toBe(3);
    });

    it('should handle commit failure gracefully', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file.ts\n', stderr: '' }));
        } else if (cmd.includes('git commit')) {
          process.nextTick(() => cb(new Error('Commit failed'), null));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.commitAndCreatePR('cfo', 'Failed commit', 1);

      expect(result.success).toBe(false);
    });

    it('should escape double quotes in commit message', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'yz1234\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      await workspaceModule.commitAndCreatePR('cmo', 'Add "quoted" content', 1);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('[CMO] Add \\"quoted\\" content'),
        expect.anything()
      );
    });
  });

  describe('mergePullRequest', () => {
    it('should merge PR with squash and delete branch', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        process.nextTick(() => cb(null, { stdout: 'Merged\n', stderr: '' }));
      });

      const result = await workspaceModule.mergePullRequest(42);

      expect(result).toBe(true);
      // Command includes GH_TOKEN, --repo flag, PR number and merge options
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('gh pr merge 42'),
        expect.objectContaining({ timeout: 30000 }),
        expect.anything()
      );
    });

    it('should use GitHub token in merge command', async () => {
      const result = await workspaceModule.mergePullRequest(15);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('GH_TOKEN=ghp_test_token_123'),
        expect.anything(),
        expect.anything()
      );
    });

    it('should return false on merge failure', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('gh pr merge')) {
          process.nextTick(() => cb(new Error('Merge conflict'), null));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.mergePullRequest(99);

      expect(result).toBe(false);
    });
  });

  describe('closePullRequest', () => {
    it('should add comment with reason before closing', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
      });

      const result = await workspaceModule.closePullRequest(42, 'Failed RAG review');

      expect(result).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('gh pr comment 42'),
        expect.anything(),
        expect.anything()
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('Failed RAG review'),
        expect.anything(),
        expect.anything()
      );
    });

    it('should close PR after adding comment', async () => {
      const result = await workspaceModule.closePullRequest(15, 'Quality gate failed');

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('gh pr close 15'),
        expect.anything(),
        expect.anything()
      );
    });

    it('should escape double quotes in reason', async () => {
      await workspaceModule.closePullRequest(10, 'Failed: "invalid code"');

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('\\"invalid code\\"'),
        expect.anything(),
        expect.anything()
      );
    });

    it('should return false on close failure', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('gh pr close')) {
          process.nextTick(() => cb(new Error('Close failed'), null));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.closePullRequest(99, 'Test reason');

      expect(result).toBe(false);
    });
  });

  describe('commitAndPush', () => {
    it('should delegate to commitAndCreatePR when usePR is enabled', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'abc789\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.commitAndPush('ceo', 'Test message');

      expect(result.success).toBe(true);
      expect(result.commitHash).toBe('abc789');
    });

    it('should push directly to main when usePR is disabled', async () => {
      const { workspaceConfig } = await import('../lib/config.js');
      workspaceConfig.usePR = false;

      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'def123\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.commitAndPush('cmo', 'Direct push');

      expect(result.success).toBe(true);
      expect(result.commitHash).toBe('def123');
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git push'),
        expect.objectContaining({ timeout: 30000 }),
        expect.anything()
      );

      // Reset for other tests
      workspaceConfig.usePR = true;
    });

    it('should return early if autoCommit is disabled (direct push)', async () => {
      const { workspaceConfig } = await import('../lib/config.js');
      workspaceConfig.autoCommit = false;
      workspaceConfig.usePR = false;

      const result = await workspaceModule.commitAndPush('cto', 'Skipped');

      expect(result.success).toBe(true);
      expect(exec).not.toHaveBeenCalledWith(
        expect.stringContaining('git add'),
        expect.anything()
      );

      // Reset for other tests
      workspaceConfig.autoCommit = true;
      workspaceConfig.usePR = true;
    });

    it('should handle no changes in direct push mode', async () => {
      const { workspaceConfig } = await import('../lib/config.js');
      workspaceConfig.usePR = false;

      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.commitAndPush('cfo', 'No changes');

      expect(result.success).toBe(true);
      expect(result.filesChanged).toBe(0);

      // Reset for other tests
      workspaceConfig.usePR = true;
    });

    it('should handle push failure in direct mode', async () => {
      const { workspaceConfig } = await import('../lib/config.js');
      workspaceConfig.usePR = false;

      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file.ts\n', stderr: '' }));
        } else if (cmd.includes('git push')) {
          process.nextTick(() => cb(new Error('Push rejected'), null));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.commitAndPush('coo', 'Failed push');

      expect(result.success).toBe(false);

      // Reset for other tests
      workspaceConfig.usePR = true;
    });
  });

  describe('getChangedFiles', () => {
    it('should return list of changed files', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          // Git status porcelain format: XY<space>filename (2 chars for XY status, 1 space, then filename)
          // Example: " M file.ts" means modified in work tree, "M  file.ts" means modified in index
          process.nextTick(() => cb(null, { stdout: 'M  src/file1.ts\n M src/file2.ts\nA  src/new.ts', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const files = await workspaceModule.getChangedFiles();

      expect(files).toEqual(['src/file1.ts', 'src/file2.ts', 'src/new.ts']);
    });

    it('should return empty array when no changes', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const files = await workspaceModule.getChangedFiles();

      expect(files).toEqual([]);
    });

    it('should return empty array on error', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(new Error('Git error'), null));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const files = await workspaceModule.getChangedFiles();

      expect(files).toEqual([]);
    });

    it('should filter out empty lines', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          // Git status porcelain format: XY<space>filename (2 chars for XY status, 1 space, then filename)
          // Testing with an empty line in the middle
          process.nextTick(() => cb(null, { stdout: 'M  file1.ts\n\n M file2.ts', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const files = await workspaceModule.getChangedFiles();

      expect(files).toEqual(['file1.ts', 'file2.ts']);
      expect(files.length).toBe(2);
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should return true when there are uncommitted changes', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file.ts\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const hasChanges = await workspaceModule.hasUncommittedChanges();

      expect(hasChanges).toBe(true);
    });

    it('should return false when there are no uncommitted changes', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const hasChanges = await workspaceModule.hasUncommittedChanges();

      expect(hasChanges).toBe(false);
    });

    it('should return false on error', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(new Error('Git error'), null));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const hasChanges = await workspaceModule.hasUncommittedChanges();

      expect(hasChanges).toBe(false);
    });
  });

  describe('workspace export', () => {
    it('should export workspace object with all methods', async () => {
      expect(workspaceModule.workspace).toBeDefined();
      expect(typeof workspaceModule.workspace.initialize).toBe('function');
      expect(typeof workspaceModule.workspace.pull).toBe('function');
      expect(typeof workspaceModule.workspace.createBranch).toBe('function');
      expect(typeof workspaceModule.workspace.commitAndPush).toBe('function');
      expect(typeof workspaceModule.workspace.commitAndCreatePR).toBe('function');
      expect(typeof workspaceModule.workspace.mergePullRequest).toBe('function');
      expect(typeof workspaceModule.workspace.closePullRequest).toBe('function');
      expect(typeof workspaceModule.workspace.getChangedFiles).toBe('function');
      expect(typeof workspaceModule.workspace.hasUncommittedChanges).toBe('function');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle git commands with timeout', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git clone') || cmd.includes('git pull') || cmd.includes('git push')) {
          expect(options.timeout).toBeDefined();
        }
        process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
      });

      await workspaceModule.initializeWorkspace('ceo');
      await workspaceModule.pullWorkspace();
    });

    it('should handle stderr warnings during clone', async () => {
      existsSync.mockReturnValue(false);

      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git clone')) {
          process.nextTick(() => cb(null, { stdout: '', stderr: 'Cloning into /app/workspace...\n' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.initializeWorkspace('cto');

      expect(result).toBe(true);
    });

    it('should log warning for unexpected stderr during clone', async () => {
      existsSync.mockReturnValue(false);

      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git clone')) {
          process.nextTick(() => cb(null, { stdout: '', stderr: 'Warning: some unexpected message\n' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.initializeWorkspace('dao');

      expect(result).toBe(true);
    });

    it('should handle gh auth setup-git failure gracefully', async () => {
      existsSync.mockReturnValue(false);

      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('gh auth setup-git')) {
          process.nextTick(() => cb(new Error('gh not found'), null));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.initializeWorkspace('cfo');

      expect(result).toBe(true);
    });

    it('should handle errors as Error instances', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        const error: ExecException = new Error('Command failed');
        error.code = 1;
        process.nextTick(() => cb(error, null));
      });

      const result = await workspaceModule.pullWorkspace();

      expect(result.success).toBe(false);
    });

    it('should handle non-Error exceptions', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        process.nextTick(() => cb('String error', null));
      });

      const result = await workspaceModule.pullWorkspace();

      expect(result.success).toBe(false);
    });

    it('should handle very long commit messages', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'abc123\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const longMessage = 'A'.repeat(200);
      const result = await workspaceModule.commitAndCreatePR('cmo', longMessage, 1);

      expect(result.success).toBe(true);
    });

    it('should handle PR creation when gh CLI is not available', async () => {
      const { config } = await import('../lib/config.js');
      const originalToken = config.GITHUB_TOKEN;
      config.GITHUB_TOKEN = undefined;

      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: ' M file.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'abc123\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.commitAndCreatePR('cto', 'Test', 1);

      expect(result.success).toBe(true);
      expect(result.prNumber).toBeUndefined();

      // Reset
      config.GITHUB_TOKEN = originalToken;
    });

    it('should handle PR URL without PR number', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: 'M  file.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'abc123\n', stderr: '' }));
        } else if (cmd.includes('gh pr create')) {
          process.nextTick(() => cb(null, { stdout: 'https://github.com/test/repo\n', stderr: '' }));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.commitAndCreatePR('cfo', 'Test', 1);

      expect(result.prNumber).toBeUndefined();
    });

    it('should handle PR creation failure', async () => {
      exec.mockImplementation((cmd: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        if (cmd.includes('git status --porcelain')) {
          process.nextTick(() => cb(null, { stdout: 'M  file.ts\n', stderr: '' }));
        } else if (cmd.includes('git rev-parse --short HEAD')) {
          process.nextTick(() => cb(null, { stdout: 'abc123\n', stderr: '' }));
        } else if (cmd.includes('gh pr create')) {
          process.nextTick(() => cb(new Error('PR creation failed'), null));
        } else {
          process.nextTick(() => cb(null, { stdout: '', stderr: '' }));
        }
      });

      const result = await workspaceModule.commitAndCreatePR('cto', 'Test PR failure', 1);

      // Should still succeed with commit, just no PR created
      expect(result.success).toBe(true);
      expect(result.prNumber).toBeUndefined();
    });

    it('should handle unknown agent types with default naming', async () => {
      existsSync.mockReturnValue(false);

      await workspaceModule.initializeWorkspace('unknown');

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git config user.name "UNKNOWN Agent"'),
        expect.anything()
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('git config user.email "unknown@aito.shibaclassic.io"'),
        expect.anything()
      );
    });
  });
});
