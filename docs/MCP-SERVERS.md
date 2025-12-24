# MCP Server Übersicht

Liste aller verfügbaren MCP (Model Context Protocol) Server im AITO System.

## Server nach Kategorie

### Kommunikation

| Server | Beschreibung | Agent |
|--------|--------------|-------|
| `telegram` | Telegram Bot API (Nachrichten, Fotos, Dokumente) | CMO, COO |
| `fetch` | HTTP Requests (Domain-Whitelist) | Alle |

### Content Management

| Server | Beschreibung | Agent |
|--------|--------------|-------|
| `directus` | Directus CMS API | CTO, CMO |
| `filesystem` | Lokaler Dateizugriff | Alle |

### Blockchain

| Server | Beschreibung | Agent |
|--------|--------------|-------|
| `etherscan` | Ethereum Blockchain Daten | CFO, DAO |

### Development (CTO)

| Server | Beschreibung | Agent |
|--------|--------------|-------|
| `github` | GitHub API (Repos, Issues, PRs) | CTO |
| `git` | Lokale Git-Operationen | CTO |
| `shell` | Shell-Befehlsausführung | CTO |
| `playwright` | Browser-Automation, E2E Tests | CTO |
| `mui` | MUI/Material UI Dokumentation | CTO |

### Infrastructure (CTO)

| Server | Beschreibung | Agent |
|--------|--------------|-------|
| `portainer` | Container/Stack Management | CTO |
| `woodpecker` | CI/CD Pipeline Management | CTO |

### Media

| Server | Beschreibung | Agent |
|--------|--------------|-------|
| `imagen` | Google Imagen Bildgenerierung | CMO (Designer) |

## Shared Library

### @shibc/mcp-shared

**Pfad:** `mcp-servers/shared/`

Zentrale Bibliothek mit Interfaces und Utilities für alle MCP Server.

```bash
cd mcp-servers/shared && npm install && npm run build
```

**Interfaces:**
- `IAdapter` - Basis-Interface für alle Adapter
- `IApiAdapter` - REST API Adapter
- `ICICDAdapter` - CI/CD (Woodpecker, Jenkins, GitLab CI)
- `IContainerAdapter` - Container (Portainer, Docker, K8s)
- `IGitAdapter` - Git Operationen
- `IShellAdapter` - Shell/CLI
- `ICMSAdapter` - CMS (Directus, Strapi)
- `IMessagingAdapter` - Messaging (Telegram, Discord)

**Helpers:**
- `BaseAdapter`, `BaseApiAdapter` - Abstrakte Basisklassen
- `ToolBuilder` - Fluent API für MCP Tools
- `PathValidator`, `CommandValidator` - Security
- `successResult()`, `errorResult()` - Result Helpers
- `AdapterRegistry` - Factory Pattern
- `@RegisterAdapter` Decorator

**Verwendung:**
```typescript
import {
  BaseApiAdapter,
  ICICDAdapter,
  ToolBuilder,
  successResult,
  errorResult,
  PathValidator,
} from '@shibc/mcp-shared';
```

**Dokumentation:** [MCP-PLUGIN-DEVELOPMENT.md](./MCP-PLUGIN-DEVELOPMENT.md)

---

## Custom MCP Server (selbst entwickelt)

Diese Server wurden speziell für AITO entwickelt:

### git-mcp

**Pfad:** `mcp-servers/git-mcp/`

Sichere Git-Operationen mit Path Restrictions.

```bash
# Build
cd mcp-servers/git-mcp && npm install && npm run build
```

**Tools:**
- `git_clone` - Repository klonen
- `git_status` - Status anzeigen
- `git_add` - Dateien stagen
- `git_commit` - Commit erstellen
- `git_push` - Zum Remote pushen
- `git_pull` - Vom Remote pullen
- `git_branch` - Branches verwalten
- `git_log` - Commit-Historie
- `git_diff` - Änderungen anzeigen
- `git_stash` - Änderungen stashen
- `git_merge` - Branches mergen
- `git_init` - Neues Repo initialisieren
- `git_remote` - Remotes verwalten

**Security:**
- `ALLOWED_PATHS` - Pfad-Whitelist
- `FORBIDDEN_COMMANDS` - Blockierte Befehle (push --force, reset --hard)

---

### shell-mcp

**Pfad:** `mcp-servers/shell-mcp/`

Sichere Shell-Befehlsausführung mit Command Whitelist.

```bash
cd mcp-servers/shell-mcp && npm install && npm run build
```

**Tools:**
- `shell_exec` - Befehl ausführen
- `shell_which` - Befehl-Pfad prüfen
- `shell_env` - Umgebungsvariable lesen
- `shell_file_exists` - Datei prüfen
- `shell_read_file` - Datei lesen
- `shell_write_file` - Datei schreiben
- `shell_list_dir` - Verzeichnis auflisten

**Security:**
- `ALLOWED_PATHS` - Pfad-Whitelist
- `ALLOWED_COMMANDS` - Befehl-Whitelist
- `FORBIDDEN_PATTERNS` - Blockierte Muster

---

### portainer-mcp

**Pfad:** `mcp-servers/portainer-mcp/`

Portainer API für Container-Management.

```bash
cd mcp-servers/portainer-mcp && npm install && npm run build
```

