/**
 * Scoring Module
 * TASK-037: Exports for scoring engine and strategies
 */

// Engine
export {
  scoreInitiatives,
  getTopInitiatives,
  applyDuplicatePenalties,
  createCompositeStrategy,
} from './engine.js';

// Strategies
export {
  FocusBasedStrategy,
  createFocusBasedStrategy,
} from './strategies/focus-based.js';

export {
  PriorityBasedStrategy,
  createPriorityBasedStrategy,
} from './strategies/priority-based.js';
