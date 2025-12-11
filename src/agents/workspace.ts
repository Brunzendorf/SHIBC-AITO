/**
 * Workspace Git Manager
 * Handles git operations for agent workspace persistence
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
    await execAsync(`cd ${WORKSPACE_PATH} && git pull --rebase`, { timeout: 30000 });
    logger.debug('Workspace pull completed');
    return true;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: errMsg }, 'Failed to pull workspace');
    return false;
  }
}

/**
 * Commit and push workspace changes
 * Called after agent writes files
 */
export async function commitAndPush(
  agentType: string,
  message: string
): Promise<{ success: boolean; commitHash?: string; filesChanged?: number }> {
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
    logger.info({ filesChanged }, 'Committing workspace changes...');

    // Stage all changes
    await execAsync(`cd ${WORKSPACE_PATH} && git add -A`);

    // Commit with agent-specific message
    const commitMessage = `[${agentType.toUpperCase()}] ${message}`;
    await execAsync(`cd ${WORKSPACE_PATH} && git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);

    // Get commit hash
    const { stdout: hash } = await execAsync(`cd ${WORKSPACE_PATH} && git rev-parse --short HEAD`);
    const commitHash = hash.trim();

    // Push if enabled
    if (workspaceConfig.autoPush) {
      await execAsync(`cd ${WORKSPACE_PATH} && git push`, { timeout: 30000 });
      logger.info({ commitHash, filesChanged }, 'Workspace changes pushed');
    } else {
      logger.info({ commitHash, filesChanged }, 'Workspace changes committed (push disabled)');
    }

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
  commitAndPush,
  getChangedFiles,
  hasUncommittedChanges,
};
