/**
 * Adapter Registry
 *
 * Zentrale Registry für alle MCP Adapter.
 * Ermöglicht dynamisches Laden und Instanziieren von Adaptern.
 */

import type {
  IAdapter,
  IApiAdapter,
  ICICDAdapter,
  IContainerAdapter,
  IGitAdapter,
  IShellAdapter,
  ICMSAdapter,
  IMessagingAdapter,
  AdapterFactory,
  AdapterRegistryEntry,
} from './types.js';

// ============================================
// ADAPTER CATEGORIES
// ============================================

export type AdapterCategory =
  | 'cicd'
  | 'container'
  | 'git'
  | 'shell'
  | 'cms'
  | 'messaging'
  | 'api';

// ============================================
// REGISTRY CLASS
// ============================================

/**
 * Zentrale Registry für Adapter
 *
 * @example
 * // Adapter registrieren
 * registry.register('cicd', 'woodpecker', {
 *   factory: (config) => new WoodpeckerAdapter(config),
 *   description: 'Woodpecker CI Adapter'
 * });
 *
 * // Adapter erstellen
 * const adapter = registry.create<ICICDAdapter>('cicd', 'woodpecker', {
 *   WOODPECKER_URL: 'https://ci.example.com',
 *   WOODPECKER_TOKEN: 'xxx'
 * });
 */
export class AdapterRegistry {
  private static instance: AdapterRegistry;
  private adapters: Map<string, Map<string, AdapterRegistryEntry<IAdapter>>> = new Map();

  private constructor() {
    // Kategorien initialisieren
    const categories: AdapterCategory[] = [
      'cicd',
      'container',
      'git',
      'shell',
      'cms',
      'messaging',
      'api',
    ];
    categories.forEach(cat => this.adapters.set(cat, new Map()));
  }

  /**
   * Singleton Instance
   */
  static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }

  /**
   * Adapter registrieren
   */
  register<T extends IAdapter>(
    category: AdapterCategory,
    name: string,
    entry: Omit<AdapterRegistryEntry<T>, 'type'>
  ): void {
    const categoryMap = this.adapters.get(category);
    if (!categoryMap) {
      throw new Error(`Unknown category: ${category}`);
    }

    categoryMap.set(name, {
      type: name,
      factory: entry.factory as AdapterFactory<IAdapter>,
      description: entry.description,
    });
  }

  /**
   * Adapter erstellen
   */
  create<T extends IAdapter>(
    category: AdapterCategory,
    name: string,
    config: Record<string, string>
  ): T {
    const categoryMap = this.adapters.get(category);
    if (!categoryMap) {
      throw new Error(`Unknown category: ${category}`);
    }

    const entry = categoryMap.get(name);
    if (!entry) {
      const available = Array.from(categoryMap.keys()).join(', ');
      throw new Error(`Unknown adapter: ${name}. Available: ${available}`);
    }

    return entry.factory(config) as T;
  }

  /**
   * Verfügbare Adapter auflisten
   */
  list(category?: AdapterCategory): Array<{ category: string; name: string; description: string }> {
    const result: Array<{ category: string; name: string; description: string }> = [];

    const categories = category ? [category] : Array.from(this.adapters.keys());

    for (const cat of categories) {
      const categoryMap = this.adapters.get(cat as AdapterCategory);
      if (categoryMap) {
        for (const [name, entry] of categoryMap) {
          result.push({
            category: cat,
            name,
            description: entry.description,
          });
        }
      }
    }

    return result;
  }

  /**
   * Prüfen ob Adapter existiert
   */
  has(category: AdapterCategory, name: string): boolean {
    const categoryMap = this.adapters.get(category);
    return categoryMap?.has(name) ?? false;
  }
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Globale Registry-Instanz
 */
export const registry = AdapterRegistry.getInstance();

/**
 * CI/CD Adapter erstellen
 */
export function createCICDAdapter(name: string, config: Record<string, string>): ICICDAdapter {
  return registry.create<ICICDAdapter>('cicd', name, config);
}

/**
 * Container Adapter erstellen
 */
export function createContainerAdapter(name: string, config: Record<string, string>): IContainerAdapter {
  return registry.create<IContainerAdapter>('container', name, config);
}

/**
 * Git Adapter erstellen
 */
export function createGitAdapter(name: string, config: Record<string, string>): IGitAdapter {
  return registry.create<IGitAdapter>('git', name, config);
}

/**
 * Shell Adapter erstellen
 */
export function createShellAdapter(name: string, config: Record<string, string>): IShellAdapter {
  return registry.create<IShellAdapter>('shell', name, config);
}

/**
 * CMS Adapter erstellen
 */
export function createCMSAdapter(name: string, config: Record<string, string>): ICMSAdapter {
  return registry.create<ICMSAdapter>('cms', name, config);
}

/**
 * Messaging Adapter erstellen
 */
export function createMessagingAdapter(name: string, config: Record<string, string>): IMessagingAdapter {
  return registry.create<IMessagingAdapter>('messaging', name, config);
}

// ============================================
// AUTO-REGISTRATION HELPER
// ============================================

/**
 * Decorator für automatische Registrierung
 *
 * @example
 * @RegisterAdapter('cicd', 'woodpecker', 'Woodpecker CI Adapter')
 * class WoodpeckerAdapter implements ICICDAdapter {
 *   // ...
 * }
 */
export function RegisterAdapter(
  category: AdapterCategory,
  name: string,
  description: string
) {
  return function <T extends new (config: Record<string, string>) => IAdapter>(
    constructor: T
  ) {
    registry.register(category, name, {
      factory: (config) => new constructor(config),
      description,
    });
    return constructor;
  };
}
