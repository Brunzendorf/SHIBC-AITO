/**
 * Initiative Providers
 * TASK-037: Agent-specific initiative providers
 */

import type { AgentType, InitiativeProvider } from '../types.js';
import { registry } from '../registry.js';

// Base configuration
export {
  AGENT_FOCUS_CONFIGS,
  BOOTSTRAP_INITIATIVES,
  getBootstrapInitiatives,
  DEFAULT_CONTEXT_SOURCES,
  createBaseProvider,
} from './base.js';

// Individual providers
export { ceoProvider } from './ceo.js';
export { cmoProvider } from './cmo.js';
export { ctoProvider } from './cto.js';
export { cfoProvider } from './cfo.js';
export { cooProvider } from './coo.js';
export { ccoProvider } from './cco.js';
export { daoProvider } from './dao.js';

// All providers
import { ceoProvider } from './ceo.js';
import { cmoProvider } from './cmo.js';
import { ctoProvider } from './cto.js';
import { cfoProvider } from './cfo.js';
import { cooProvider } from './coo.js';
import { ccoProvider } from './cco.js';
import { daoProvider } from './dao.js';

/**
 * All available providers
 */
export const allProviders: InitiativeProvider[] = [
  ceoProvider,
  cmoProvider,
  ctoProvider,
  cfoProvider,
  cooProvider,
  ccoProvider,
  daoProvider,
];

/**
 * Provider lookup by agent type
 */
export const providersByType: Record<AgentType, InitiativeProvider> = {
  ceo: ceoProvider,
  cmo: cmoProvider,
  cto: ctoProvider,
  cfo: cfoProvider,
  coo: cooProvider,
  cco: ccoProvider,
  dao: daoProvider,
};

/**
 * Register all default providers with the registry
 */
export function registerAllProviders(): void {
  for (const provider of allProviders) {
    registry.register(provider, { override: true });
  }
}

/**
 * Register a specific provider
 */
export function registerProvider(agentType: AgentType): void {
  const provider = providersByType[agentType];
  if (provider) {
    registry.register(provider, { override: true });
  }
}