**Tools:**
- `portainer_endpoints` - Environments auflisten
- `portainer_containers` - Container auflisten
- `portainer_container_start/stop/restart` - Container steuern
- `portainer_container_logs` - Logs abrufen
- `portainer_container_inspect` - Details abrufen
- `portainer_stacks` - Stacks auflisten
- `portainer_stack_start/stop` - Stacks steuern
- `portainer_stack_file` - Compose-File abrufen
- `portainer_images` - Images auflisten
- `portainer_image_pull` - Image pullen
- `portainer_system_info` - System-Info

**Auth:** `PORTAINER_API_KEY`

---

### woodpecker-mcp

**Pfad:** `mcp-servers/woodpecker-mcp/`

Woodpecker CI API für Pipeline-Management.

```bash
cd mcp-servers/woodpecker-mcp && npm install && npm run build
```

**Tools:**
- `woodpecker_user` - Aktueller User
- `woodpecker_repos` - Repositories auflisten
- `woodpecker_repo` - Repo-Details
- `woodpecker_repo_activate` - Repo aktivieren
- `woodpecker_pipelines` - Pipelines auflisten
- `woodpecker_pipeline` - Pipeline-Details
- `woodpecker_pipeline_create` - Build triggern
- `woodpecker_pipeline_restart` - Build neu starten
- `woodpecker_pipeline_cancel` - Build abbrechen
- `woodpecker_pipeline_approve/decline` - Build genehmigen
- `woodpecker_logs` - Build-Logs
- `woodpecker_secrets` - Secrets auflisten
- `woodpecker_version` - Server-Version

**Auth:** `WOODPECKER_TOKEN` (Bearer)

---

### telegram-mcp

**Pfad:** `mcp-servers/telegram-mcp/`

Telegram Bot API mit Foto/Dokument-Support.

```bash
cd mcp-servers/telegram-mcp && npm install && npm run build
```

**Auth:** `TELEGRAM_BOT_TOKEN`

---

### fetch-validated

**Pfad:** `mcp-servers/fetch-validated/`

HTTP Fetch mit Domain-Whitelist.

```bash
cd mcp-servers/fetch-validated && npm install && npm run build
```

---

### imagen-mcp

**Pfad:** `mcp-servers/imagen-mcp/`

Google Imagen Bildgenerierung.

```bash
cd mcp-servers/imagen-mcp && npm install && npm run build
```

**Auth:** `GEMINI_API_KEY`

## NPM MCP Server (externe Pakete)

Diese Server werden via `npx` installiert:

| Server | Package | Beschreibung |
|--------|---------|--------------|
| `github` | `@modelcontextprotocol/server-github` | GitHub API |
| `playwright` | `@playwright/mcp@latest` | Browser Automation (Microsoft) |
| `mui` | `@mui/mcp@latest` | MUI Dokumentation |
| `directus` | `@directus/content-mcp@latest` | Directus CMS |
| `filesystem` | `@agent-infra/mcp-server-filesystem` | Dateisystem |
| `etherscan` | `etherscan-mcp` | Ethereum Daten |
| `n8n` | `@illuminaresolutions/n8n-mcp-server` | Workflow Automation |

## Agent → Server Zuordnung

```typescript
// src/lib/mcp.ts
export const MCP_SERVERS_BY_AGENT: Record<string, string[]> = {
  ceo: ['filesystem', 'fetch'],
  dao: ['filesystem', 'etherscan'],
  cmo: ['telegram', 'fetch', 'filesystem'],
  cto: ['filesystem', 'fetch', 'directus', 'github', 'playwright',
        'mui', 'git', 'shell', 'portainer', 'woodpecker'],
  cfo: ['etherscan', 'filesystem'],
  coo: ['telegram', 'filesystem'],
  cco: ['filesystem', 'fetch'],
};
```

## Worker-Only Server

Diese Server werden nur via `spawn_worker` verwendet (hoher Context):

```typescript
export const WORKER_ONLY_SERVERS = [
  'directus',    // CMS-Operationen
  'imagen',      // Bildgenerierung
  'github',      // GitHub API
  'playwright',  // Browser Tests
  'mui',         // MUI Docs
  'git',         // Git Operations
  'shell',       // Shell Commands
  'portainer',   // Container Mgmt
  'woodpecker',  // CI/CD
];
```

## Konfiguration

Alle Server werden in `.claude/mcp_servers.json` konfiguriert:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "node",
      "args": ["/app/mcp-servers/server-name/dist/index.js"],
      "env": {
        "API_KEY": "${API_KEY}"
      },
      "description": "Server description"
    }
  }
}
```

## Neuen MCP Server hinzufügen

1. **Verzeichnis erstellen:**
   ```bash
   mkdir -p mcp-servers/my-mcp/src
   ```

2. **package.json erstellen:**
   ```json
   {
     "name": "@shibc/my-mcp",
     "version": "1.0.0",
     "type": "module",
     "dependencies": {
       "@modelcontextprotocol/sdk": "^1.0.0",
       "zod": "^3.24.0"
     }
   }
   ```

3. **Server implementieren:** (siehe git-mcp als Template)

4. **Build hinzufügen:** in `docker/Dockerfile.agent`:
   ```dockerfile
   RUN cd mcp-servers/my-mcp && npm ci && npm run build || true
   ```

5. **Konfiguration:** in `.claude/mcp_servers.json`

6. **Agent Zuordnung:** in `src/lib/mcp.ts`
