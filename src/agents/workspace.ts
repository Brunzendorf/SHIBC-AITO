/**
 * Workspace Git Manager
 * Handles git operations for agent workspace persistence
 * Supports Branch+PR workflow for quality gate
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { createLogger } from '../lib/logger.js';
import { config, workspaceConfig } from '../lib/config.js';
import { executeClaudeAgent } from './claude.js';

const execAsync = promisify(exec);
const logger = createLogger('workspace');

const WORKSPACE_PATH = '/app/workspace';

/**
 * Mask sensitive tokens in strings to prevent log exposure
 * Masks GitHub tokens (ghp_*, gho_*, github_pat_*) and generic secrets
 */
function maskSensitiveData(input: string): string {
  return input
    // GitHub tokens: ghp_, gho_, github_pat_
    .replace(/ghp_[a-zA-Z0-9]{36,}/g, 'ghp_***REDACTED***')
    .replace(/gho_[a-zA-Z0-9]{36,}/g, 'gho_***REDACTED***')
    .replace(/github_pat_[a-zA-Z0-9_]{20,}/g, 'github_pat_***REDACTED***')
    // Generic token patterns in URLs
    .replace(/(https?:\/\/)[^@\s]+@/g, '$1***TOKEN***@')
    // GH_TOKEN=xxx patterns
    .replace(/GH_TOKEN=[^\s]+/g, 'GH_TOKEN=***REDACTED***')
    .replace(/GITHUB_TOKEN=[^\s]+/g, 'GITHUB_TOKEN=***REDACTED***');
}

/**
 * Initialize workspace by cloning git repository
 * Called on agent startup
 */
export async function initializeWorkspace(agentType: string): Promise<boolean> {
  try {
    // Check if workspace already exists with .git
    if (existsSync(`${WORKSPACE_PATH}/.git`)) {
      logger.info('Workspace already initialized, pulling latest...');
      // Configure authentication for existing workspace
      await configureRemoteAuth();
      await configureGitUser(agentType);

      // Pull with conflict handling
      const pullResult = await pullWorkspace();
      if (!pullResult.success) {
        if (pullResult.conflicted) {
          logger.warn({ error: pullResult.error, aborted: pullResult.aborted },
            'Workspace pull had conflicts - starting fresh from remote');
          // Reset to remote state if conflicts couldn't be resolved
          try {
            await execAsync(`cd ${WORKSPACE_PATH} && git fetch origin`);
            await execAsync(`cd ${WORKSPACE_PATH} && git reset --hard origin/${workspaceConfig.branch}`);
            logger.info('Workspace reset to remote state after conflict');
          } catch (resetError) {
            const errMsg = resetError instanceof Error ? resetError.message : String(resetError);
            logger.error({ error: maskSensitiveData(errMsg) }, 'Failed to reset workspace after conflict');
            return false;
          }
        } else {
          logger.warn({ error: pullResult.error }, 'Workspace pull failed - continuing with existing state');
          // Non-conflict failures (network, etc.) - continue with existing state
        }
      }

      // Always switch back to main branch on init
      await execAsync(`cd ${WORKSPACE_PATH} && git checkout ${workspaceConfig.branch}`).catch(() => {});
      return true;
    }

    // Clone repository
    const repoUrl = workspaceConfig.getAuthenticatedUrl();
    logger.info({ repo: workspaceConfig.repoUrl, branch: workspaceConfig.branch }, 'Cloning workspace repository...');

    // Remove existing workspace content (if any without .git)
    await execAsync(`rm -rf ${WORKSPACE_PATH}/*`).catch(() => {});

    // Clone into workspace directory
    const { stderr } = await execAsync(
      `git clone --branch ${workspaceConfig.branch} --single-branch ${repoUrl} ${WORKSPACE_PATH}`,
      { timeout: 60000 }
    );

    if (stderr && !stderr.includes('Cloning into')) {
      logger.warn({ stderr }, 'Git clone warning');
    }

    // Configure git user for commits
    await configureGitUser(agentType);

    // Configure remote URL with authentication (clone URL may not persist token)
    await configureRemoteAuth();

    // Configure gh CLI auth via GITHUB_TOKEN
    if (config.GITHUB_TOKEN) {
      await execAsync(`cd ${WORKSPACE_PATH} && gh auth setup-git`).catch(() => {
        logger.debug('gh auth setup-git failed, using token directly');
      });
    }

    logger.info('Workspace initialized successfully');
    return true;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: maskSensitiveData(errMsg) }, 'Failed to initialize workspace');

    // Create empty workspace directory if clone failed
    await execAsync(`mkdir -p ${WORKSPACE_PATH}`).catch(() => {});
    return false;
  }
}

