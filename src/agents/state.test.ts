/**
 * Tests for StateManager
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentType } from '../lib/types.js';

// Mock dependencies
const mockStateRepo = {
  get: vi.fn<any, any>(),
  set: vi.fn<any, any>(),
  delete: vi.fn<any, any>(),
  getAll: vi.fn<any, any>(),
};

const mockLogger = {
  info: vi.fn<any, any>(),
  error: vi.fn<any, any>(),
  warn: vi.fn<any, any>(),
  debug: vi.fn<any, any>(),
};

vi.mock('../lib/logger.js', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

vi.mock('../lib/db.js', () => ({
  stateRepo: mockStateRepo,
}));

describe('StateManager', () => {
  let createStateManager: any;
  let StateKeys: any;
  let customKey: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import('./state.js');
    createStateManager = module.createStateManager;
    StateKeys = module.StateKeys;
    customKey = module.customKey;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('createStateManager', () => {
    it('should create a state manager instance', () => {
      const manager = createStateManager('agent-123', 'ceo');
      expect(manager).toBeDefined();
      expect(manager.get).toBeDefined();
      expect(manager.set).toBeDefined();
      expect(manager.delete).toBeDefined();
      expect(manager.getAll).toBeDefined();
      expect(manager.clear).toBeDefined();
    });

    it('should log creation with agent info', () => {
      createStateManager('agent-456', 'cmo');
      expect(mockLogger.info).toHaveBeenCalledWith(
        { agentId: 'agent-456', agentType: 'cmo' },
        'Creating state manager'
      );
    });
  });

  describe('get', () => {
    it('should retrieve a state value', async () => {
      const testValue = { data: 'test' };
      mockStateRepo.get.mockResolvedValue(testValue);

      const manager = createStateManager('agent-123', 'ceo');
      const result = await manager.get('test-key');

      expect(result).toEqual(testValue);
      expect(mockStateRepo.get).toHaveBeenCalledWith('agent-123', 'test-key');
    });

    it('should return null if value does not exist', async () => {
      mockStateRepo.get.mockResolvedValue(null);

      const manager = createStateManager('agent-123', 'ceo');
      const result = await manager.get('nonexistent');

      expect(result).toBeNull();
      expect(mockStateRepo.get).toHaveBeenCalledWith('agent-123', 'nonexistent');
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('DB connection failed');
      mockStateRepo.get.mockRejectedValue(error);

      const manager = createStateManager('agent-123', 'ceo');
      const result = await manager.get('error-key');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        { agentId: 'agent-123', key: 'error-key', error },
        'Failed to get state'
      );
    });

    it('should retrieve typed values', async () => {
      mockStateRepo.get.mockResolvedValue(42);

      const manager = createStateManager('agent-123', 'ceo');
      const result = await manager.get<number>('count');

      expect(result).toBe(42);
      expect(typeof result).toBe('number');
    });
  });

  describe('set', () => {
    it('should set a state value', async () => {
      mockStateRepo.set.mockResolvedValue(undefined);

      const manager = createStateManager('agent-123', 'ceo');
      await manager.set('test-key', 'test-value');

      expect(mockStateRepo.set).toHaveBeenCalledWith('agent-123', 'test-key', 'test-value');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        { agentId: 'agent-123', key: 'test-key' },
        'State updated'
      );
    });

    it('should set complex objects', async () => {
      mockStateRepo.set.mockResolvedValue(undefined);

      const complexValue = {
        nested: { data: 'value' },
        array: [1, 2, 3],
        number: 42,
      };

      const manager = createStateManager('agent-123', 'ceo');
      await manager.set('complex', complexValue);

      expect(mockStateRepo.set).toHaveBeenCalledWith('agent-123', 'complex', complexValue);
    });

    it('should throw error on failure', async () => {
      const error = new Error('Write failed');
      mockStateRepo.set.mockRejectedValue(error);

      const manager = createStateManager('agent-123', 'ceo');

      await expect(manager.set('error-key', 'value')).rejects.toThrow('Write failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        { agentId: 'agent-123', key: 'error-key', error },
        'Failed to set state'
      );
    });
  });

  describe('delete', () => {
    it('should delete a state value', async () => {
      mockStateRepo.delete.mockResolvedValue(undefined);

      const manager = createStateManager('agent-123', 'ceo');
      await manager.delete('test-key');

      expect(mockStateRepo.delete).toHaveBeenCalledWith('agent-123', 'test-key');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        { agentId: 'agent-123', key: 'test-key' },
        'State deleted'
      );
    });

    it('should throw error on failure', async () => {
      const error = new Error('Delete failed');
      mockStateRepo.delete.mockRejectedValue(error);

      const manager = createStateManager('agent-123', 'ceo');

      await expect(manager.delete('error-key')).rejects.toThrow('Delete failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        { agentId: 'agent-123', key: 'error-key', error },
        'Failed to delete state'
      );
    });
  });

  describe('getAll', () => {
    it('should retrieve all state values', async () => {
      const allStates = {
        'key1': 'value1',
        'key2': 42,
        'key3': { nested: true },
      };
      mockStateRepo.getAll.mockResolvedValue(allStates);

      const manager = createStateManager('agent-123', 'ceo');
      const result = await manager.getAll();

      expect(result).toEqual(allStates);
      expect(mockStateRepo.getAll).toHaveBeenCalledWith('agent-123');
    });

    it('should return empty object on error', async () => {
      const error = new Error('GetAll failed');
      mockStateRepo.getAll.mockRejectedValue(error);

      const manager = createStateManager('agent-123', 'ceo');
      const result = await manager.getAll();

      expect(result).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        { agentId: 'agent-123', error },
        'Failed to get all state'
      );
    });
  });

  describe('clear', () => {
    it('should clear all state values', async () => {
      const states = {
        'key1': 'value1',
        'key2': 'value2',
        'key3': 'value3',
      };
      mockStateRepo.getAll.mockResolvedValue(states);
      mockStateRepo.delete.mockResolvedValue(undefined);

      const manager = createStateManager('agent-123', 'ceo');
      await manager.clear();

      expect(mockStateRepo.getAll).toHaveBeenCalledWith('agent-123');
      expect(mockStateRepo.delete).toHaveBeenCalledTimes(3);
      expect(mockStateRepo.delete).toHaveBeenCalledWith('agent-123', 'key1');
      expect(mockStateRepo.delete).toHaveBeenCalledWith('agent-123', 'key2');
      expect(mockStateRepo.delete).toHaveBeenCalledWith('agent-123', 'key3');
      expect(mockLogger.info).toHaveBeenCalledWith(
        { agentId: 'agent-123' },
        'State cleared'
      );
    });

    it('should handle empty state', async () => {
      mockStateRepo.getAll.mockResolvedValue({});

      const manager = createStateManager('agent-123', 'ceo');
      await manager.clear();

      expect(mockStateRepo.delete).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        { agentId: 'agent-123' },
        'State cleared'
      );
    });

    it('should throw error on failure', async () => {
      const error = new Error('Clear failed');
      mockStateRepo.getAll.mockRejectedValue(error);

      const manager = createStateManager('agent-123', 'ceo');

      await expect(manager.clear()).rejects.toThrow('Clear failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        { agentId: 'agent-123', error },
        'Failed to clear state'
      );
    });
  });

  describe('StateKeys constants', () => {
    it('should have all required state keys', () => {
      expect(StateKeys).toHaveProperty('LAST_LOOP_AT');
      expect(StateKeys).toHaveProperty('LAST_LOOP_RESULT');
      expect(StateKeys).toHaveProperty('LOOP_COUNT');
      expect(StateKeys).toHaveProperty('ERROR_COUNT');
      expect(StateKeys).toHaveProperty('SUCCESS_COUNT');
      expect(StateKeys).toHaveProperty('CURRENT_FOCUS');
      expect(StateKeys).toHaveProperty('PENDING_TASKS');
      expect(StateKeys).toHaveProperty('COMPLETED_TASKS');
      expect(StateKeys).toHaveProperty('LAST_STATUS_REPORT');
      expect(StateKeys).toHaveProperty('UNREAD_MESSAGES');
      expect(StateKeys).toHaveProperty('CUSTOM_PREFIX');
    });

    it('should have correct values', () => {
      expect(StateKeys.LAST_LOOP_AT).toBe('last_loop_at');
      expect(StateKeys.LOOP_COUNT).toBe('loop_count');
      expect(StateKeys.CUSTOM_PREFIX).toBe('custom:');
    });
  });

  describe('customKey helper', () => {
    it('should create prefixed custom keys', () => {
      expect(customKey('my_key')).toBe('custom:my_key');
      expect(customKey('another')).toBe('custom:another');
    });

    it('should handle empty strings', () => {
      expect(customKey('')).toBe('custom:');
    });

    it('should handle special characters', () => {
      expect(customKey('key-with-dashes')).toBe('custom:key-with-dashes');
      expect(customKey('key_with_underscores')).toBe('custom:key_with_underscores');
    });
  });

  describe('integration scenarios', () => {
    it('should handle typical agent state workflow', async () => {
      mockStateRepo.get.mockResolvedValue(null);
      mockStateRepo.set.mockResolvedValue(undefined);
      mockStateRepo.getAll.mockResolvedValue({
        'loop_count': 5,
        'last_loop_at': '2025-12-12T00:00:00Z',
      });

      const manager = createStateManager('agent-123', 'ceo');

      // Initialize counters
      await manager.set(StateKeys.LOOP_COUNT, 0);
      await manager.set(StateKeys.ERROR_COUNT, 0);

      // Get current count
      mockStateRepo.get.mockResolvedValue(5);
      const count = await manager.get<number>(StateKeys.LOOP_COUNT);

      // Increment
      await manager.set(StateKeys.LOOP_COUNT, (count || 0) + 1);

      // Get all state
      const allState = await manager.getAll();

      expect(allState).toHaveProperty('loop_count');
      expect(mockStateRepo.set).toHaveBeenCalled();
    });

    it('should handle different agent types', async () => {
      const agentTypes: AgentType[] = ['ceo', 'dao', 'cmo', 'cto', 'cfo', 'coo', 'cco'];

      agentTypes.forEach((type, index) => {
        const manager = createStateManager(`agent-${index}`, type);
        expect(manager).toBeDefined();
      });

      expect(mockLogger.info).toHaveBeenCalledTimes(agentTypes.length);
    });
  });
});
