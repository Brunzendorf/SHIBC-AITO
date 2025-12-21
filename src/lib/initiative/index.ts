/**
 * Initiative Framework
 * TASK-037: Plugin-fähiges Framework für dynamische Agent-Nutzung
 *
 * This module provides a composable, extensible framework for
 * agent-driven initiative generation and management.
 *
 * @example
 * ```typescript
 * import {
 *   registry,
 *   createFocusBasedStrategy,
 *   type InitiativeProvider,
 *   type Initiative,
 * } from './lib/initiative/index.js';
 *
 * // Create a provider
 * const cmoProvider: InitiativeProvider = {
 *   agentType: 'cmo',
 *   getContextSources: () => ['rag', 'github'],
 *   getScoringStrategy: () => createFocusBasedStrategy(),
 *   getFocusConfig: () => ({
 *     keyQuestions: ['How can we grow?'],
 *     revenueAngles: ['Marketing ROI'],
 *     scanTopics: ['marketing'],
 *   }),
 * };
 *
 * // Register
 * registry.register(cmoProvider);
 *
 * // Use
 * const provider = registry.get('cmo');
 * ```
 */

// =============================================================================
// TYPES
// =============================================================================

export type {
  // Base types
  AgentType,
  Priority,
  IssueStatus,

  // Initiative types
  Initiative,
  InitiativeSource,
  InitiativeProposal,
  InitiativeResult,
  InitiativePhaseResult,

  // Focus settings
  FocusSettings,

  // Scoring
  ScoringContext,
  ScoringStrategy,
  MarketConditions,

  // Context
  ContextSource,
  BuiltInContextSource,
  AggregatedContext,
  AgentFocusConfig,

  // Provider
  InitiativeProvider,
  ProviderRegistrationOptions,
  InitiativeRegistry,

  // GitHub
  GitHubIssuesSummary,
  HumanActionRequest,
  GitHubOperations,

  // Deduplication
  DeduplicationStrategy,

  // Runner
  RunnerConfig,
  InitiativeRunner,
} from './types.js';

export { STATUS_LABELS, DEFAULT_FOCUS } from './types.js';

// =============================================================================
// REGISTRY
// =============================================================================

export {
  registry,
  createRegistry,
  registerAll,
  getProviderOrThrow,
} from './registry.js';

// =============================================================================
// SCORING
// =============================================================================

export {
  // Engine
  scoreInitiatives,
  getTopInitiatives,
  applyDuplicatePenalties,
  createCompositeStrategy,

  // Strategies
  FocusBasedStrategy,
  createFocusBasedStrategy,
  PriorityBasedStrategy,
  createPriorityBasedStrategy,
} from './scoring/index.js';

// =============================================================================
// DEDUPLICATION
// =============================================================================

export {
  DefaultDeduplicationStrategy,
  createDeduplicationStrategy,
  getCreatedHashes,
  clearDeduplicationCache,
  getCreatedCount,
} from './dedup.js';

// =============================================================================
// GITHUB
// =============================================================================

export {
  // Client
  getOctokit,
  resetOctokit,
  getRepoConfig,
  getHumanUsername,
  isGitHubAvailable,
  isCircuitAvailable,

  // Issues
  createGitHubIssue,
  createHumanActionRequest,
  addIssueComment,
  updateIssueStatus,
  claimIssue,
  completeIssue,
  fetchGitHubIssues,
  searchForSimilarIssue,

  // Cache
  refreshBacklogCache,
  getBacklogCache,
  getCachedContext,
  setCachedContext,
  invalidateCachedContext,
  invalidateAllCachedContexts,
  INITIATIVE_CONTEXT_TTL,
  type BacklogData,
  type CachedContextData,
} from './github/index.js';

// =============================================================================
// CONTEXT
// =============================================================================

export {
  // Builder
  getFocusSettings,
  setFocusSettings,
  getBuiltInSource,
  buildContext,
  formatContextAsPrompt,
  buildInitiativePrompt,
  type ContextBuilderOptions,

  // Sources
  RAGContextSource,
  createRAGSource,
  getScanTopics,
  TeamStatusContextSource,
  createTeamStatusSource,
  MarketDataContextSource,
  createMarketDataSource,
  GitHubContextSource,
  createGitHubSource,
} from './context/index.js';

// =============================================================================
// RUNNER
// =============================================================================

export {
  canRunInitiative,
  DefaultInitiativeRunner,
  createRunner,
  runner,
} from './runner.js';

// =============================================================================
// PROVIDERS
// =============================================================================

export {
  // Base
  AGENT_FOCUS_CONFIGS,
  BOOTSTRAP_INITIATIVES,
  getBootstrapInitiatives,
  DEFAULT_CONTEXT_SOURCES,
  createBaseProvider,

  // Individual providers
  ceoProvider,
  cmoProvider,
  ctoProvider,
  cfoProvider,
  cooProvider,
  ccoProvider,
  daoProvider,

  // Collections
  allProviders,
  providersByType,

  // Registration helpers
  registerAllProviders,
  registerProvider,
} from './providers/index.js';
