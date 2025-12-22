# Session Pool System

**Status:** EXPERIMENTAL
**Version:** 1.0.0
**Author:** AITO Development Team
**Created:** 2024-12

## Overview

The Session Pool System is an optimization layer that dramatically reduces Claude CLI token usage by maintaining persistent sessions instead of spawning new processes for each agent loop.

### Problem Statement

In the traditional single-shot mode:
- Each agent loop spawns a new `claude --print` process
- The full agent profile (~10K+ tokens) is sent every time
- No context is preserved between loops
- High token consumption, especially with frequent loops

### Solution

The Session Pool uses Claude CLI's `--input-format=stream-json --output-format=stream-json` mode to:
- Maintain persistent bidirectional sessions
- Inject the agent profile once at session start
- Send only incremental updates (trigger data) per loop
- Preserve context between loops
- Automatically handle `/compact` by re-injecting minimal context

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Container                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌─────────────────────────────────────┐   │
│  │   Daemon     │    │         Session Pool                │   │
│  │              │───▶│  ┌─────────────────────────────┐   │   │
│  │  runLoop()   │    │  │    ClaudeStreamSession      │   │   │
│  │              │    │  │  ┌─────────────────────┐    │   │   │
│  └──────────────┘    │  │  │ Claude CLI Process  │    │   │   │
│                      │  │  │ (stream-json mode)  │    │   │   │
│                      │  │  └─────────────────────┘    │   │   │
│                      │  └─────────────────────────────┘   │   │
│                      └─────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. ClaudeStreamSession (`session-pool.ts`)

A single persistent Claude CLI session with bidirectional JSON streaming.

**Responsibilities:**
- Start/stop Claude CLI process in stream-json mode
- Inject agent profile at session start
- Send messages and receive responses
- Handle `/compact` command (re-inject minimal context)
- Track loop count and costs
- Determine when to recycle (max loops, idle timeout, errors)

**Key Methods:**
```typescript
class ClaudeStreamSession {
  async start(): Promise<boolean>           // Start Claude process
  async injectProfile(): Promise<boolean>   // Send initial profile
  async sendMessage(content: string): Promise<string>  // Execute loop
  async stop(): Promise<void>               // Graceful shutdown

  isAvailable(): boolean      // Can accept new work
  shouldRecycle(): boolean    // Should be replaced
  getStatus(): SessionStatus  // Health/status info
}
```

**Session States:**
- `idle` - Ready for new work
- `busy` - Processing a message
- `compacting` - Re-injecting context after /compact
- `error` - Encountered an error
- `dead` - Process terminated

### 2. SessionPool (`session-pool.ts`)

Manages a pool of sessions across all agents.

**Responsibilities:**
- Assign sessions to agents (one session per agent)
- Create new sessions on demand
- Recycle stale sessions (max loops, idle timeout)
- Provide statistics for monitoring

**Key Methods:**
```typescript
class SessionPool {
  async getSession(config: SessionConfig): Promise<ClaudeStreamSession>
  async stop(): Promise<void>  // Shutdown all sessions
  getStats(): PoolStats        // Monitoring data
}
```

### 3. SessionExecutor (`session-executor.ts`)

Integration layer that makes session pool a drop-in replacement.

**Responsibilities:**
- Feature flag check (`SESSION_POOL_ENABLED`)
- Fall back to single-shot mode when disabled
- Build optimized prompts for session mode
- Provide retry logic with exponential backoff
- Token usage estimation

**Key Functions:**
```typescript
// Main execution function (replaces executeClaudeCodeWithRetry)
async function executeWithSession(
  config: SessionExecutorConfig,
  prompt: string,
  systemPrompt?: string,
  timeout?: number
): Promise<ClaudeResult>

// Build optimized prompt for session mode
function buildSessionLoopPrompt(
  trigger: { type: string; data?: unknown },
  state: Record<string, unknown>,
  options?: LoopOptions
): string

// Get pool statistics
function getSessionPoolStats(): { enabled: boolean; stats: PoolStats | null }
```

## Token Savings

### Comparison

| Metric | Single-Shot Mode | Session Pool Mode |
|--------|-----------------|-------------------|
| Profile sent | Every loop | Once per session |
| Input tokens/loop | ~10,000 | ~2,000 |
| Context preserved | No | Yes |
| Process overhead | High (spawn each time) | Low (reuse process) |

### Estimated Savings

With a typical agent running loops every 15 minutes:
- **Single-shot:** 10,000 tokens × 96 loops/day = **960,000 tokens/day**
- **Session pool:** 10,000 tokens × 1 + 2,000 tokens × 95 = **200,000 tokens/day**
- **Savings: ~79%**

## Configuration

### Environment Variables

```bash
# Enable session pool (default: false)
SESSION_POOL_ENABLED=true

# Maximum loops before session recycling (default: 50)
SESSION_MAX_LOOPS=50

# Idle timeout in milliseconds (default: 30 minutes)
SESSION_IDLE_TIMEOUT_MS=1800000
```

### Per-Agent Override

Currently, all agents share the same configuration. Future versions may support per-agent settings.

## Usage

### Enabling Session Pool

1. Set environment variable:
   ```bash
   export SESSION_POOL_ENABLED=true
   ```

2. Or in `.env`:
   ```env
   SESSION_POOL_ENABLED=true
   ```

3. Or in `docker-compose.yml` (already configured):
   ```yaml
   environment:
     SESSION_POOL_ENABLED: ${SESSION_POOL_ENABLED:-false}
   ```

### Monitoring

#### API Endpoint

```bash
curl http://localhost:8080/health/sessions
```