/**
 * Configure git user based on agent type
 */
async function configureGitUser(agentType: string): Promise<void> {
  const agentNames: Record<string, string> = {
    ceo: 'CEO Agent',
    dao: 'DAO Agent',
    cmo: 'CMO Agent',
    cto: 'CTO Agent',
    cfo: 'CFO Agent',
    coo: 'COO Agent',
    cco: 'CCO Agent',
  };

  const name = agentNames[agentType] || `${agentType.toUpperCase()} Agent`;
  const email = `${agentType}@aito.shibaclassic.io`;

  await execAsync(`cd ${WORKSPACE_PATH} && git config user.name "${name}"`);
  await execAsync(`cd ${WORKSPACE_PATH} && git config user.email "${email}"`);

  logger.debug({ name, email }, 'Git user configured');
}

/**
 * Configure remote URL with authentication token
 * This is necessary because git clone stores the plain URL,
 * and interactive credential prompts don't work in containers
 */
async function configureRemoteAuth(): Promise<void> {
  if (!config.GITHUB_TOKEN) {
    logger.debug('No GITHUB_TOKEN, skipping remote auth configuration');
    return;
  }

  try {
    const authenticatedUrl = workspaceConfig.getAuthenticatedUrl();
    await execAsync(`cd ${WORKSPACE_PATH} && git remote set-url origin "${authenticatedUrl}"`);
    logger.debug('Remote URL configured with authentication');
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: maskSensitiveData(errMsg) }, 'Failed to configure remote auth');
  }
}

/**
 * Result of a pull operation
 */
export interface PullResult {
  success: boolean;
  error?: string;
  conflicted?: boolean;
  aborted?: boolean;
}

/**
 * Pull latest changes from remote
 * Properly handles conflicts by aborting and returning structured result
 */
export async function pullWorkspace(): Promise<PullResult> {
  try {
    await execAsync(`cd ${WORKSPACE_PATH} && git fetch origin`, { timeout: 30000 });
    await execAsync(`cd ${WORKSPACE_PATH} && git pull --rebase origin ${workspaceConfig.branch}`, { timeout: 30000 });
    logger.debug('Workspace pull completed');
    return { success: true };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const maskedError = maskSensitiveData(errMsg);

    // Check for conflict indicators
    const isConflict = errMsg.includes('CONFLICT') ||
                       errMsg.includes('conflict') ||
                       errMsg.includes('Merge conflict') ||
                       errMsg.includes('could not apply') ||
                       errMsg.includes('Failed to merge');

    // Check for rebase in progress
    const isRebaseConflict = errMsg.includes('rebase') ||
                             errMsg.includes('Cannot pull with rebase');

    if (isConflict || isRebaseConflict) {
      logger.warn({ error: maskedError }, 'Pull conflict detected, aborting...');

      // Try to abort rebase first (since we use --rebase)
      try {
        await execAsync(`cd ${WORKSPACE_PATH} && git rebase --abort`);
        logger.info('Rebase aborted successfully');
        return {
          success: false,
          error: 'Merge conflict detected - rebase aborted',
          conflicted: true,
          aborted: true
        };
      } catch {
        // Rebase abort failed, try merge abort
        try {
          await execAsync(`cd ${WORKSPACE_PATH} && git merge --abort`);
          logger.info('Merge aborted successfully');
          return {
            success: false,
            error: 'Merge conflict detected - merge aborted',
            conflicted: true,
            aborted: true
          };
        } catch {
          // Neither worked, might not be in conflict state
          logger.warn('Could not abort rebase or merge - may need manual intervention');
          return {
            success: false,
            error: 'Conflict detected but could not abort automatically',
            conflicted: true,
            aborted: false
          };
        }
      }
    }

    // Non-conflict error (network, auth, etc.)
    logger.warn({ error: maskedError }, 'Failed to pull workspace');
    return {
      success: false,
      error: maskedError,
      conflicted: false
    };
  }
}

