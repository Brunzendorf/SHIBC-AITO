# CTO MCP Server Inventory

## Status: PLANNING - 2025-12-23

## Zielarchitektur

| Komponente | Software | Lizenz | Status |
|------------|----------|--------|--------|
| Container Orchestration | **Portainer** | Zacks Public License | Vorhanden |
| CI/CD Pipeline | **Woodpecker CI** | Apache 2.0 | Geplant |
| Vector Store | **Qdrant** | Apache 2.0 | Vorhanden |
| Workflow Automation | **n8n** | Sustainable Use License | Vorhanden |
| Git Hosting | **GitHub** | - | Vorhanden |
| CMS | **Directus** | GPL-3.0 | Vorhanden |

---

## MCP Server Übersicht

### Bereits vorhanden

| MCP | Status | Beschreibung |
|-----|--------|--------------|
| `telegram` | ✅ Custom | Telegram Bot API |
| `fetch` | ✅ Custom | Domain-validated HTTP |
| `filesystem` | ✅ NPM | Workspace file access |
| `directus` | ✅ NPM | Directus CMS |
| `etherscan` | ✅ NPM | Blockchain data |
| `imagen` | ✅ Custom | Google Imagen |

### NPM Packages (Ready to Use!)

| MCP | Status | NPM Package | Beschreibung |
|-----|--------|-------------|--------------|
| `github` | 📦 NPM | `@modelcontextprotocol/server-github` | GitHub API |
| `playwright` | 📦 NPM | `@anthropic-ai/mcp-server-playwright` | Browser Testing |
| `puppeteer` | 📦 NPM | `@modelcontextprotocol/server-puppeteer` | Browser Automation |

### Neu zu entwickeln - KRITISCH

| MCP | Priorität | Aufwand | Beschreibung |
|-----|-----------|---------|--------------|
| `portainer` | 🔴 HOCH | 24h | Container Management via Portainer API |
| `woodpecker` | 🔴 HOCH | 24h | CI/CD Pipeline Management |
| `git` | 🔴 HOCH | 16h | Lokale Git Operationen (clone, commit, push) |
| `shell` | 🔴 HOCH | 16h | Sichere Command Execution |

### Neu zu entwickeln - HOCH