Response:
```json
{
  "enabled": true,
  "config": {
    "maxLoops": 50,
    "idleTimeoutMs": 1800000
  },
  "description": "Session pool reduces token usage by ~80% using persistent Claude CLI sessions"
}
```

#### Agent Health Status

Agent health now includes session pool info:
```json
{
  "healthy": true,
  "agentType": "cmo",
  "sessionPool": {
    "enabled": true,
    "totalSessions": 1,
    "sessionState": "idle"
  }
}
```

#### Redis Cost Tracking

Session costs are tracked in Redis:
```bash
redis-cli GET "cost:cmo:2024-12-21"
```

## Session Lifecycle

### 1. Session Start

```
Agent Start → Pool.getSession() → Create ClaudeStreamSession
                                         │
                                         ▼
                               session.start() (spawn claude CLI)
                                         │
                                         ▼
                               session.injectProfile() (send full profile)
                                         │
                                         ▼
                               Session ready for loops
```

### 2. Loop Execution

```
Trigger received → buildSessionLoopPrompt() (optimized, no profile)
                           │
                           ▼
                   session.sendMessage(prompt)
                           │
                           ▼
                   Parse response, execute actions
```

### 3. Session Recycling

Sessions are recycled when:
- Loop count reaches `SESSION_MAX_LOOPS`
- Idle time exceeds `SESSION_IDLE_TIMEOUT_MS`
- Session enters error state
- `/compact` command is detected (session reinjects minimal context)

### 4. Graceful Shutdown

```
Agent Stop → shutdownExecutor() → pool.stop()
                                      │
                                      ▼
                              For each session:
                                session.stop() (send /exit, kill process)
```

## Error Handling

### Retryable Errors

The following errors trigger automatic retry:
- Timeout
- Session not running
- Session is busy
- Rate limiting (529, 503, 502)
- API overload

### Non-Retryable Errors

These errors fail immediately:
- Authentication errors
- Invalid request format
- Claude CLI not available

### Recovery Flow

```
Error detected → Is retryable?
                      │
              Yes ────┴──── No
               │             │
               ▼             ▼
        Exponential      Return error
        backoff wait
               │
               ▼
        Retry (up to 3x)
```

## /compact Handling

When Claude CLI context fills up, it may trigger `/compact`:

1. Session detects compact in stderr
2. Session state changes to `compacting`
3. Wait for pending response
4. Re-inject minimal context (role, responsibilities, response format)
5. Session state returns to `idle`

### Minimal Context Template

```markdown
# Context Reminder - [Agent Name] ([CODENAME])

## Your Role
[Agent mission statement]

## Key Responsibilities
- [Top 5 responsibilities]

## Department
[Department name]

## Response Format (JSON)
{ "actions": [...], "messages": [...], "stateUpdates": {...}, "summary": "..." }

Continue processing tasks as before.
```

## Limitations

### Current Limitations

1. **Single session per agent** - No concurrent processing within an agent
2. **No MCP in session mode** - MCP tools work via workers, not sessions
3. **Memory growth** - Long sessions may accumulate context
4. **Compact uncertainty** - `/compact` timing is controlled by Claude

### Known Issues

1. **Session ID capture** - May not always capture session ID from output
2. **Error state recovery** - Some error states require manual restart
3. **Cost tracking precision** - Costs may not always be reported

## Testing

### Unit Tests

```bash
npm test -- src/agents/session-pool.test.ts
npm test -- src/agents/session-executor.test.ts
```

### Integration Testing

Use the test-agent for isolated E2E testing:

```bash
# Start test infrastructure
docker compose -f docker-compose.test.yml up -d

# Run test suite
npm run test:e2e:session-pool
```

### Manual Testing

1. Enable session pool for a single agent:
   ```bash
   docker compose run --rm -e SESSION_POOL_ENABLED=true cmo-agent
   ```

2. Monitor logs:
   ```bash
   docker logs -f aito-cmo 2>&1 | grep -i session
   ```

3. Check session stats:
   ```bash
   curl http://localhost:8080/health/sessions
   ```

## Rollback

To disable session pool:

1. Set `SESSION_POOL_ENABLED=false`
2. Restart agents
3. Agents automatically fall back to single-shot mode

No data migration needed - session state is ephemeral.

## Future Improvements

### Planned

- [ ] Per-agent session pool configuration
- [ ] Session persistence across restarts (resume)
- [ ] Dynamic session scaling
- [ ] Cost budget enforcement
- [ ] Session sharing for read-only operations

### Under Consideration

- Multi-session per agent for concurrent tasks
- Priority queuing for urgent loops
- Automatic session warm-up
- Cross-container session sharing

## Troubleshooting

### Session Not Starting

```
Error: Failed to start session for cmo
```

**Causes:**
- Claude CLI not installed or authenticated
- MCP config path invalid
- Working directory doesn't exist

**Solutions:**
- Check `claude --version` in container
- Verify `claude auth status`
- Check MCP config path exists

### Session Stuck in Busy State

```
Error: Session is busy
```

**Causes:**
- Previous request still processing
- Claude CLI hung
- Network issues

**Solutions:**
- Wait for timeout (5 minutes)
- Restart agent container
- Check Claude API status

### High Token Usage Despite Session Pool

**Causes:**
- Sessions recycling too frequently
- `/compact` triggering often
- Large trigger data

**Solutions:**
- Increase `SESSION_MAX_LOOPS`
- Reduce loop frequency
- Optimize trigger data size

## Changelog

### v1.0.0 (2024-12)

- Initial implementation
- Core session management
- Feature flag support
- Basic /compact handling
- Cost tracking in Redis
