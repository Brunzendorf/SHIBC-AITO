# Agent Profiles

Each agent has a markdown profile in `/profiles/` that defines its behavior.

## Profile Structure

```markdown
# Agent Name

## Identity
**Role:** Chief Marketing Officer (CMO)
**Codename:** SHIBC-CMO-001
**Department:** Marketing
**Reports To:** CEO Agent

## Mission Statement
Description of agent's mission...

## Core Responsibilities
- Responsibility 1
- Responsibility 2

## Decision Authority
### Kann alleine entscheiden
- Minor decisions...

### Braucht CEO Approval
- Medium decisions...

### Braucht DAO Vote
- Major decisions...

## Loop Schedule
**Interval:** Alle 4 Stunden (14400 Sekunden)

## Guiding Principles
1. Principle one
2. Principle two

## MCP Workers - External Tool Access
(See MCP_WORKERS.md for details)

### Available MCP Servers
- `telegram` - Telegram Bot API
- `fetch` - HTTP requests
- `filesystem` - File access

### Spawn Worker Format
{ "type": "spawn_worker", "task": "...", "servers": ["..."] }
```

## Parsed Fields

The profile parser (`src/agents/profile.ts`) extracts:

| Field | Source |
|-------|--------|
| `name` | `## Identity` → `**Role:**` |
| `codename` | `## Identity` → `**Codename:**` |
| `department` | `## Identity` → `**Department:**` |
| `reportsTo` | `## Identity` → `**Reports To:**` |
| `mission` | `## Mission Statement` content |
| `responsibilities` | `## Core Responsibilities` bullet points |
| `decisionAuthority` | `## Decision Authority` subsections |
| `loopInterval` | Parsed from "X Sekunden" or "Alle X Stunden" |
| `guidingPrinciples` | `## Guiding Principles` bullet points |
| `startupPrompt` | `## Startup Prompt` code block |
| `rawContent` | Full markdown for MCP section extraction |

## System Prompt Generation

The `generateSystemPrompt()` function builds the prompt:

1. Name, identity, mission, responsibilities
2. Guiding principles
3. Startup prompt
4. **MCP Workers section** (extracted from rawContent)

## Adding MCP Section

Each profile should include:

```markdown
## MCP Workers - External Tool Access

### Available MCP Servers
- `telegram` - Telegram Bot API
- `fetch` - HTTP requests
- `filesystem` - File access

### Spawn Worker Format
{ "type": "spawn_worker", "task": "...", "servers": ["telegram"] }
```

This section is automatically included in the system prompt.
