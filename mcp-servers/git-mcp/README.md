# Git MCP Server

Secure Git MCP Server for SHIBC CTO - provides safe local git operations with path restrictions and audit logging.

## Features

- **13 Git Tools**: clone, status, add, commit, push, pull, branch, log, diff, stash, merge, init, remote
- **Path Restrictions**: Operations only allowed within configured paths
- **Forbidden Commands**: Blocks dangerous operations (force push, hard reset)
- **Audit Logging**: All operations logged to stderr (JSON format)
- **Author Config**: Automatic author attribution for commits

## Installation

```bash
npm install
npm run build
```

## Usage

### As MCP Server

```json
{
  "git": {
    "command": "node",
    "args": ["./mcp-servers/git-mcp/dist/index.js"],
    "env": {
      "ALLOWED_PATHS": "/app/workspace/projects",
      "GIT_AUTHOR_NAME": "SHIBC CTO",
      "GIT_AUTHOR_EMAIL": "cto@shibaclassic.io"
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_PATHS` | `/app/workspace/projects` | Comma-separated allowed paths |
| `GIT_AUTHOR_NAME` | `SHIBC CTO` | Git commit author name |
| `GIT_AUTHOR_EMAIL` | `cto@shibaclassic.io` | Git commit author email |
| `FORBIDDEN_COMMANDS` | `push --force,reset --hard,clean -fd,push -f` | Blocked command patterns |

## Available Tools

### Repository Management

| Tool | Description |
|------|-------------|
| `git_clone` | Clone a repository to local path |
| `git_init` | Initialize new git repository |
| `git_remote` | List, add, or remove remotes |

### Working Tree

| Tool | Description |
|------|-------------|
| `git_status` | Get repository status |
| `git_add` | Stage files for commit |
| `git_commit` | Create commit with staged changes |
| `git_diff` | Show changes between commits/working tree |
| `git_stash` | Stash or restore changes |

### Branches

| Tool | Description |
|------|-------------|
| `git_branch` | List, create, switch, or delete branches |
| `git_merge` | Merge branch into current |
| `git_log` | Get commit history |

### Remote Operations

| Tool | Description |
|------|-------------|
| `git_push` | Push commits to remote |
| `git_pull` | Pull changes from remote |

## Security

### Path Restrictions

All paths are validated against `ALLOWED_PATHS`. Operations outside allowed directories are blocked.

```typescript
// Error: Security: Path not allowed: /etc/passwd
```

### Forbidden Commands

These patterns are blocked by default:
- `push --force` / `push -f` (force push)
- `reset --hard` (hard reset)
- `clean -fd` (force delete)

### Audit Logging

All operations are logged to stderr in JSON format:

```json
{
  "ts": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "component": "git-mcp",
  "msg": "Commit created",
  "path": "/app/workspace/projects/website",
  "commit": "abc123",
  "author": "SHIBC CTO"
}
```

## Example Calls

### Clone Repository
```json
{
  "tool": "git_clone",
  "arguments": {
    "url": "https://github.com/org/repo.git",
    "path": "/app/workspace/projects/repo",
    "branch": "main",
    "depth": 1
  }
}
```

### Create Commit
```json
{
  "tool": "git_commit",
  "arguments": {
    "path": "/app/workspace/projects/repo",
    "message": "feat(ui): add dark mode toggle"
  }
}
```

### Push Changes
```json
{
  "tool": "git_push",
  "arguments": {
    "path": "/app/workspace/projects/repo",
    "remote": "origin",
    "branch": "feature/dark-mode",
    "setUpstream": true
  }
}
```

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Type check without emit
npm run typecheck

# Dev mode with tsx
npm run dev
```

## License

MIT - Part of SHIBC AITO System
