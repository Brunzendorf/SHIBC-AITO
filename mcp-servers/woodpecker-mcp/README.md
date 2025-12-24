# Woodpecker CI MCP Server

CI/CD pipeline management MCP Server for SHIBC CTO - provides Woodpecker CI API access for build automation.

## Features

- **14 Tools**: Repository, pipeline, log, and secret operations
- **Bearer Token Auth**: Personal Access Token authentication
- **Pipeline Control**: Create, restart, cancel, approve/decline
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
  "woodpecker": {
    "command": "node",
    "args": ["./mcp-servers/woodpecker-mcp/dist/index.js"],
    "env": {
      "WOODPECKER_URL": "https://ci.example.com",
      "WOODPECKER_TOKEN": "${WOODPECKER_TOKEN}"
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WOODPECKER_URL` | Yes | Woodpecker server URL |
| `WOODPECKER_TOKEN` | Yes | Personal Access Token |

## Available Tools

### User/Auth

| Tool | Description |
|------|-------------|
| `woodpecker_user` | Get current authenticated user |
| `woodpecker_version` | Get server version |

### Repository Operations

| Tool | Description |
|------|-------------|
| `woodpecker_repos` | List all repositories |
| `woodpecker_repo` | Get repository details |
| `woodpecker_repo_activate` | Activate CI for a repository |
| `woodpecker_secrets` | List repository secrets (names only) |

### Pipeline Operations

| Tool | Description |
|------|-------------|
| `woodpecker_pipelines` | List pipelines for repository |
| `woodpecker_pipeline` | Get pipeline details with steps |
| `woodpecker_pipeline_create` | Trigger a new build |
| `woodpecker_pipeline_restart` | Retry a pipeline |
| `woodpecker_pipeline_cancel` | Cancel running pipeline |
| `woodpecker_pipeline_approve` | Approve pending pipeline |
| `woodpecker_pipeline_decline` | Decline pending pipeline |
| `woodpecker_logs` | Get step logs |

## Authentication

Create a Personal Access Token in Woodpecker:

1. Log into Woodpecker
2. Go to User Settings (top right)
3. Create new Access Token
4. Copy token and set as `WOODPECKER_TOKEN`

## Example Calls

### List Pipelines
```json
{
  "tool": "woodpecker_pipelines",
  "arguments": {
    "owner": "og-shibaclassic",
    "repo": "website",
    "page": 1,
    "perPage": 10
  }
}
```

### Trigger Build
```json
{
  "tool": "woodpecker_pipeline_create",
  "arguments": {
    "owner": "og-shibaclassic",
    "repo": "website",
    "branch": "main"
  }
}
```

### Get Logs
```json
{
  "tool": "woodpecker_logs",
  "arguments": {
    "owner": "og-shibaclassic",
    "repo": "website",
    "pipeline": 42,
    "step": 1
  }
}
```

### Cancel Build
```json
{
  "tool": "woodpecker_pipeline_cancel",
  "arguments": {
    "owner": "og-shibaclassic",
    "repo": "website",
    "pipeline": 42
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

## Sources

- [Woodpecker CI API](https://woodpecker-ci.org/api)
- [Swagger Documentation](https://woodpecker-ci.org/docs/2.8/development/swagger)
- [GitHub Repository](https://github.com/woodpecker-ci/woodpecker)

## License

MIT - Part of SHIBC AITO System