/**
 * Create feature branch for PR workflow
 */
export async function createBranch(agentType: string, loopNumber: number): Promise<string> {
  const timestamp = new Date().toISOString().slice(0, 10); // 2024-12-11
  const branchName = `feature/${agentType}-${timestamp}-loop${loopNumber}`;

  try {
    // Stash any uncommitted changes from other agents before checkout
    // Use --include-untracked to also stash untracked files
    let hadStash = false;
    try {
      const { stdout: stashResult } = await execAsync(
        `cd ${WORKSPACE_PATH} && git stash push --include-untracked -m "auto-stash-${agentType}"`
      );
      hadStash = !stashResult.includes('No local changes to save');
      if (hadStash) {
        logger.info({ agentType }, 'Stashed uncommitted changes');
      }
    } catch (stashErr) {
      // Stash failed, try without untracked files
      logger.warn({ error: stashErr }, 'Stash with untracked failed, trying without');
      try {
        const { stdout: stashResult } = await execAsync(
          `cd ${WORKSPACE_PATH} && git stash push -m "auto-stash-${agentType}"`
        );
        hadStash = !stashResult.includes('No local changes to save');
      } catch {
        // Stash completely failed, continue anyway
      }
    }

    // Ensure we're on main and up to date
    try {
      await execAsync(`cd ${WORKSPACE_PATH} && git checkout ${workspaceConfig.branch}`);
    } catch {
      // May already be on main or have conflicts - continue
      logger.warn('Could not checkout main, continuing on current branch');
    }

    // Pull with conflict handling
    const pullResult = await pullWorkspace();
    if (!pullResult.success) {
      if (pullResult.conflicted) {
        logger.error({ error: pullResult.error, aborted: pullResult.aborted },
          'Cannot create branch - workspace has conflicts');
        throw new Error(`Pull conflict before branch creation: ${pullResult.error}`);
      }
      // Non-conflict error - log warning but continue (might be network issue)
      logger.warn({ error: pullResult.error }, 'Pull failed before branch creation, continuing with current state');
    }

    // Create and checkout new branch
    await execAsync(`cd ${WORKSPACE_PATH} && git checkout -b ${branchName}`);
    logger.info({ branchName }, 'Created feature branch');

    // Restore stashed changes if any
    if (hadStash) {
      try {
        await execAsync(`cd ${WORKSPACE_PATH} && git stash pop`);
        logger.info('Restored stashed changes');
      } catch {
        // Stash pop may fail on conflicts, leave in stash
        logger.warn('Could not restore stashed changes, left in stash');
      }
    }

    return branchName;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: maskSensitiveData(errMsg) }, 'Failed to create branch');
    throw error;
  }
}

/**
 * Commit changes and create PR (Branch+PR workflow)
 * Returns PR info for orchestrator to review
 * @param category - 'status' (auto-merge), 'content' (clevel review), 'strategic' (CEO review)
 */
