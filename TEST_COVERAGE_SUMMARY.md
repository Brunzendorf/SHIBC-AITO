# Test Coverage Summary for MCP and Worker Modules

## Overview

Created comprehensive test suites for the MCP (Model Context Protocol) and Worker system with **113 total test cases** across **1,995 lines of test code**.

## Files Created

### 1. `src/lib/mcp.test.ts` (749 lines, 37 test cases)

Tests the MCP server configuration and client management system.

#### Test Coverage:

**loadMCPConfig (5 tests)**
- ✓ Load MCP config from file
- ✓ Use custom config path from environment variable
- ✓ Return default config on file read error
- ✓ Return default config on JSON parse error
- ✓ Handle missing mcpServers key in config

**MCPClient (18 tests)**
- ✓ Create MCPClient instance
- ✓ Start MCP server process
- ✓ Handle environment variable placeholders (${VAR} syntax)
- ✓ Get tools from server
- ✓ Call tool with arguments
- ✓ Throw error when calling tool before initialization
- ✓ Handle request timeout (30s timeout)
- ✓ Handle JSON-RPC error responses
- ✓ Ignore non-JSON output on stdout
- ✓ Handle process errors
- ✓ Handle process exit events
- ✓ Stop MCP server process
- ✓ Handle stop when process is null
- ✓ Send JSON-RPC requests correctly
- ✓ Parse JSON-RPC responses
- ✓ Track initialization state
- ✓ Handle stderr logging
- ✓ Clean up response handlers

**MCPManager (10 tests)**
- ✓ Create MCPManager instance
- ✓ Initialize MCP servers for agent type (reads from MCP_SERVERS_BY_AGENT)
- ✓ Handle missing server config gracefully
- ✓ Handle server start failures
- ✓ Get all tools from all servers
- ✓ Call tool by name and auto-route to correct server
- ✓ Throw error for unknown tool
- ✓ Get specific server client
- ✓ Return undefined for non-existent client
- ✓ Stop all servers

**getMCPManager (1 test)**
- ✓ Return singleton instance

**MCP_SERVERS_BY_AGENT (3 tests)**
- ✓ Define servers for each agent type (CEO, CMO, CTO, CFO, COO, CCO, DAO)
- ✓ CMO has telegram access
- ✓ All agents have filesystem access

### 2. `src/workers/spawner.test.ts` (544 lines, 30 test cases)

Tests the worker spawning and lifecycle management system.

#### Test Coverage:

**spawnWorker (10 tests)**
- ✓ Spawn a worker and return result
- ✓ Pass context and timeout to worker
- ✓ Use default timeout (60s) if not provided
- ✓ Reject worker if server access denied
- ✓ Reject worker if task validation fails
- ✓ Reject worker if max concurrent workers reached (default: 3)
- ✓ Allow new workers after previous ones complete
- ✓ Track workers per agent separately
- ✓ Decrement worker count even on failure
- ✓ Generate unique task IDs using crypto.randomUUID()

**spawnWorkerAsync (8 tests)**
- ✓ Spawn worker and send result via Redis pub/sub
- ✓ Include worker result in message payload
- ✓ Handle worker errors gracefully (no throw)
- ✓ Set message priority to 'normal'
- ✓ Set requiresResponse to false
- ✓ Pass context and timeout correctly
- ✓ Publish to correct channel (channel:agent:<agentId>)
- ✓ Create proper AgentMessage structure

**getActiveWorkerCount (3 tests)**
- ✓ Return 0 for agent with no active workers
- ✓ Return correct count of active workers
- ✓ Return 0 after workers complete

**getAllActiveWorkers (3 tests)**
- ✓ Return empty map when no workers
- ✓ Return map of all active workers
- ✓ Return independent copy of worker map

**MAX_CONCURRENT_WORKERS (2 tests)**
- ✓ Respect custom max concurrent workers from WORKER_MAX_CONCURRENT env var
- ✓ Use default of 3 if env not set

**Concurrency Control (4 tests)**
- ✓ Validate server access before spawning
- ✓ Validate task structure before spawning
- ✓ Track active workers in map
- ✓ Clean up worker tracking on completion

### 3. `src/workers/worker.test.ts` (702 lines, 46 test cases)

Tests the core worker execution engine and MCP integration.

#### Test Coverage:

**validateServerAccess (6 tests)**
- ✓ Validate allowed servers for agent (using MCP_SERVERS_BY_AGENT)
- ✓ Reject disallowed servers
- ✓ Reject multiple disallowed servers
- ✓ Handle mixed allowed/denied servers
- ✓ Handle unknown agent type
- ✓ Validate all agents have filesystem access

**validateWorkerTask (8 tests)**
- ✓ Validate complete task structure
- ✓ Reject task without id
- ✓ Reject task without parentAgent
- ✓ Reject task without task description
- ✓ Reject task without servers
- ✓ Reject task with empty servers array
- ✓ Collect multiple validation errors
- ✓ Return detailed error messages

