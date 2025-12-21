/**
 * GitHub Client
 * TASK-037: GitHub API integration with circuit breakers
 *
 * Provides resilient GitHub API access with automatic circuit breaker
 * protection to prevent cascading failures.
 */

import { Octokit } from '@octokit/rest';
import { createCircuitBreaker, GITHUB_OPTIONS, isCircuitOpen } from '../../circuit-breaker.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('initiative:github');

// =============================================================================
// SINGLETON CLIENT
// =============================================================================

/** Lazy-initialized GitHub client */
let octokit: Octokit | null = null;

/**
 * Get or create Octokit instance
 */
export function getOctokit(): Octokit {
  if (!octokit) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN not set');
    }
    octokit = new Octokit({ auth: token });
  }
  return octokit;
}

/**
 * Reset Octokit instance (for testing)
 */
export function resetOctokit(): void {
  octokit = null;
}

// =============================================================================
// REPOSITORY CONFIG
// =============================================================================

/**
 * Get GitHub owner and repo from environment
 */
export function getRepoConfig(): { owner: string; repo: string } {
  return {
    owner: process.env.GITHUB_ORG || 'Brunzendorf',
    repo: process.env.GITHUB_REPO || 'SHIBC-AITO',
  };
}

/**
 * Get human username for assignments
 */
export function getHumanUsername(): string {
  return process.env.GITHUB_HUMAN_USERNAME || 'Brunzendorf';
}

// =============================================================================
// CIRCUIT BREAKERS
// =============================================================================

/**
 * Search GitHub issues with circuit breaker protection
 */
export const searchIssuesBreaker = createCircuitBreaker(
  'github-search-issues',
  async (query: string, owner: string, repo: string, perPage: number) => {
    const gh = getOctokit();
    const result = await gh.search.issuesAndPullRequests({
      q: `${query} repo:${owner}/${repo} is:issue`,
      per_page: perPage,
    });
    return result.data.items;
  },
  GITHUB_OPTIONS,
  () => {
    logger.warn('GitHub search circuit open - returning empty results');
    return [];
  }
);

/**
 * List GitHub issues with circuit breaker protection
 */
export const listIssuesBreaker = createCircuitBreaker(
  'github-list-issues',
  async (owner: string, repo: string, state: 'open' | 'closed' | 'all', perPage: number) => {
    const gh = getOctokit();
    const result = await gh.issues.listForRepo({
      owner,
      repo,
      state,
      per_page: perPage,
      sort: 'updated',
      direction: 'desc',
    });
    return result.data;
  },
  GITHUB_OPTIONS,
  () => {
    logger.warn('GitHub list issues circuit open - returning empty results');
    return [];
  }
);

/**
 * Create GitHub issue with circuit breaker protection
 */
export const createIssueBreaker = createCircuitBreaker(
  'github-create-issue',
  async (
    owner: string,
    repo: string,
    title: string,
    body: string,
    labels: string[],
    assignee?: string
  ) => {
    const gh = getOctokit();
    const result = await gh.issues.create({
      owner,
      repo,
      title,
      body,
      labels,
      assignees: assignee ? [assignee] : undefined,
    });
    return result.data;
  },
  GITHUB_OPTIONS,
  () => {
    logger.error('GitHub create issue circuit open - issue NOT created');
    return null;
  }
);

/**
 * Add comment to GitHub issue with circuit breaker protection
 */
export const addCommentBreaker = createCircuitBreaker(
  'github-add-comment',
  async (owner: string, repo: string, issueNumber: number, body: string) => {
    const gh = getOctokit();
    const result = await gh.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    return result.data;
  },
  GITHUB_OPTIONS,
  () => {
    logger.warn('GitHub add comment circuit open - comment NOT added');
    return null;
  }
);

/**
 * Update GitHub issue labels with circuit breaker protection
 */
export const updateLabelsBreaker = createCircuitBreaker(
  'github-update-labels',
  async (owner: string, repo: string, issueNumber: number, labels: string[]) => {
    const gh = getOctokit();
    const result = await gh.issues.setLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels,
    });
    return result.data;
  },
  GITHUB_OPTIONS,
  () => {
    logger.warn('GitHub update labels circuit open - labels NOT updated');
    return null;
  }
);

// =============================================================================
// AVAILABILITY
// =============================================================================

/**
 * Check if GitHub API is available (all circuits closed)
 */
export function isGitHubAvailable(): boolean {
  return (
    !isCircuitOpen('github-search-issues') &&
    !isCircuitOpen('github-list-issues') &&
    !isCircuitOpen('github-create-issue')
  );
}

/**
 * Check if a specific circuit is available
 */
export function isCircuitAvailable(circuitName: string): boolean {
  return !isCircuitOpen(circuitName);
}
