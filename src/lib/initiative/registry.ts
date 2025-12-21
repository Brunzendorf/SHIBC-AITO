/**
 * Initiative Provider Registry
 * TASK-037: Central registry for agent-specific initiative providers
 *
 * Usage:
 * ```typescript
 * import { registry } from './registry.js';
 *
 * // Register provider
 * registry.register(cmoProvider);
 *
 * // Get provider
 * const provider = registry.get('cmo');
 * ```
 */

import type {
  AgentType,
  InitiativeProvider,
  InitiativeRegistry,
  ProviderRegistrationOptions,
} from './types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('initiative:registry');

/**
 * Default implementation of InitiativeRegistry
 */
class DefaultRegistry implements InitiativeRegistry {
  private providers = new Map<AgentType, InitiativeProvider>();

  /**
   * Register a provider for an agent type
   */
  register<T = unknown>(
    provider: InitiativeProvider<T>,
    options: ProviderRegistrationOptions = {}
  ): void {
    const { agentType } = provider;

    if (this.providers.has(agentType) && !options.override) {
      throw new Error(
        `Provider already registered for agent type: ${agentType}. ` +
        `Use { override: true } to replace.`
      );
    }

    this.providers.set(agentType, provider as InitiativeProvider);

    logger.info({ agentType, override: options.override }, 'Provider registered');
  }

  /**
   * Get provider for an agent type
   */
  get<T = unknown>(agentType: AgentType): InitiativeProvider<T> | undefined {
    return this.providers.get(agentType) as InitiativeProvider<T> | undefined;
  }

  /**
   * Check if a provider is registered
   */
  has(agentType: AgentType): boolean {
    return this.providers.has(agentType);
  }

  /**
   * Get all registered agent types
   */
  getRegisteredTypes(): AgentType[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Unregister a provider
   */
  unregister(agentType: AgentType): boolean {
    const existed = this.providers.has(agentType);
    this.providers.delete(agentType);

    if (existed) {
      logger.info({ agentType }, 'Provider unregistered');
    }

    return existed;
  }

  /**
   * Clear all providers (useful for testing)
   */
  clear(): void {
    this.providers.clear();
    logger.debug('Registry cleared');
  }
}

/**
 * Global registry instance
 * Use this for production code
 */
export const registry: InitiativeRegistry & { clear(): void } = new DefaultRegistry();

/**
 * Create a new isolated registry instance
 * Useful for testing or multiple registry scenarios
 */
export function createRegistry(): InitiativeRegistry & { clear(): void } {
  return new DefaultRegistry();
}

/**
 * Helper to register multiple providers at once
 */
export function registerAll(providers: InitiativeProvider[]): void {
  for (const provider of providers) {
    registry.register(provider);
  }
}

/**
 * Helper to get provider or throw
 */
export function getProviderOrThrow<T = unknown>(agentType: AgentType): InitiativeProvider<T> {
  const provider = registry.get<T>(agentType);
  if (!provider) {
    throw new Error(`No provider registered for agent type: ${agentType}`);
  }
  return provider;
}