export async function commitAndCreatePR(
  agentType: string,
  message: string,
  loopNumber: number,
  category: 'status' | 'content' | 'strategic' = 'content'
): Promise<{
  success: boolean;
  branchName?: string;
  commitHash?: string;
  prNumber?: number;
  prUrl?: string;
  filesChanged?: number;
  category?: 'status' | 'content' | 'strategic';
}> {
  if (!workspaceConfig.autoCommit) {
    logger.debug('Auto-commit disabled, skipping');
    return { success: true };
  }

  try {
    // Check for changes
    const { stdout: status } = await execAsync(`cd ${WORKSPACE_PATH} && git status --porcelain`);

    if (!status.trim()) {
      logger.debug('No changes to commit');
      return { success: true, filesChanged: 0 };
    }

    const filesChanged = status.trim().split('\n').length;
    const changedFiles = await getChangedFiles();

    // Create branch if PR workflow enabled AND we have GitHub auth
    // Without GITHUB_TOKEN, push won't work so skip branch creation
    let branchName = workspaceConfig.branch;
    const canUsePR = workspaceConfig.usePR && config.GITHUB_TOKEN;
    if (canUsePR) {
      branchName = await createBranch(agentType, loopNumber);
    }

    logger.info({ filesChanged, branchName }, 'Committing workspace changes...');

    // Stage all changes
    await execAsync(`cd ${WORKSPACE_PATH} && git add -A`);

    // Commit with agent-specific message
    const commitMessage = `[${agentType.toUpperCase()}] ${message}`;
    await execAsync(`cd ${WORKSPACE_PATH} && git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);

    // Get commit hash
    const { stdout: hash } = await execAsync(`cd ${WORKSPACE_PATH} && git rev-parse --short HEAD`);
    const commitHash = hash.trim();

    // Try to push branch
    let pushSucceeded = false;
    try {
      const { stderr: pushStderr } = await execAsync(`cd ${WORKSPACE_PATH} && git push -u origin ${branchName}`, { timeout: 30000 });
      pushSucceeded = true;
      logger.info({ branchName }, 'Branch pushed to remote successfully');
      if (pushStderr && !pushStderr.includes('To https://') && !pushStderr.includes('new branch')) {
        logger.debug({ stderr: pushStderr }, 'Push stderr (informational)');
      }
    } catch (pushError) {
      const pushErrMsg = pushError instanceof Error ? pushError.message : String(pushError);
      logger.error({ error: pushErrMsg, branchName }, 'Failed to push branch to remote - PR workflow blocked');
      // Re-configure auth and retry once
      await configureRemoteAuth();
      try {
        await execAsync(`cd ${WORKSPACE_PATH} && git push -u origin ${branchName}`, { timeout: 30000 });
        pushSucceeded = true;
        logger.info({ branchName }, 'Branch pushed on retry after auth reconfiguration');
      } catch (retryError) {
        const retryErrMsg = retryError instanceof Error ? retryError.message : String(retryError);
        logger.error({ error: retryErrMsg, branchName }, 'Push retry also failed - commit saved locally only');
      }
    }

    // Create PR if push succeeded and PR workflow enabled
    let prNumber: number | undefined;
    let prUrl: string | undefined;

    if (pushSucceeded && workspaceConfig.usePR && config.GITHUB_TOKEN) {
      const prResult = await createPullRequest(agentType, message, changedFiles, branchName);
      prNumber = prResult.prNumber;
      prUrl = prResult.prUrl;
    }

    logger.info({ commitHash, filesChanged, branchName, prNumber, pushSucceeded, category }, 'Workspace changes committed');

    // Switch back to main only if we created a feature branch
    if (canUsePR && branchName !== workspaceConfig.branch) {
      try {
        await execAsync(`cd ${WORKSPACE_PATH} && git checkout ${workspaceConfig.branch}`);
      } catch (checkoutError) {
        // May fail if there are uncommitted changes from other agents
        logger.warn({ error: checkoutError }, 'Failed to switch back to main branch');
      }
    }

    // Return success even if push failed - local commit succeeded
    // RAG indexing will happen via workspace_update event (no prNumber = no PR workflow)
    return { success: true, branchName, commitHash, prNumber, prUrl, filesChanged, category };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: maskSensitiveData(errMsg) }, 'Failed to commit/create PR');
    return { success: false };
  }
}

/**
 * Create Pull Request using pr-creator Claude Agent
 * Uses .claude/agents/pr-creator.md for git workflow
 */
async function createPullRequest(
  agentType: string,
  summary: string,
  changedFiles: string[],
  branchName: string
): Promise<{ prNumber?: number; prUrl?: string }> {
  try {
    // Prepare prompt for pr-creator agent
    const prompt = `Create PR for changes in ${WORKSPACE_PATH}
Agent: ${agentType}
Summary: ${summary}
Branch: ${branchName}
Files: ${changedFiles.join(', ')}`;

    logger.info({ agentType, branchName, filesCount: changedFiles.length }, 'Invoking pr-creator agent');

    const result = await executeClaudeAgent({
      agent: 'pr-creator',
      prompt,
      timeout: 60000,
      cwd: WORKSPACE_PATH,
    });

    if (!result.success) {
      logger.error({ error: result.error }, 'pr-creator agent failed');
      return {};
    }

    // Parse PR URL from agent output
    // Expected format: PR_CREATED: https://github.com/.../pull/123
    const prUrlMatch = result.output.match(/PR_CREATED:\s*(https:\/\/github\.com\/[^\s]+\/pull\/(\d+))/);
    if (prUrlMatch) {
      const prUrl = prUrlMatch[1];
      const prNumber = parseInt(prUrlMatch[2], 10);
      logger.info({ prNumber, prUrl }, 'Pull request created via pr-creator agent');
      return { prNumber, prUrl };
    }

    // Fallback: try to find any GitHub PR URL
    const fallbackMatch = result.output.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
    if (fallbackMatch) {
      const prUrl = fallbackMatch[0];
      const prNumber = parseInt(fallbackMatch[1], 10);
      logger.info({ prNumber, prUrl }, 'Pull request created (fallback parse)');
      return { prNumber, prUrl };
    }

    // Check for NO_CHANGES response
    if (result.output.includes('NO_CHANGES')) {
      logger.info('pr-creator: No changes to commit');
      return {};
    }

    logger.warn({ output: result.output.slice(0, 500) }, 'Could not parse PR URL from pr-creator output');
    return {};
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: maskSensitiveData(errMsg) }, 'Failed to create PR via pr-creator agent');
    return {};
  }
}

/**
 * Merge PR after approval (called by orchestrator after RAG review)
 * Uses --repo flag so it works from orchestrator (no workspace needed)
 */
export async function mergePullRequest(prNumber: number): Promise<boolean> {
  try {
    const repoSlug = workspaceConfig.repoUrl.replace('https://github.com/', '').replace('.git', '');
    await execAsync(
      `GH_TOKEN=${config.GITHUB_TOKEN} gh pr merge ${prNumber} --repo ${repoSlug} --squash --delete-branch`,
      { timeout: 30000 }
    );
    logger.info({ prNumber }, 'Pull request merged');
    return true;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: maskSensitiveData(errMsg), prNumber }, 'Failed to merge PR');
    return false;
  }
}

/**
 * Close PR with comment (called when RAG review fails)
 * Uses --repo flag so it works from orchestrator (no workspace needed)
 */
export async function closePullRequest(prNumber: number, reason: string): Promise<boolean> {
  try {
    const repoSlug = workspaceConfig.repoUrl.replace('https://github.com/', '').replace('.git', '');

    // Add comment with reason
    await execAsync(
      `GH_TOKEN=${config.GITHUB_TOKEN} gh pr comment ${prNumber} --repo ${repoSlug} --body "RAG Quality Review Failed:\n\n${reason.replace(/"/g, '\\"')}"`,
      { timeout: 30000 }
    );

    // Close PR
    await execAsync(
      `GH_TOKEN=${config.GITHUB_TOKEN} gh pr close ${prNumber} --repo ${repoSlug}`,
      { timeout: 30000 }
    );

    logger.info({ prNumber }, 'Pull request closed');
    return true;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: maskSensitiveData(errMsg), prNumber }, 'Failed to close PR');
    return false;
  }
}

