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

const execAsync = promisify(exec);
const logger = createLogger('workspace');

const WORKSPACE_PATH = '/app/workspace';

/**
 * Initialize workspace by cloning git repository
 * Called on agent startup
 */
export async function initializeWorkspace(agentType: string): Promise<boolean> {
  try {
    // Check if workspace already exists with .git
    if (existsSync(`${WORKSPACE_PATH}/.git`)) {
      logger.info('Workspace already initialized, pulling latest...');
      await pullWorkspace();
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
    const { stdout, stderr } = await execAsync(
      `git clone --branch ${workspaceConfig.branch} --single-branch ${repoUrl} ${WORKSPACE_PATH}`,
      { timeout: 60000 }
    );

    if (stderr && !stderr.includes('Cloning into')) {
      logger.warn({ stderr }, 'Git clone warning');
    }

    // Configure git user for commits
    await configureGitUser(agentType);

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
    logger.error({ error: errMsg }, 'Failed to initialize workspace');

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
 * Pull latest changes from remote
 */
export async function pullWorkspace(): Promise<boolean> {
  try {
    await execAsync(`cd ${WORKSPACE_PATH} && git fetch origin`, { timeout: 30000 });
    await execAsync(`cd ${WORKSPACE_PATH} && git pull --rebase origin ${workspaceConfig.branch}`, { timeout: 30000 });
    logger.debug('Workspace pull completed');
    return true;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: errMsg }, 'Failed to pull workspace');
    return false;
  }
}

/**
 * Create feature branch for PR workflow
 */
export async function createBranch(agentType: string, loopNumber: number): Promise<string> {
  const timestamp = new Date().toISOString().slice(0, 10); // 2024-12-11
  const branchName = `feature/${agentType}-${timestamp}-loop${loopNumber}`;

  try {
    // Ensure we're on main and up to date
    await execAsync(`cd ${WORKSPACE_PATH} && git checkout ${workspaceConfig.branch}`);
    await pullWorkspace();

    // Create and checkout new branch
    await execAsync(`cd ${WORKSPACE_PATH} && git checkout -b ${branchName}`);
    logger.info({ branchName }, 'Created feature branch');

    return branchName;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errMsg }, 'Failed to create branch');
    throw error;
  }
}

/**
 * Commit changes and create PR (Branch+PR workflow)
 * Returns PR info for orchestrator to review
 */
export async function commitAndCreatePR(
  agentType: string,
  message: string,
  loopNumber: number
): Promise<{
  success: boolean;
  branchName?: string;
  commitHash?: string;
  prNumber?: number;
  prUrl?: string;
  filesChanged?: number;
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

    // Create branch if PR workflow enabled
    let branchName = workspaceConfig.branch;
    if (workspaceConfig.usePR) {
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

    // Push branch
    await execAsync(`cd ${WORKSPACE_PATH} && git push -u origin ${branchName}`, { timeout: 30000 });

    // Create PR if enabled
    let prNumber: number | undefined;
    let prUrl: string | undefined;

    if (workspaceConfig.usePR && config.GITHUB_TOKEN) {
      const prResult = await createPullRequest(agentType, message, changedFiles, branchName);
      prNumber = prResult.prNumber;
      prUrl = prResult.prUrl;
    }

    logger.info({ commitHash, filesChanged, branchName, prNumber }, 'Workspace changes committed');

    // Switch back to main
    if (workspaceConfig.usePR) {
      await execAsync(`cd ${WORKSPACE_PATH} && git checkout ${workspaceConfig.branch}`);
    }

    return { success: true, branchName, commitHash, prNumber, prUrl, filesChanged };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errMsg }, 'Failed to commit/create PR');
    return { success: false };
  }
}

/**
 * Create Pull Request using gh CLI
 */
async function createPullRequest(
  agentType: string,
  summary: string,
  changedFiles: string[],
  branchName: string
): Promise<{ prNumber?: number; prUrl?: string }> {
  try {
    const title = `[${agentType.toUpperCase()}] ${summary.slice(0, 70)}`;
    const body = `## Summary
${summary}

## Files Changed
${changedFiles.map(f => `- \`${f}\``).join('\n')}

## Agent
- Type: ${agentType.toUpperCase()}
- Branch: ${branchName}

---
*Auto-generated by AITO Agent. Awaiting RAG quality review.*
`;

    // Create PR using gh CLI
    const { stdout } = await execAsync(
      `cd ${WORKSPACE_PATH} && GH_TOKEN=${config.GITHUB_TOKEN} gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --base ${workspaceConfig.branch}`,
      { timeout: 30000 }
    );

    // Extract PR URL from output
    const prUrl = stdout.trim();
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : undefined;

    logger.info({ prNumber, prUrl }, 'Pull request created');
    return { prNumber, prUrl };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errMsg }, 'Failed to create PR');
    return {};
  }
}

/**
 * Merge PR after approval (called by orchestrator after RAG review)
 */
export async function mergePullRequest(prNumber: number): Promise<boolean> {
  try {
    await execAsync(
      `cd ${WORKSPACE_PATH} && GH_TOKEN=${config.GITHUB_TOKEN} gh pr merge ${prNumber} --squash --delete-branch`,
      { timeout: 30000 }
    );
    logger.info({ prNumber }, 'Pull request merged');
    return true;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errMsg, prNumber }, 'Failed to merge PR');
    return false;
  }
}

/**
 * Close PR with comment (called when RAG review fails)
 */
export async function closePullRequest(prNumber: number, reason: string): Promise<boolean> {
  try {
    // Add comment with reason
    await execAsync(
      `cd ${WORKSPACE_PATH} && GH_TOKEN=${config.GITHUB_TOKEN} gh pr comment ${prNumber} --body "RAG Quality Review Failed:\n\n${reason.replace(/"/g, '\\"')}"`,
      { timeout: 30000 }
    );

    // Close PR
    await execAsync(
      `cd ${WORKSPACE_PATH} && GH_TOKEN=${config.GITHUB_TOKEN} gh pr close ${prNumber}`,
      { timeout: 30000 }
    );

    logger.info({ prNumber }, 'Pull request closed');
    return true;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errMsg, prNumber }, 'Failed to close PR');
    return false;
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
    logger.error({ error: errMsg }, 'Failed to commit/push workspace');
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
  commitAndCreatePR,
  mergePullRequest,
  closePullRequest,
  getChangedFiles,
  hasUncommittedChanges,
};
