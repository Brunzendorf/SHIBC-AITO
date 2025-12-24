/**
 * Projects Manager
 * Manages external project repositories for CTO agent
 *
 * Projects are cloned to /app/projects/ (separate from shared workspace)
 * This allows CTO to work on website, contracts, etc. without affecting other agents
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { createLogger } from '../lib/logger.js';
import { config } from '../lib/config.js';

const execAsync = promisify(exec);
const logger = createLogger('projects');

const PROJECTS_PATH = '/app/projects';

/**
 * Default projects that CTO can work with
 * These are NOT auto-cloned, but provide context for the agent
 */
export const DEFAULT_PROJECTS = {
  website: {
    name: 'website',
    repo: 'https://github.com/og-shibaclassic/website.git',
    description: 'SHIBC main website (Next.js)',
    branch: 'main',
  },
  contracts: {
    name: 'contracts',
    repo: 'https://github.com/og-shibaclassic/contracts.git',
    description: 'Smart contracts (Solidity)',
    branch: 'main',
  },
} as const;

export type ProjectName = keyof typeof DEFAULT_PROJECTS;

/**
 * Initialize projects directory
 * Creates /app/projects if it doesn't exist
 */
export async function initializeProjects(): Promise<boolean> {
  try {
    // Ensure projects directory exists
    if (!existsSync(PROJECTS_PATH)) {
      mkdirSync(PROJECTS_PATH, { recursive: true });
      logger.info({ path: PROJECTS_PATH }, 'Created projects directory');
    }

    // List existing projects
    const existing = readdirSync(PROJECTS_PATH).filter(f => {
      try {
        return existsSync(`${PROJECTS_PATH}/${f}/.git`);
      } catch {
        return false;
      }
    });

    if (existing.length > 0) {
      logger.info({ projects: existing }, 'Found existing projects');
    } else {
      logger.info('No projects cloned yet - CTO can clone as needed');
    }

    return true;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errMsg }, 'Failed to initialize projects directory');
    return false;
  }
}

/**
 * Clone a project repository
 * Used by MCP workers via git-mcp, but can also be called directly
 */
export async function cloneProject(
  repoUrl: string,
  projectName: string,
  branch = 'main'
): Promise<{ success: boolean; path?: string; error?: string }> {
  const projectPath = `${PROJECTS_PATH}/${projectName}`;

  try {
    // Check if already cloned
    if (existsSync(`${projectPath}/.git`)) {
      logger.info({ projectName, path: projectPath }, 'Project already cloned, pulling latest');

      // Pull latest
      await execAsync(`cd ${projectPath} && git fetch origin && git pull origin ${branch}`, {
        timeout: 60000,
      });

      return { success: true, path: projectPath };
    }

    // Add GitHub token to URL if available
    let authenticatedUrl = repoUrl;
    if (config.GITHUB_TOKEN && repoUrl.includes('github.com')) {
      authenticatedUrl = repoUrl.replace(
        'https://github.com/',
        `https://${config.GITHUB_TOKEN}@github.com/`
      );
    }

    logger.info({ projectName, branch }, 'Cloning project...');

    // Clone repository
    await execAsync(
      `git clone --branch ${branch} --single-branch ${authenticatedUrl} ${projectPath}`,
      { timeout: 120000 }
    );

    // Configure git user
    await execAsync(`cd ${projectPath} && git config user.name "CTO Agent"`);
    await execAsync(`cd ${projectPath} && git config user.email "cto@aito.shibaclassic.io"`);

    logger.info({ projectName, path: projectPath }, 'Project cloned successfully');

    return { success: true, path: projectPath };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    // Mask tokens in error messages
    const maskedErr = errMsg.replace(/ghp_[a-zA-Z0-9]+/g, 'ghp_***');
    logger.error({ error: maskedErr, projectName }, 'Failed to clone project');
    return { success: false, error: maskedErr };
  }
}

/**
 * Get status of all projects
 */
export async function getProjectsStatus(): Promise<{
  initialized: boolean;
  projects: Array<{
    name: string;
    path: string;
    branch?: string;
    hasChanges?: boolean;
  }>;
}> {
  if (!existsSync(PROJECTS_PATH)) {
    return { initialized: false, projects: [] };
  }

  const projects: Array<{
    name: string;
    path: string;
    branch?: string;
    hasChanges?: boolean;
  }> = [];

  try {
    const dirs = readdirSync(PROJECTS_PATH);

    for (const dir of dirs) {
      const projectPath = `${PROJECTS_PATH}/${dir}`;

      if (!existsSync(`${projectPath}/.git`)) continue;

      try {
        // Get current branch
        const { stdout: branch } = await execAsync(
          `cd ${projectPath} && git rev-parse --abbrev-ref HEAD`
        );

        // Check for uncommitted changes
        const { stdout: status } = await execAsync(
          `cd ${projectPath} && git status --porcelain`
        );

        projects.push({
          name: dir,
          path: projectPath,
          branch: branch.trim(),
          hasChanges: !!status.trim(),
        });
      } catch {
        // Git command failed, still include project
        projects.push({ name: dir, path: projectPath });
      }
    }
  } catch (error) {
    logger.error({ error }, 'Failed to get projects status');
  }

  return { initialized: true, projects };
}

/**
 * Get path for a project
 */
export function getProjectPath(projectName: string): string {
  return `${PROJECTS_PATH}/${projectName}`;
}

/**
 * Check if a project is cloned
 */
export function isProjectCloned(projectName: string): boolean {
  return existsSync(`${PROJECTS_PATH}/${projectName}/.git`);
}

export const projects = {
  initialize: initializeProjects,
  clone: cloneProject,
  getStatus: getProjectsStatus,
  getPath: getProjectPath,
  isCloned: isProjectCloned,
  PROJECTS_PATH,
  DEFAULT_PROJECTS,
};