| MCP | Priorität | Aufwand | Beschreibung |
|-----|-----------|---------|--------------|
| `nginx` | 🟠 HOCH | 16h | Reverse Proxy & Subdomain Config |
| `certbot` | 🟠 HOCH | 8h | SSL-Zertifikate (Let's Encrypt) |
| `qdrant` | 🟠 MITTEL | 16h | Vector Store für RAG |
| `n8n` | 🟠 MITTEL | 16h | Workflow Automation |

### Neu zu entwickeln - MITTEL

| MCP | Priorität | Aufwand | Beschreibung |
|-----|-----------|---------|--------------|
| `dns` | 🟡 MITTEL | 8h | DNS/Subdomain Management (Strato API) |
| `postgres` | 🟡 NIEDRIG | 8h | Database Management |

---

## 1. Portainer MCP

### Übersicht
- **API:** Portainer REST API v2
- **Auth:** API Token oder JWT
- **Docs:** https://docs.portainer.io/api/docs

### Tools

| Tool | Beschreibung | Sicherheit |
|------|--------------|------------|
| `portainer_list_endpoints` | Alle Endpoints auflisten | Read-only |
| `portainer_list_stacks` | Docker Stacks auflisten | Read-only |
| `portainer_get_stack` | Stack Details | Read-only |
| `portainer_deploy_stack` | Stack deployen (docker-compose) | ⚠️ Write |
| `portainer_update_stack` | Stack aktualisieren | ⚠️ Write |
| `portainer_start_stack` | Stack starten | ⚠️ Write |
| `portainer_stop_stack` | Stack stoppen | ⚠️ Write |
| `portainer_list_containers` | Container auflisten | Read-only |
| `portainer_container_logs` | Container Logs abrufen | Read-only |
| `portainer_container_stats` | Container Stats (CPU/Mem) | Read-only |
| `portainer_restart_container` | Container neustarten | ⚠️ Write |

### Sicherheit
- **Whitelist:** Nur bestimmte Stacks/Container erlaubt
- **Read-only Mode:** Für Monitoring ohne Änderungen
- **Audit Log:** Alle Aktionen werden geloggt
- **Environment Isolation:** Prod vs. Staging Trennung

### Config
```json
{
  "portainer": {
    "command": "node",
    "args": ["/app/mcp-servers/portainer-mcp/dist/index.js"],
    "env": {
      "PORTAINER_URL": "https://portainer.example.com",
      "PORTAINER_API_KEY": "${PORTAINER_API_KEY}",
      "ALLOWED_STACKS": "aito-*,shibc-*",
      "READ_ONLY": "false"
    }
  }
}
```

---

## 2. Woodpecker CI MCP

### Übersicht
- **API:** Woodpecker REST API
- **Auth:** Personal Access Token
- **Docs:** https://woodpecker-ci.org/docs/usage/api

### Tools

| Tool | Beschreibung | Sicherheit |
|------|--------------|------------|
| `woodpecker_list_repos` | Repos auflisten | Read-only |
| `woodpecker_get_repo` | Repo Details | Read-only |
| `woodpecker_list_pipelines` | Pipelines eines Repos | Read-only |
| `woodpecker_get_pipeline` | Pipeline Details + Logs | Read-only |
| `woodpecker_start_pipeline` | Pipeline manuell starten | ⚠️ Write |
| `woodpecker_cancel_pipeline` | Pipeline abbrechen | ⚠️ Write |
| `woodpecker_approve_pipeline` | Pipeline approven | ⚠️ Write |
| `woodpecker_decline_pipeline` | Pipeline ablehnen | ⚠️ Write |
| `woodpecker_get_logs` | Build Logs abrufen | Read-only |
| `woodpecker_list_secrets` | Secrets auflisten (nur Namen!) | Read-only |
| `woodpecker_create_secret` | Secret erstellen | ⚠️ Write |

### Pipeline Trigger
```yaml
# .woodpecker.yml Template
steps:
  - name: build
    image: node:20
    commands:
      - npm ci
      - npm run build
      - npm test

  - name: deploy
    image: docker
    commands:
      - docker build -t ${CI_REPO}:${CI_COMMIT_SHA} .
      - docker push ${CI_REPO}:${CI_COMMIT_SHA}
    when:
      branch: main
```

### Sicherheit
- **Secrets nie auslesen** - Nur Namen, keine Werte
- **Branch Protection** - Nur main/develop triggern
- **Manual Approval** - Für Production Deploys

### Config
```json
{
  "woodpecker": {
    "command": "node",
    "args": ["/app/mcp-servers/woodpecker-mcp/dist/index.js"],
    "env": {
      "WOODPECKER_URL": "https://ci.example.com",
      "WOODPECKER_TOKEN": "${WOODPECKER_TOKEN}",
      "ALLOWED_REPOS": "org/repo1,org/repo2",
      "PROTECTED_BRANCHES": "main,production"
    }
  }
}
```

---

## 3. Qdrant MCP

### Übersicht
- **API:** Qdrant REST/gRPC API
- **Auth:** API Key
- **Docs:** https://qdrant.tech/documentation/

### Tools

| Tool | Beschreibung | Sicherheit |
|------|--------------|------------|
| `qdrant_list_collections` | Collections auflisten | Read-only |
| `qdrant_get_collection` | Collection Info | Read-only |
| `qdrant_create_collection` | Collection erstellen | ⚠️ Write |
| `qdrant_delete_collection` | Collection löschen | ⚠️ Danger |
| `qdrant_search` | Similarity Search | Read-only |
| `qdrant_search_batch` | Batch Search | Read-only |
| `qdrant_upsert_points` | Punkte einfügen/updaten | ⚠️ Write |
| `qdrant_delete_points` | Punkte löschen | ⚠️ Write |
| `qdrant_get_points` | Punkte abrufen | Read-only |
| `qdrant_scroll` | Durch Collection iterieren | Read-only |
| `qdrant_count` | Punkte zählen | Read-only |

### Use Cases für CTO
1. **Code Search** - Ähnlichen Code finden
2. **Error Analysis** - Ähnliche Fehler finden
3. **Documentation** - Relevante Docs finden
4. **Duplicate Detection** - Doppelte Issues erkennen

### Config
```json
{
  "qdrant": {
    "command": "node",
    "args": ["/app/mcp-servers/qdrant-mcp/dist/index.js"],
    "env": {
      "QDRANT_URL": "http://qdrant:6333",
      "QDRANT_API_KEY": "${QDRANT_API_KEY}",
      "ALLOWED_COLLECTIONS": "aito_*,code_*,docs_*",
      "MAX_RESULTS": "100"
    }
  }
}
```

---

## 4. n8n MCP

### Übersicht
- **API:** n8n REST API
- **Auth:** API Key
- **Docs:** https://docs.n8n.io/api/

### Tools

| Tool | Beschreibung | Sicherheit |
|------|--------------|------------|
| `n8n_list_workflows` | Workflows auflisten | Read-only |
| `n8n_get_workflow` | Workflow Details | Read-only |
| `n8n_create_workflow` | Workflow erstellen | ⚠️ Write |
| `n8n_update_workflow` | Workflow bearbeiten | ⚠️ Write |
| `n8n_delete_workflow` | Workflow löschen | ⚠️ Danger |
| `n8n_activate_workflow` | Workflow aktivieren | ⚠️ Write |
| `n8n_deactivate_workflow` | Workflow deaktivieren | ⚠️ Write |
| `n8n_execute_workflow` | Workflow manuell ausführen | ⚠️ Write |
| `n8n_list_executions` | Ausführungen auflisten | Read-only |
| `n8n_get_execution` | Ausführung Details | Read-only |
| `n8n_list_credentials` | Credentials auflisten (nur Namen!) | Read-only |

### Workflow Templates
```json
{
  "name": "Deploy on PR Merge",
  "nodes": [
    {
      "type": "n8n-nodes-base.webhook",
      "parameters": {"path": "github-webhook"}
    },
    {
      "type": "n8n-nodes-base.if",
      "parameters": {"conditions": {"string": [{"value1": "={{$json.action}}", "value2": "closed"}]}}
    },
    {
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {"url": "https://portainer/api/stacks/deploy"}
    }
  ]
}
```

### Config
```json
{
  "n8n": {
    "command": "node",
    "args": ["/app/mcp-servers/n8n-mcp/dist/index.js"],
    "env": {
      "N8N_URL": "http://n8n:5678",
      "N8N_API_KEY": "${N8N_API_KEY}",
      "ALLOWED_WORKFLOW_TAGS": "aito,automated",
      "MAX_EXECUTIONS_PER_HOUR": "100"
    }
  }
}
```

---

## 5. GitHub MCP

### Übersicht
- **Package:** `@modelcontextprotocol/server-github`
- **Auth:** Personal Access Token
- **Status:** NPM Package existiert bereits!

### Tools (vom Package)

| Tool | Beschreibung |
|------|--------------|
| `create_or_update_file` | Datei erstellen/updaten |
| `search_repositories` | Repos suchen |
| `create_repository` | Repo erstellen |
| `get_file_contents` | Datei lesen |
| `push_files` | Mehrere Dateien pushen |
| `create_issue` | Issue erstellen |
| `create_pull_request` | PR erstellen |
| `fork_repository` | Repo forken |
| `create_branch` | Branch erstellen |
| `list_commits` | Commits auflisten |
| `list_issues` | Issues auflisten |
| `update_issue` | Issue updaten |
| `add_issue_comment` | Issue kommentieren |
| `search_code` | Code suchen |
| `search_issues` | Issues suchen |
| `search_users` | User suchen |
| `get_issue` | Issue Details |
| `get_pull_request` | PR Details |
| `list_pull_requests` | PRs auflisten |
| `create_pull_request_review` | PR Review |
| `merge_pull_request` | PR mergen |
| `get_pull_request_files` | PR Dateien |
| `get_pull_request_status` | PR Status |
| `update_pull_request_branch` | PR Branch updaten |
| `get_pull_request_comments` | PR Kommentare |
| `get_pull_request_reviews` | PR Reviews |

### Config
```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
    }
  }
}
```

---

## 6. Git MCP (KRITISCH - Neu zu entwickeln)

### Übersicht
- **Zweck:** Lokale Git Operationen (clone, commit, push, branch)
- **Warum nötig:** GitHub MCP ist für API-Ops, nicht für lokales Git
- **Security:** Sandboxed auf /app/workspace/projects

### Tools

| Tool | Beschreibung | Sicherheit |
|------|--------------|------------|
| `git_clone` | Repository klonen | ⚠️ Write |
| `git_init` | Neues Repo initialisieren | ⚠️ Write |
| `git_checkout` | Branch wechseln | ⚠️ Write |
| `git_branch` | Branch erstellen/löschen | ⚠️ Write |
| `git_add` | Dateien stagen | ⚠️ Write |
| `git_commit` | Commit erstellen | ⚠️ Write |
| `git_push` | Änderungen pushen | ⚠️ Write |
| `git_pull` | Änderungen holen | ⚠️ Write |
| `git_status` | Status anzeigen | Read-only |
| `git_log` | History anzeigen | Read-only |
| `git_diff` | Unterschiede zeigen | Read-only |
| `git_merge` | Branches mergen | ⚠️ Write |
| `git_stash` | Änderungen stashen | ⚠️ Write |

### Config
```json
{
  "git": {
    "command": "node",
    "args": ["/app/mcp-servers/git-mcp/dist/index.js"],
    "env": {
      "GIT_AUTHOR_NAME": "SHIBC CTO",
      "GIT_AUTHOR_EMAIL": "cto@shibaclassic.io",
      "ALLOWED_PATHS": "/app/workspace/projects/*",
      "SSH_KEY_PATH": "/app/.ssh/id_rsa",
      "FORBIDDEN_COMMANDS": "push --force,reset --hard"
    }
  }
}
```

### Sicherheit
- **Path Restriction:** Nur /app/workspace/projects/*
- **Forbidden Commands:** Kein force push, hard reset
- **SSH Key:** Für GitHub Auth
- **Audit Log:** Alle Commits loggen

---

## 7. Shell MCP (KRITISCH - Neu zu entwickeln)

### Übersicht
- **Zweck:** Sichere Command Execution für Build, Test, etc.
- **Warum nötig:** npm, tsc, tests, etc. brauchen Shell
- **Security:** Strikte Whitelist, kein sudo, kein rm -rf

### Tools

| Tool | Beschreibung | Sicherheit |
|------|--------------|------------|
| `shell_exec` | Befehl ausführen (whitelist) | ⚠️ Controlled |
| `shell_npm_install` | npm/yarn install | ⚠️ Write |
| `shell_npm_run` | npm script ausführen | ⚠️ Write |
| `shell_build` | Projekt bauen | ⚠️ Write |
| `shell_test` | Tests ausführen | Read-only |
| `shell_lint` | Linting ausführen | Read-only |

### Config
```json
{
  "shell": {
    "command": "node",
    "args": ["/app/mcp-servers/shell-mcp/dist/index.js"],
    "env": {
      "ALLOWED_COMMANDS": "npm,yarn,pnpm,node,tsc,jest,vitest,eslint,prettier,docker",
      "FORBIDDEN_PATTERNS": "rm -rf,sudo,chmod 777,curl|bash,wget|bash,>>,/etc/,/root/",
      "WORKING_DIR": "/app/workspace/projects",
      "TIMEOUT_MS": "300000",
      "MAX_OUTPUT_SIZE": "1000000"
    }
  }
}
```

### Sicherheit
- **Command Whitelist:** Nur erlaubte Commands
- **Forbidden Patterns:** Blacklist für gefährliche Patterns
- **Timeout:** Max 5 Minuten pro Command
- **Output Limit:** Max 1MB Output
- **Working Dir:** Eingeschränkt auf Workspace
- **No Sudo:** Keine Root-Befehle

---

## 8. Playwright MCP (NPM Package!)

### Übersicht
- **Package:** `@anthropic-ai/mcp-server-playwright`
- **Docs:** https://github.com/microsoft/playwright-mcp
- **Zweck:** Browser Automation für QA Testing

> *"Playwright MCP enables LLMs to interact with web pages through structured
> accessibility snapshots, bypassing the need for screenshots."*

### Tools (vom Package)

| Tool | Beschreibung |
|------|--------------|
| `playwright_navigate` | URL öffnen |
| `playwright_screenshot` | Screenshot machen |
| `playwright_click` | Element klicken |
| `playwright_fill` | Formular ausfüllen |
| `playwright_get_text` | Text extrahieren |
| `playwright_wait` | Auf Element warten |
| `playwright_evaluate` | JavaScript ausführen |
| `playwright_select` | Dropdown auswählen |
| `playwright_hover` | Über Element hovern |

### Config
```json
{
  "playwright": {
    "command": "npx",
    "args": ["-y", "@anthropic-ai/mcp-server-playwright", "--headless"],
    "env": {
      "PLAYWRIGHT_BROWSERS_PATH": "/app/browsers"
    }
  }
}
```

### Use Cases
1. **Deployment Verification:** Nach Deploy prüfen ob Site läuft
2. **UI Testing:** Formulare, Buttons, Navigation testen
3. **Visual Regression:** Screenshots vergleichen
4. **Accessibility:** a11y Tests
5. **Performance:** Core Web Vitals messen

### Beispiel Worker Task
```json
{
  "type": "spawn_worker",
  "task": "Verify deployment: Navigate to https://app.shibaclassic.io, take screenshot, check if 'Welcome' text exists, fill login form with test credentials, verify dashboard loads",
  "servers": ["playwright"],
  "timeout": 120000
}
```

---

## 9. Puppeteer MCP (NPM Package - Alternative)

### Übersicht
- **Package:** `@modelcontextprotocol/server-puppeteer`
- **Docs:** https://www.npmjs.com/package/@modelcontextprotocol/server-puppeteer
- **Zweck:** Alternative Browser Automation

### Tools (vom Package)

| Tool | Beschreibung |
|------|--------------|
| `puppeteer_navigate` | Navigate to URL |
| `puppeteer_screenshot` | Capture screenshot |
| `puppeteer_click` | Click element |
| `puppeteer_fill` | Fill input field |
| `puppeteer_select` | Select dropdown |
| `puppeteer_hover` | Hover element |
| `puppeteer_evaluate` | Execute JavaScript |

### Config
```json
{
  "puppeteer": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
  }
}
```

---

## 10. nginx MCP (Neu zu entwickeln)

### Übersicht
- **Zweck:** Reverse Proxy, Subdomain Routing, SSL
- **API:** nginx config files + reload command
- **Warum nötig:** Neue Apps brauchen Subdomains

### Tools

| Tool | Beschreibung | Sicherheit |
|------|--------------|------------|
| `nginx_list_sites` | Alle Sites auflisten | Read-only |
| `nginx_get_site` | Site Config lesen | Read-only |
| `nginx_create_site` | Neue Site/Subdomain erstellen | ⚠️ Write |
| `nginx_update_site` | Site Config ändern | ⚠️ Write |
| `nginx_delete_site` | Site entfernen | ⚠️ Danger |
| `nginx_reload` | Config neu laden | ⚠️ Write |
| `nginx_test_config` | Config validieren | Read-only |

### Config
```json
{
  "nginx": {
    "command": "node",
    "args": ["/app/mcp-servers/nginx-mcp/dist/index.js"],
    "env": {
      "NGINX_CONFIG_PATH": "/etc/nginx/conf.d",
      "ALLOWED_DOMAINS": "*.shibaclassic.io",
      "NGINX_RELOAD_CMD": "nginx -s reload",
      "TEMPLATE_PATH": "/app/templates/nginx"
    }
  }
}
```

### Site Template
```nginx
server {
    listen 443 ssl http2;
    server_name ${subdomain}.shibaclassic.io;

    ssl_certificate /etc/letsencrypt/live/shibaclassic.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/shibaclassic.io/privkey.pem;

    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 11. Certbot MCP (Neu zu entwickeln)

### Übersicht
- **Zweck:** SSL-Zertifikate automatisch erstellen/erneuern
- **Tool:** Let's Encrypt / Certbot
- **Warum nötig:** Neue Subdomains brauchen SSL

### Tools

| Tool | Beschreibung | Sicherheit |
|------|--------------|------------|
| `certbot_list` | Alle Zertifikate auflisten | Read-only |
| `certbot_create` | Neues Zertifikat erstellen | ⚠️ Write |
| `certbot_renew` | Zertifikat erneuern | ⚠️ Write |
| `certbot_delete` | Zertifikat löschen | ⚠️ Danger |
| `certbot_status` | Zertifikat-Status prüfen | Read-only |

### Config
```json
{
  "certbot": {
    "command": "node",
    "args": ["/app/mcp-servers/certbot-mcp/dist/index.js"],
    "env": {
      "CERTBOT_EMAIL": "ssl@shibaclassic.io",
      "ALLOWED_DOMAINS": "*.shibaclassic.io",
      "WEBROOT_PATH": "/var/www/certbot",
      "CERTBOT_CMD": "certbot"
    }
  }
}
```

---

## 12. DNS MCP (Neu zu entwickeln)

### Übersicht
- **Zweck:** DNS Records für Subdomains anlegen
- **Provider:** Strato API (oder Cloudflare Alternative)
- **Warum nötig:** Bevor nginx routet, muss DNS existieren

### Tools

| Tool | Beschreibung | Sicherheit |
|------|--------------|------------|
| `dns_list_records` | DNS Records auflisten | Read-only |
| `dns_create_record` | A/CNAME Record erstellen | ⚠️ Write |
| `dns_update_record` | Record ändern | ⚠️ Write |
| `dns_delete_record` | Record löschen | ⚠️ Danger |
| `dns_verify` | DNS Propagation prüfen | Read-only |

### Config
```json
{
  "dns": {
    "command": "node",
    "args": ["/app/mcp-servers/dns-mcp/dist/index.js"],
    "env": {
      "DNS_PROVIDER": "strato",
      "STRATO_API_KEY": "${STRATO_API_KEY}",
      "ALLOWED_DOMAINS": "shibaclassic.io",
      "DEFAULT_TTL": "3600"
    }
  }
}
```

### Alternative: Cloudflare
```json
{
  "dns": {
    "command": "node",
    "args": ["/app/mcp-servers/dns-mcp/dist/index.js"],
    "env": {
      "DNS_PROVIDER": "cloudflare",
      "CLOUDFLARE_API_TOKEN": "${CLOUDFLARE_TOKEN}",
      "CLOUDFLARE_ZONE_ID": "${CLOUDFLARE_ZONE_ID}"
    }
  }
}
```

---

## Sicherheitskonzept

### Grundprinzipien

1. **Least Privilege** - Nur nötige Berechtigungen
2. **Whitelist > Blacklist** - Explizit erlauben statt verbieten
3. **Audit Everything** - Alle Aktionen loggen
4. **Environment Isolation** - Prod/Staging strikt trennen
5. **Secrets Management** - Keine Secrets in Logs/Responses

### Per-MCP Sicherheit

| MCP | Read-Only Mode | Whitelist | Audit Log | Rate Limit |
|-----|----------------|-----------|-----------|------------|
| Portainer | ✅ Optional | Stacks | ✅ | 100/h |
| Woodpecker | ✅ Optional | Repos | ✅ | 50/h |
| Qdrant | ❌ Nicht sinnvoll | Collections | ✅ | 1000/h |
| n8n | ✅ Optional | Tags | ✅ | 100/h |
| GitHub | ❌ Package-default | Repos | ✅ | Package-limit |
| Git | ❌ | Paths | ✅ | 200/h |
| Shell | ❌ | Commands | ✅ | 100/h |
| Playwright | ❌ | - | ✅ | 50/h |
| nginx | ✅ Optional | Domains | ✅ | 20/h |
| Certbot | ✅ Optional | Domains | ✅ | 10/h |
| DNS | ✅ Optional | Domains | ✅ | 20/h |

### Forbidden Actions

| MCP | Verboten |
|-----|----------|
| Portainer | Production Stack löschen |
| Woodpecker | Secrets auslesen (Werte) |
| Qdrant | Collection ohne Backup löschen |
| n8n | Credentials auslesen |
| GitHub | Force push to main |
| Git | Force push, hard reset |
| Shell | sudo, rm -rf, chmod 777 |
| nginx | Production site löschen |
| Certbot | Wildcard ohne Approval |
| DNS | Haupt-Domain Records ändern |

### Environment Variables (niemals exponiert)

```env
# Diese Werte werden NIEMALS in Logs oder Responses angezeigt
PORTAINER_API_KEY=xxx
WOODPECKER_TOKEN=xxx
QDRANT_API_KEY=xxx
N8N_API_KEY=xxx
GITHUB_TOKEN=xxx
STRATO_API_KEY=xxx
# Alternativ für Cloudflare:
CLOUDFLARE_TOKEN=xxx
CLOUDFLARE_ZONE_ID=xxx
```

---

## Implementierungs-Priorität

### Phase 1: NPM Packages (Sofort verfügbar!)
| MCP | Status | Aufwand |
|-----|--------|---------|
| `github` | 📦 NPM Ready | 2h Config |
| `playwright` | 📦 NPM Ready | 2h Config |
| `puppeteer` | 📦 NPM Ready | 2h Config |

### Phase 2: Kritische MCPs (Woche 1-2)
| MCP | Status | Aufwand |
|-----|--------|---------|
| `portainer` | 🔨 Entwickeln | 24h |
| `woodpecker` | 🔨 Entwickeln | 24h |
| `git` | 🔨 Entwickeln | 16h |
| `shell` | 🔨 Entwickeln | 16h |

### Phase 3: Infrastructure MCPs (Woche 3-4)
| MCP | Status | Aufwand |
|-----|--------|---------|
| `nginx` | 🔨 Entwickeln | 16h |
| `certbot` | 🔨 Entwickeln | 8h |
| `n8n` | 🔨 Entwickeln | 16h |

### Phase 4: Intelligence & DNS (Woche 5)
| MCP | Status | Aufwand |
|-----|--------|---------|
| `qdrant` | 🔨 Entwickeln | 16h |
| `dns` | 🔨 Entwickeln | 8h |

### Zusammenfassung

| Kategorie | Anzahl MCPs | Aufwand |
|-----------|-------------|---------|
| NPM Ready | 3 | ~6h Config |
| Zu entwickeln | 9 | ~144h |
| **GESAMT** | **12** | **~150h** |

---

## Nächste Schritte

1. **Sofort:** NPM Packages konfigurieren (github, playwright, puppeteer)
2. **Woche 1-2:** Kritische MCPs entwickeln (portainer, woodpecker, git, shell)
3. **Woche 3-4:** Infrastructure MCPs (nginx, certbot, n8n)
4. **Woche 5:** Intelligence & DNS (qdrant, dns)

Siehe auch:
- `docs/CTO-TEAM-STRUCTURE.md` - Agent Rollen und Zuordnung
- `docs/CTO-FULL-AUTONOMY.md` - Vollständiger Autonomie-Flow
- `docs/TASK-BACKLOG.md` - Detaillierte Tasks im 7-Phasen-Format
