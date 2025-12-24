# CTO Deployment System

Dokumentation für das autonome Build- und Deployment-System des CTO Agents.

## Architektur-Übersicht

```
┌─────────────────────────────────────────────────────────────────┐
│  Host Server                                                    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  aito-cto Container                                      │   │
│  │                                                          │   │
│  │  /app/projects/        ← cto_projects (Named Volume)     │   │
│  │     ├── website/       ← git clone von GitHub            │   │
│  │     ├── contracts/     ← git clone von GitHub            │   │
│  │     └── dashboard/     ← git clone von GitHub            │   │
│  │                                                          │   │
│  │  /app/workspace/       ← Bind Mount (shibc-workspace)    │   │
│  │     └── (Content, Docs, shared mit anderen Agents)       │   │
│  │                                                          │   │
│  │  MCP Server:                                             │   │
│  │  ├── git-mcp      → Git Operations (clone/commit/push)   │   │
│  │  ├── shell-mcp    → npm/node/tsc (im Container)          │   │
│  │  ├── portainer-mcp→ Container Mgmt via API               │   │
│  │  └── woodpecker-mcp→ CI/CD Pipelines via API             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Portainer   │  │  Woodpecker  │  │  GitHub      │          │
│  │  :9000       │  │  CI Server   │  │  (Remote)    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## Volumes

| Volume | Mount | Beschreibung |
|--------|-------|--------------|
| `cto_projects` | `/app/projects` | Named Volume für geklonte Repos |
| Bind Mount | `/app/workspace` | Shared workspace (shibc-workspace Git Repo) |
| `cto_memory` | `/app/memory` | Persistenter Agent-State |

## Warum dieser Ansatz?

### Problem: Container-Isolation

Der CTO Agent läuft in einem Docker Container. Das bedeutet:

1. **Shell-Befehle laufen im Container**, nicht auf dem Host
2. **Ports sind nicht gemappt** - `npm run dev` auf Port 3000 ist nicht erreichbar
3. **Kein Docker-Socket** - `docker build` funktioniert nicht

### Lösung: API-basiertes Deployment

Statt Docker-in-Docker nutzen wir APIs:

- **Portainer API** → Container/Stack Management
- **Woodpecker API** → CI/CD Pipelines

## Build & Deploy Workflow

### 1. Projekt klonen

```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Clone https://github.com/og-shibaclassic/website.git to /app/projects/website",
    "servers": ["git"]
  }]
}
```

### 2. Dependencies installieren

```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Run 'npm install' in /app/projects/website",
    "servers": ["shell"]
  }]
}
```

### 3. Build ausführen

```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Run 'npm run build' in /app/projects/website with 5min timeout",
    "servers": ["shell"]
  }]
}
```

### 4. Tests ausführen

```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Run 'npm test' in /app/projects/website",
    "servers": ["shell"]
  }]
}
```

### 5. Änderungen committen

```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "In /app/projects/website: stage all changes and commit with message 'feat: add new feature'",
    "servers": ["git"]
  }]
}
```

### 6. Push zu GitHub

```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Push to origin in /app/projects/website",
    "servers": ["git"]
  }]
}
```

### 7a. Deploy via Portainer

```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Restart the website stack in Portainer",
    "servers": ["portainer"]
  }]
}
```

### 7b. Deploy via Woodpecker CI

```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Trigger build for og-shibaclassic/website on main branch",
    "servers": ["woodpecker"]
  }]
}
```

## MCP Server Konfiguration

### git-mcp

```json
{
  "git": {
    "command": "node",
    "args": ["/app/mcp-servers/git-mcp/dist/index.js"],
    "env": {
      "ALLOWED_PATHS": "/app/projects,/app/workspace",
      "GIT_AUTHOR_NAME": "SHIBC CTO",
      "GIT_AUTHOR_EMAIL": "cto@shibaclassic.io"
    }
  }
}
```

**Tools:** `git_clone`, `git_status`, `git_add`, `git_commit`, `git_push`, `git_pull`, `git_branch`, `git_log`, `git_diff`, `git_stash`, `git_merge`, `git_init`, `git_remote`

### shell-mcp

```json
{
  "shell": {
    "command": "node",
    "args": ["/app/mcp-servers/shell-mcp/dist/index.js"],
    "env": {
      "ALLOWED_PATHS": "/app/projects,/app/workspace",
      "ALLOWED_COMMANDS": "npm,node,npx,tsc,vitest,docker,ls,cat,head,tail,wc,grep,find,pwd,echo,mkdir,cp,mv,touch,rm",
      "DEFAULT_TIMEOUT": "60000",
      "MAX_TIMEOUT": "600000"
    }
  }
}
```

**Tools:** `shell_exec`, `shell_which`, `shell_env`, `shell_file_exists`, `shell_read_file`, `shell_write_file`, `shell_list_dir`

### portainer-mcp

```json
{
  "portainer": {
    "command": "node",
    "args": ["/app/mcp-servers/portainer-mcp/dist/index.js"],
    "env": {
      "PORTAINER_URL": "${PORTAINER_URL}",
      "PORTAINER_API_KEY": "${PORTAINER_API_KEY}",
      "PORTAINER_ENDPOINT_ID": "1"
    }
  }
}
```

**Tools:** `portainer_endpoints`, `portainer_containers`, `portainer_container_start/stop/restart`, `portainer_container_logs`, `portainer_stacks`, `portainer_stack_start/stop`, `portainer_images`, `portainer_image_pull`

### woodpecker-mcp

```json
{
  "woodpecker": {
    "command": "node",
    "args": ["/app/mcp-servers/woodpecker-mcp/dist/index.js"],
    "env": {
      "WOODPECKER_URL": "${WOODPECKER_URL}",
      "WOODPECKER_TOKEN": "${WOODPECKER_TOKEN}"
    }
  }
}
```

**Tools:** `woodpecker_repos`, `woodpecker_pipelines`, `woodpecker_pipeline_create/restart/cancel`, `woodpecker_logs`, `woodpecker_secrets`

## Umgebungsvariablen

In `.env` konfigurieren:

```bash
# Portainer
PORTAINER_URL=http://portainer:9000
PORTAINER_API_KEY=your-api-key
PORTAINER_ENDPOINT_ID=1

