# Portainer MCP Server

Container management MCP Server for SHIBC CTO - provides Portainer API access for Docker/Swarm operations.

## Features

- **14 Tools**: Container, stack, image, and system operations
- **API Key Auth**: Secure X-API-Key authentication
- **Multi-Environment**: Support for multiple Docker environments
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
  "portainer": {
    "command": "node",
    "args": ["./mcp-servers/portainer-mcp/dist/index.js"],
    "env": {
      "PORTAINER_URL": "https://portainer.example.com",
      "PORTAINER_API_KEY": "${PORTAINER_API_KEY}",
      "PORTAINER_ENDPOINT_ID": "1"
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORTAINER_URL` | Yes | - | Portainer API URL |
| `PORTAINER_API_KEY` | Yes | - | API key for authentication |
| `PORTAINER_ENDPOINT_ID` | No | `1` | Default environment ID |

## Available Tools

### Environment Operations

| Tool | Description |
|------|-------------|
| `portainer_endpoints` | List all environments/endpoints |
| `portainer_system_info` | Get Docker system information |

### Container Operations

| Tool | Description |
|------|-------------|
| `portainer_containers` | List containers |
| `portainer_container_start` | Start a container |
| `portainer_container_stop` | Stop a container |
| `portainer_container_restart` | Restart a container |
| `portainer_container_logs` | Get container logs |
| `portainer_container_inspect` | Get detailed container info |

### Stack Operations

| Tool | Description |
|------|-------------|
| `portainer_stacks` | List all stacks |
| `portainer_stack_start` | Start a stack |
| `portainer_stack_stop` | Stop a stack |
| `portainer_stack_file` | Get stack compose file |

### Image Operations

| Tool | Description |
|------|-------------|
| `portainer_images` | List Docker images |
| `portainer_image_pull` | Pull a Docker image |

## Authentication

The server uses Portainer API keys for authentication. To create an API key:

1. Log into Portainer
2. Go to Account Settings
3. Create a new Access Token
4. Copy the token and set as `PORTAINER_API_KEY`

## Example Calls

### List Containers
```json
{
  "tool": "portainer_containers",
  "arguments": {
    "endpointId": 1,
    "all": true
  }
}
```

### Restart Container
```json
{
  "tool": "portainer_container_restart",
  "arguments": {
    "containerId": "abc123def456",
    "endpointId": 1
  }
}
```

### Get Logs
```json
{
  "tool": "portainer_container_logs",
  "arguments": {
    "containerId": "abc123def456",
    "tail": 50,
    "timestamps": true
  }
}
```

### List Stacks
```json
{
  "tool": "portainer_stacks",
  "arguments": {}
}
```

## Development

```bash
npm install
npm run build
npm run typecheck
npm run dev
```

## Security Notes

- API key provides same access level as the user in Portainer UI
- Use a dedicated service account with minimal permissions
- Never expose API key in logs or error messages

## Sources

- [Portainer API Documentation](https://docs.portainer.io/api/docs)
- [Portainer API Access](https://docs.portainer.io/api/access)
- [API Examples](https://docs.portainer.io/api/examples)

## License

MIT - Part of SHIBC AITO System