/**
 * Direct push to main branch (bypasses PR workflow)
 * Used when WORKSPACE_SKIP_PR=true to save tokens
 * Pulls latest, commits all changes, pushes directly
 */
export async function commitAndPushDirect(
  agentType: string,
  message: string
): Promise<{ success: boolean; commitHash?: string; filesChanged?: number }> {
  if (!workspaceConfig.autoCommit) {
    logger.debug('Auto-commit disabled, skipping');
    return { success: true };
  }

  try {
    // Ensure we're on main branch
    await execAsync(`cd ${WORKSPACE_PATH} && git checkout ${workspaceConfig.branch}`).catch(() => {});

    // Pull latest changes first with conflict handling
    const pullResult = await pullWorkspace();
    if (!pullResult.success) {
      if (pullResult.conflicted) {
        logger.error({ error: pullResult.error, aborted: pullResult.aborted },
          'Cannot commit - workspace has conflicts after pull');
        return { success: false };
      }
      // Non-conflict error - log warning but try to continue
      logger.warn({ error: pullResult.error }, 'Pull failed before direct commit, continuing with local state');
    }

    // Check for changes after pull
    const { stdout: status } = await execAsync(`cd ${WORKSPACE_PATH} && git status --porcelain`);

    if (!status.trim()) {
      logger.debug('No changes to commit');
      return { success: true, filesChanged: 0 };
    }

    const filesChanged = status.trim().split('\n').length;
    logger.info({ filesChanged, branch: workspaceConfig.branch }, 'Committing workspace changes (direct push, bypassing PR)...');

    // Stage all changes
    await execAsync(`cd ${WORKSPACE_PATH} && git add -A`);

    // Commit with agent-specific message
    const commitMessage = `[${agentType.toUpperCase()}] ${message}`;
    await execAsync(`cd ${WORKSPACE_PATH} && git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);

    // Get commit hash
    const { stdout: hash } = await execAsync(`cd ${WORKSPACE_PATH} && git rev-parse --short HEAD`);
    const commitHash = hash.trim();

    // Push directly to main
    await execAsync(`cd ${WORKSPACE_PATH} && git push origin ${workspaceConfig.branch}`, { timeout: 30000 });
    logger.info({ commitHash, filesChanged, branch: workspaceConfig.branch }, 'Workspace changes pushed directly (PR bypassed)');

    return { success: true, commitHash, filesChanged };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: maskSensitiveData(errMsg) }, 'Failed to commit/push workspace directly');
    return { success: false };
  }
}

/**
 * Legacy: Commit and push directly to main (no PR)
 * Use commitAndCreatePR for quality gate workflow
 */
export async function commitAndPush(
  agentType: string,
  message: string
): Promise<{ success: boolean; commitHash?: string; filesChanged?: number }> {
  // If PR workflow enabled, delegate to commitAndCreatePR
  if (workspaceConfig.usePR) {
    const result = await commitAndCreatePR(agentType, message, 0);
    return {
      success: result.success,
      commitHash: result.commitHash,
      filesChanged: result.filesChanged,
    };
  }

  // Direct push workflow (legacy)
  if (!workspaceConfig.autoCommit) {
    logger.debug('Auto-commit disabled, skipping');
    return { success: true };
  }

  try {
    const { stdout: status } = await execAsync(`cd ${WORKSPACE_PATH} && git status --porcelain`);

    if (!status.trim()) {
      logger.debug('No changes to commit');
      return { success: true, filesChanged: 0 };
    }

    const filesChanged = status.trim().split('\n').length;
    logger.info({ filesChanged }, 'Committing workspace changes (direct push)...');

    await execAsync(`cd ${WORKSPACE_PATH} && git add -A`);

    const commitMessage = `[${agentType.toUpperCase()}] ${message}`;
    await execAsync(`cd ${WORKSPACE_PATH} && git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);

    const { stdout: hash } = await execAsync(`cd ${WORKSPACE_PATH} && git rev-parse --short HEAD`);
    const commitHash = hash.trim();

    await execAsync(`cd ${WORKSPACE_PATH} && git push`, { timeout: 30000 });
    logger.info({ commitHash, filesChanged }, 'Workspace changes pushed');

    return { success: true, commitHash, filesChanged };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: maskSensitiveData(errMsg) }, 'Failed to commit/push workspace');
    return { success: false };
  }
}

/**
 * Get list of changed files since last commit
 */
export async function getChangedFiles(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`cd ${WORKSPACE_PATH} && git status --porcelain`);
    return stdout.trim().split('\n').filter(Boolean).map(line => line.slice(3));
  } catch {
    return [];
  }
}

/**
 * Check if workspace has uncommitted changes
 */
export async function hasUncommittedChanges(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`cd ${WORKSPACE_PATH} && git status --porcelain`);
    return !!stdout.trim();
  } catch {
    return false;
  }
}

export const workspace = {
  initialize: initializeWorkspace,
  pull: pullWorkspace,
  createBranch,
  commitAndPush,
  commitAndPushDirect,
  commitAndCreatePR,
  mergePullRequest,
  closePullRequest,
  getChangedFiles,
  hasUncommittedChanges,
};