**executeWorker (32 tests)**

*Successful Execution:*
- ✓ Execute worker successfully with full flow
- ✓ Generate MCP config file in /tmp
- ✓ Cleanup MCP config file after execution
- ✓ Cleanup config even on error
- ✓ Handle cleanup errors gracefully

*Configuration & Setup:*
- ✓ Pass task and context to Claude
- ✓ Exclude context section if no context provided
- ✓ Pass MCP config path to Claude
- ✓ Use custom timeout if provided
- ✓ Use default timeout (60s) if not provided
- ✓ Generate config with only requested servers
- ✓ Handle multiple servers in config
- ✓ Filter servers based on loadMCPConfig result

*Access Control:*
- ✓ Reject if server access denied
- ✓ Reject if Claude not available
- ✓ Reject if no MCP servers configured

*Output Parsing:*
- ✓ Parse JSON output from Claude
- ✓ Handle non-JSON output from Claude
- ✓ Extract JSON from mixed output (text + JSON)
- ✓ Truncate long output (>1000 chars)
- ✓ Default success to true if not in parsed output
- ✓ Respect success: false from Claude output
- ✓ Handle missing toolsUsed in output

*Error Handling:*
- ✓ Handle Claude execution failure
- ✓ Handle Claude throwing error
- ✓ Handle non-Error exceptions (string errors, etc.)
- ✓ Return proper error structure on failures

*Logging:*
- ✓ Log tool calls to Redis (channel:worker:logs)
- ✓ Log to worker:logs:history with trimming (keep last 1000)
- ✓ Log errors to Redis
- ✓ Handle Redis logging errors gracefully

*Result Structure:*
- ✓ Include duration in result
- ✓ Include taskId in result
- ✓ Include success status
- ✓ Include result/output data
- ✓ Include toolsUsed array

## Test Utilities & Mocking Strategy

### Mocked Dependencies:

1. **child_process** - Mocked spawn to simulate MCP server processes
2. **fs** - Mocked readFileSync, writeFileSync, unlinkSync, existsSync
3. **logger** - Mocked pino logger to suppress console output
4. **redis** - Mocked Redis publisher and channels
5. **claude.js** - Mocked executeClaudeCodeWithMCP and isClaudeAvailable
6. **mcp.js** - Mocked MCP_SERVERS_BY_AGENT and loadMCPConfig
7. **crypto** - Mocked randomUUID for predictable test IDs

### Mock Patterns Used:

```typescript
// Type-safe mock functions
vi.fn<any, any>()

// Module mocking
vi.mock('./module', () => ({ ... }))

// Mock reset between tests
vi.resetModules()
vi.clearAllMocks()

// Async mock responses
mockFn.mockResolvedValue(...)
mockFn.mockRejectedValue(...)
```

## Key Testing Features

### 1. Edge Case Coverage
- Empty/missing/invalid inputs
- Timeout scenarios (30s for MCP requests, configurable for workers)
- Network/process failures
- Malformed JSON responses
- Resource cleanup on errors

### 2. Concurrency Testing
- Max worker limits (default: 3)
- Per-agent worker tracking
- Worker count management
- Concurrent execution scenarios

### 3. Integration Points
- Redis pub/sub messaging
- Claude Code CLI execution
- MCP server spawning
- File system operations
- JSON-RPC protocol

### 4. Security Validation
- Server access control per agent type
- Task validation before execution
- Environment variable handling
- Proper error message sanitization

## Coverage Goals

Target: **>90% coverage** for all three files

### Expected Coverage:

**mcp.ts**
- Lines: ~95% (all major paths covered)
- Functions: ~100% (all exported functions tested)
- Branches: ~90% (error paths + success paths)

**spawner.ts**
- Lines: ~95% (concurrency logic fully tested)
- Functions: ~100% (all exports tested)
- Branches: ~92% (edge cases covered)

**worker.ts**
- Lines: ~96% (execution flow + error handling)
- Functions: ~100% (all exports tested)
- Branches: ~93% (validation + parsing logic)

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test src/lib/mcp.test.ts

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch

# UI mode
npm run test:ui
```

## Test Architecture

### Setup Flow:
1. `tests/setup.ts` - Global test setup
   - Mock environment variables
   - Mock pino logger
   - Clear mocks after each test

2. Test Files - Per-module setup
   - Mock module-specific dependencies
   - Reset modules between tests
   - Set up default mock behaviors

### Test Structure:
```typescript
describe('Module', () => {
  beforeEach(() => {
    // Reset and setup mocks
  });

  afterEach(() => {
    // Cleanup
  });

  describe('Function/Class', () => {
    it('should handle specific case', async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

## Notes

- All tests use vitest with vi.fn() and vi.mock()
- Tests are isolated and can run in any order
- Mock implementations reset between tests
- Async operations properly awaited
- Timeouts configured appropriately (10s test timeout in vitest.config.ts)
- Background processes properly mocked (no real processes spawned)
