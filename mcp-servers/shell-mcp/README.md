# Shell MCP Server

Secure Shell MCP Server for SHIBC CTO - provides safe command execution with whitelisting, path restrictions, and audit logging.

## Features

- **7 Tools**: exec, which, env, file_exists, read_file, write_file, list_dir
- **Command Whitelist**: Only allowed commands can be executed
- **Path Restrictions**: Operations only within configured paths
- **Forbidden Patterns**: Blocks dangerous command patterns
- **Timeout Support**: Configurable command timeout with force kill
- **Audit Logging**: All operations logged to stderr (JSON format)

## Installation

```bash
npm install
npm run build
```

## Usage

### As MCP Server

```json
{
  "shell": {
    "command": "node",
    "args": ["./mcp-servers/shell-mcp/dist/index.js"],
    "env": {
      "ALLOWED_PATHS": "/app/workspace",
      "ALLOWED_COMMANDS": "npm,node,npx,tsc,vitest,docker,ls,cat"
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_PATHS` | `/app/workspace` | Comma-separated allowed working directories |
| `ALLOWED_COMMANDS` | `npm,node,npx,tsc,...` | Comma-separated allowed command prefixes |
| `FORBIDDEN_PATTERNS` | `rm -rf /,sudo,...` | Blocked command patterns |
| `DEFAULT_TIMEOUT` | `30000` | Default timeout in ms |
| `MAX_TIMEOUT` | `300000` | Maximum allowed timeout |
| `MAX_OUTPUT_SIZE` | `100000` | Max output size in bytes |

## Available Tools

### Command Execution

| Tool | Description |
|------|-------------|
| `shell_exec` | Execute a whitelisted command with timeout |
| `shell_which` | Check if a command exists |

### Environment

| Tool | Description |
|------|-------------|
| `shell_env` | Get safe environment variable value |

### File Operations

| Tool | Description |
|------|-------------|
| `shell_file_exists` | Check if file/directory exists |
| `shell_read_file` | Read file contents |
| `shell_write_file` | Write content to file |
| `shell_list_dir` | List directory contents |

## Security

### Command Whitelist

Only these command prefixes are allowed by default:
- `npm`, `node`, `npx` - Node.js tools
- `tsc`, `vitest` - TypeScript/testing
- `docker` - Container operations
- `ls`, `cat`, `head`, `tail`, `wc` - File viewing
- `grep`, `find` - Searching
- `pwd`, `echo`, `mkdir`, `cp`, `mv`, `touch` - Basic operations

### Forbidden Patterns

These patterns are blocked:
- `rm -rf /` - Dangerous deletions
- `sudo` - Privilege escalation
- `chmod 777` - Dangerous permissions
- `eval(`, `exec(` - Code injection
- Shell chaining (`;sh`, `|bash`, etc.)

### Path Restrictions

All paths validated against `ALLOWED_PATHS`. Operations outside are blocked.

### Safe Environment Variables

Only safe env vars can be read (NODE_*, NPM_*, PATH, etc.). Sensitive vars (TOKEN, SECRET, KEY, PASSWORD) are blocked.

## Example Calls

### Execute Command
```json
{
  "tool": "shell_exec",
  "arguments": {
    "command": "npm run build",
    "cwd": "/app/workspace/projects/website",
    "timeout": 60000
  }
}
```

### Check File
```json
{
  "tool": "shell_file_exists",
  "arguments": {
    "path": "/app/workspace/projects/website/package.json"
  }
}
```

### List Directory
```json
{
  "tool": "shell_list_dir",
  "arguments": {
    "path": "/app/workspace/projects",
    "recursive": true,
    "maxDepth": 2
  }
}
```

## Development

```bash
npm install
npm run build
npm run typecheck
npm run dev
```

## License

MIT - Part of SHIBC AITO System
