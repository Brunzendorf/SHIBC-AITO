/**
 * Tests for Initiative Registry
 * TASK-037: Provider registration and lookup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createRegistry,
  registerAll,
  getProviderOrThrow,
  registry,
} from '../registry.js';
import type {
  AgentType,
  InitiativeProvider,
  ScoringStrategy,
  AgentFocusConfig,
} from '../types.js';

// Mock logger
vi.mock('../../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Create a mock provider
function createMockProvider(agentType: AgentType): InitiativeProvider {
  return {
    agentType,
    getContextSources: () => ['rag', 'github'],
    getScoringStrategy: (): ScoringStrategy => ({
      name: 'mock-strategy',
      score: () => 5,
    }),
    getFocusConfig: (): AgentFocusConfig => ({
      keyQuestions: ['Test question?'],
      revenueAngles: ['Test revenue'],
      scanTopics: ['test'],
    }),
  };
}

describe('Initiative Registry', () => {
  describe('createRegistry', () => {
    it('should create isolated registry instance', () => {
      const reg1 = createRegistry();
      const reg2 = createRegistry();

      const provider = createMockProvider('cmo');
      reg1.register(provider);

      expect(reg1.has('cmo')).toBe(true);
      expect(reg2.has('cmo')).toBe(false);
    });
  });

  describe('register', () => {
    let testRegistry: ReturnType<typeof createRegistry>;

    beforeEach(() => {
      testRegistry = createRegistry();
    });

    it('should register a provider', () => {
      const provider = createMockProvider('cmo');

      testRegistry.register(provider);

      expect(testRegistry.has('cmo')).toBe(true);
    });

    it('should throw on duplicate registration without override', () => {
      const provider1 = createMockProvider('cmo');
      const provider2 = createMockProvider('cmo');

      testRegistry.register(provider1);

      expect(() => testRegistry.register(provider2)).toThrow(
        'Provider already registered for agent type: cmo'
      );
    });

    it('should allow override with option', () => {
      const provider1 = createMockProvider('cmo');
      const provider2 = createMockProvider('cmo');

      testRegistry.register(provider1);
      testRegistry.register(provider2, { override: true });

      expect(testRegistry.has('cmo')).toBe(true);
    });
  });

  describe('get', () => {
    let testRegistry: ReturnType<typeof createRegistry>;

    beforeEach(() => {
      testRegistry = createRegistry();
    });

    it('should return registered provider', () => {
      const provider = createMockProvider('cmo');
      testRegistry.register(provider);

      const result = testRegistry.get('cmo');

      expect(result).toBe(provider);
    });

    it('should return undefined for unregistered type', () => {
      const result = testRegistry.get('ceo');

      expect(result).toBeUndefined();
    });
  });

  describe('has', () => {
    let testRegistry: ReturnType<typeof createRegistry>;

    beforeEach(() => {
      testRegistry = createRegistry();
    });

    it('should return true for registered provider', () => {
      const provider = createMockProvider('cmo');
      testRegistry.register(provider);

      expect(testRegistry.has('cmo')).toBe(true);
    });

    it('should return false for unregistered type', () => {
      expect(testRegistry.has('ceo')).toBe(false);
    });
  });

  describe('getRegisteredTypes', () => {
    let testRegistry: ReturnType<typeof createRegistry>;

    beforeEach(() => {
      testRegistry = createRegistry();
    });

    it('should return empty array when no providers registered', () => {
      expect(testRegistry.getRegisteredTypes()).toEqual([]);
    });

    it('should return all registered agent types', () => {
      testRegistry.register(createMockProvider('cmo'));
      testRegistry.register(createMockProvider('cto'));
      testRegistry.register(createMockProvider('ceo'));

      const types = testRegistry.getRegisteredTypes();

      expect(types).toHaveLength(3);
      expect(types).toContain('cmo');
      expect(types).toContain('cto');
      expect(types).toContain('ceo');
    });
  });

  describe('unregister', () => {
    let testRegistry: ReturnType<typeof createRegistry>;

    beforeEach(() => {
      testRegistry = createRegistry();
    });

    it('should unregister a provider', () => {
      const provider = createMockProvider('cmo');
      testRegistry.register(provider);

      const result = testRegistry.unregister('cmo');

      expect(result).toBe(true);
      expect(testRegistry.has('cmo')).toBe(false);
    });

    it('should return false when unregistering non-existent provider', () => {
      const result = testRegistry.unregister('ceo');

      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    let testRegistry: ReturnType<typeof createRegistry>;

    beforeEach(() => {
      testRegistry = createRegistry();
    });

    it('should clear all providers', () => {
      testRegistry.register(createMockProvider('cmo'));
      testRegistry.register(createMockProvider('cto'));

      testRegistry.clear();

      expect(testRegistry.getRegisteredTypes()).toEqual([]);
    });
  });

  describe('registerAll', () => {
    beforeEach(() => {
      // Clear global registry before each test
      registry.clear();
    });

    it('should register multiple providers at once', () => {
      const providers = [
        createMockProvider('cmo'),
        createMockProvider('cto'),
        createMockProvider('ceo'),
      ];

      registerAll(providers);

      expect(registry.has('cmo')).toBe(true);
      expect(registry.has('cto')).toBe(true);
      expect(registry.has('ceo')).toBe(true);
    });
  });

  describe('getProviderOrThrow', () => {
    beforeEach(() => {
      registry.clear();
    });

    it('should return provider when registered', () => {
      const provider = createMockProvider('cmo');
      registry.register(provider);

      const result = getProviderOrThrow('cmo');

      expect(result).toBe(provider);
    });

    it('should throw when provider not registered', () => {
      expect(() => getProviderOrThrow('ceo')).toThrow(
        'No provider registered for agent type: ceo'
      );
    });
  });

  describe('Provider interface', () => {
    it('should support all provider methods', () => {
      const provider = createMockProvider('cmo');

      expect(provider.agentType).toBe('cmo');
      expect(provider.getContextSources()).toEqual(['rag', 'github']);
      expect(provider.getScoringStrategy().name).toBe('mock-strategy');
      expect(provider.getFocusConfig().keyQuestions).toHaveLength(1);
    });

    it('should support optional provider methods', () => {
      const provider: InitiativeProvider = {
        ...createMockProvider('cmo'),
        getPromptTemplate: () => 'Custom prompt',
        validateInitiative: () => true,
        transformInitiative: (init) => init,
        getBootstrapInitiatives: () => [],
        getCooldownSeconds: () => 1800,
        onInitiativeCreated: async () => {},
      };

      expect(provider.getPromptTemplate?.({} as any)).toBe('Custom prompt');
      expect(provider.validateInitiative?.({} as any)).toBe(true);
      expect(provider.getBootstrapInitiatives?.()).toEqual([]);
      expect(provider.getCooldownSeconds?.()).toBe(1800);
    });
  });
});
