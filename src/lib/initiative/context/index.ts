/**
 * Context Module
 * TASK-037: Context building for initiatives
 */

// Builder
export {
  getFocusSettings,
  setFocusSettings,
  getBuiltInSource,
  buildContext,
  formatContextAsPrompt,
  buildInitiativePrompt,
  type ContextBuilderOptions,
} from './builder.js';

// Sources
export {
  RAGContextSource,
  createRAGSource,
  getScanTopics,
  TeamStatusContextSource,
  createTeamStatusSource,
  MarketDataContextSource,
  createMarketDataSource,
  GitHubContextSource,
  createGitHubSource,
} from './sources/index.js';