# Woodpecker
WOODPECKER_URL=https://ci.shibaclassic.io
WOODPECKER_TOKEN=your-token
```

## Security

### Path Restrictions

Alle MCP Server validieren Pfade:

- `/app/projects` - Geklonte Repositories
- `/app/workspace` - Shared Workspace

Zugriff außerhalb dieser Pfade wird blockiert.

### Command Whitelist (shell-mcp)

Nur diese Befehle sind erlaubt:
- `npm`, `node`, `npx` - Node.js
- `tsc`, `vitest` - TypeScript/Testing
- `ls`, `cat`, `head`, `tail`, `wc` - Datei-Ansicht
- `grep`, `find` - Suche
- `mkdir`, `cp`, `mv`, `touch`, `rm` - Datei-Operationen

### Forbidden Patterns

Diese Muster werden blockiert:
- `rm -rf /` - Gefährliche Löschungen
- `sudo` - Privilege Escalation
- `push --force` - Force Push
- `reset --hard` - Hard Reset

### API Authentication

- **Portainer:** API Key im `X-API-Key` Header
- **Woodpecker:** Bearer Token im `Authorization` Header

## Typische Use Cases

### Website-Update deployen

```
1. git pull in /app/projects/website
2. npm install (falls package.json geändert)
3. npm run build
4. npm test
5. git commit + push
6. portainer: restart website container
```

### Neue Feature-Branch erstellen

```
1. git branch create feature/new-feature
2. Änderungen machen (via filesystem MCP)
3. npm test
4. git commit + push with upstream
5. GitHub PR erstellen (via github MCP)
```

### CI/CD Pipeline triggern

```
1. Änderungen pushen
2. woodpecker: create pipeline for branch
3. woodpecker: watch logs
4. Bei Erfolg: merge to main
```

## Troubleshooting

### "Path not allowed" Error

```
Security: Path not allowed: /some/path
```

**Lösung:** Pfad muss in `ALLOWED_PATHS` sein (`/app/projects` oder `/app/workspace`)

### "Command not allowed" Error

```
Security: Command not allowed: some-command
```

**Lösung:** Befehl zur `ALLOWED_COMMANDS` Liste hinzufügen oder anderen Ansatz wählen

### Git "dubious ownership" Error

```
fatal: detected dubious ownership in repository
```

**Lösung:** Ist bereits in Dockerfile konfiguriert via `git config --global --add safe.directory`

### Portainer API Error

```
Portainer operation failed: HTTP 401
```

**Lösung:** `PORTAINER_API_KEY` in `.env` prüfen

## Referenzen

- [Portainer API Docs](https://docs.portainer.io/api/docs)
- [Woodpecker CI API](https://woodpecker-ci.org/api)
- [MCP SDK](https://github.com/anthropics/anthropic-cookbook/tree/main/mcp)
