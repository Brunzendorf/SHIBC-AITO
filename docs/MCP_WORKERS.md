# MCP Workers

MCP (Model Context Protocol) Workers provide agents with external tool access.

## How It Works

1. Agent outputs a `spawn_worker` action in its JSON response
2. Daemon validates the action and spawns a worker
3. Worker generates dynamic MCP config with only requested servers
4. Worker runs Claude Code with `--mcp-config` flag
5. Claude has native access to MCP tools
6. Result returned to agent via `worker_result` message

## Spawn Worker Action Format

```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Natural language description of what to do",
    "servers": ["telegram", "filesystem"],
    "timeout": 60000
  }]
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be `"spawn_worker"` |
| `task` | string | Yes | Natural language task description |
| `servers` | string[] | Yes | Array of MCP server names |
| `timeout` | number | No | Timeout in ms (default: 60000) |

## Available MCP Servers

### telegram

Telegram Bot API access.

**Tools:**
- `tg_send` - Send message
- `tg_edit` - Edit message
- `tg_delete` - Delete message
- `tg_pin` - Pin message
- `tg_get_chat` - Get chat info

**Example:**
```json
{
  "type": "spawn_worker",
  "task": "Send message to Telegram channel -1002876952840: Hello World!",
  "servers": ["telegram"]
}
```

### filesystem

Local filesystem access.

**Tools:**
- `read_file` - Read file contents
- `write_file` - Write to file
- `list_directory` - List directory contents

**Allowed paths:** `/app/workspace`, `/app/profiles`

**Example:**
```json
{
  "type": "spawn_worker",
  "task": "Write report to /app/workspace/marketing/report.md",
  "servers": ["filesystem"]
}
```

### fetch

HTTP requests to external APIs.

**Tools:**
- `fetch` - Make HTTP request

**Example:**
```json
{
  "type": "spawn_worker",
  "task": "Fetch data from https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
  "servers": ["fetch"]
}
```

## Worker Result

Workers return results via `worker_result` message:

```json
{
  "type": "worker_result",
  "taskId": "uuid-of-task",
  "success": true,
  "result": "Message sent successfully to channel -1002876952840",
  "toolsUsed": ["tg_send"],
  "duration": 2341
}
```

## Configuration

MCP servers are defined in `.claude/mcp_servers.json`:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["@anthropic-ai/mcp-server-telegram"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "..."
      }
    }
  }
}
```

## Troubleshooting

### "Invalid spawn_worker action"

Missing required fields. Ensure you have:
- `type: "spawn_worker"`
- `task: "..."` (string)
- `servers: [...]` (array)

### Worker timeout

Increase timeout or simplify task:
```json
{ "timeout": 120000 }
```

### MCP server not found

Check server name matches key in `mcp_servers.json`.
