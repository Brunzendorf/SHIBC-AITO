/**
 * GitHub Module
 * TASK-037: GitHub integration for initiatives
 */

// Client
export {
  getOctokit,
  resetOctokit,
  getRepoConfig,
  getHumanUsername,
  searchIssuesBreaker,
  listIssuesBreaker,
  createIssueBreaker,
  addCommentBreaker,
  updateLabelsBreaker,
  isGitHubAvailable,
  isCircuitAvailable,
} from './client.js';

// Issues
export {
  createGitHubIssue,
  createHumanActionRequest,
  addIssueComment,
  updateIssueStatus,
  claimIssue,
  completeIssue,
  fetchGitHubIssues,
  searchForSimilarIssue,
} from './issues.js';

// Cache
export {
  refreshBacklogCache,
  getBacklogCache,
  getCachedContext,
  setCachedContext,
  invalidateCachedContext,
  invalidateAllCachedContexts,
  INITIATIVE_CONTEXT_TTL,
  type BacklogData,
  type CachedContextData,
} from './cache.js';
