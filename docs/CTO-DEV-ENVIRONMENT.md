# CTO Development Environment Architecture

## Status: UPDATED - 2025-12-23

> **See also:** [CTO-MCP-INVENTORY.md](./CTO-MCP-INVENTORY.md) for detailed MCP tool specifications

---

## Motivation

Der CTO Agent soll der **ausführende Hauptagent** sein, der:
- Eigene Projekte anlegen und managen kann
- CI/CD Pipelines vollständig kontrolliert (via Woodpecker CI)
- Container Deployments via Portainer steuert
- Workers für Development-Tasks spawnt
- n8n Flows für Automatisierung erstellt
- RAG/Vector Search via Qdrant nutzt
- Monitoring & Alerting selbstständig handhabt

---

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

## Aktuelle Limitierungen

### CTO heute:
- Nur Monitoring (keine echte Ausführung)
- Kein Projekterstellung
- Kein CI/CD Control (Woodpecker)
- Kein Container Control (Portainer)
- Keine n8n Integration
- Kein Vector Search (Qdrant)
- Nur basic MCPs (directus, fetch, filesystem)

### Was fehlt:
1. **Portainer MCP** - Container Management via Portainer API
2. **Woodpecker MCP** - CI/CD Pipeline Management
3. **Qdrant MCP** - Vector Store für RAG
4. **n8n MCP** - Workflows erstellen
5. **GitHub MCP** - Repos, PRs, Issues (NPM package existiert)
6. **Development Workers** - Code, Tests, Deploy

---

## Architektur Vision

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CTO AGENT (Main Loop)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  ENTSCHEIDET:                                                                │
│  • Welches Projekt braucht Aufmerksamkeit?                                   │
│  • Was muss entwickelt/deployed/gefixt werden?                               │
│  • Welche Workflows müssen erstellt werden?                                  │
│  • Welche Pipelines müssen getriggert werden?                                │
│                                                                              │
│  SPAWNT WORKERS für:                                                         │
│  ┌───────────────┬───────────────┬───────────────┬────────────────┐         │
│  │ Code Worker   │ Test Worker   │ Deploy Worker │ Monitor Worker │         │
│  │ [github]      │ [woodpecker]  │ [portainer]   │ [fetch]        │         │
│  │ [filesystem]  │ [filesystem]  │ [n8n]         │ [n8n]          │         │
│  │               │               │ [woodpecker]  │ [qdrant]       │         │
│  └───────────────┴───────────────┴───────────────┴────────────────┘         │
│                                                                              │
│  ERSTELLT n8n FLOWS:                                                         │
│  • Auto-Deploy on PR merge (Woodpecker → Portainer)                          │
│  • Alert on Error threshold                                                  │
│  • Scheduled Security Scans                                                  │
│  • Backup Automation                                                         │
│                                                                              │
│  NUTZT QDRANT für:                                                           │
│  • Code Similarity Search                                                    │
│  • Error Pattern Analysis                                                    │
│  • Documentation RAG                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## MCP Server Stack

### Übersicht

| MCP | Priorität | Lizenz | Status |
|-----|-----------|--------|--------|
| `portainer` | 🔴 HOCH | Custom | Zu entwickeln |
| `woodpecker` | 🔴 HOCH | Apache 2.0 | Zu entwickeln |
| `qdrant` | 🟠 MITTEL | Apache 2.0 | Zu entwickeln |
| `n8n` | 🟠 MITTEL | Custom | Zu entwickeln |
| `github` | 🟡 NIEDRIG | MIT | NPM Package |

### 1. Portainer MCP (Priorität: HOCH)

**Ersetzt direkten Docker-Zugriff** - sicherer und kontrollierter!

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

**Tools:**
- `portainer_list_endpoints` - Endpoints auflisten
- `portainer_list_stacks` - Docker Stacks auflisten
- `portainer_deploy_stack` - Stack deployen (docker-compose)
- `portainer_update_stack` - Stack aktualisieren
- `portainer_start_stack` / `portainer_stop_stack` - Stack steuern
- `portainer_list_containers` - Container auflisten
- `portainer_container_logs` - Container Logs abrufen
- `portainer_container_stats` - CPU/Memory Stats
- `portainer_restart_container` - Container neustarten

**Sicherheit:**
- Whitelist für erlaubte Stacks (`ALLOWED_STACKS`)
- Optional Read-Only Mode
- Audit Logging aller Aktionen
- Environment Isolation (Prod/Staging)

### 2. Woodpecker CI MCP (Priorität: HOCH)

**Ersetzt GitHub Actions** - selbst-gehostet und kontrolliert!

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

**Tools:**
- `woodpecker_list_repos` - Repos auflisten
- `woodpecker_list_pipelines` - Pipelines eines Repos
- `woodpecker_get_pipeline` - Pipeline Details + Logs
- `woodpecker_start_pipeline` - Pipeline manuell starten
- `woodpecker_cancel_pipeline` - Pipeline abbrechen
- `woodpecker_approve_pipeline` - Pipeline approven
- `woodpecker_decline_pipeline` - Pipeline ablehnen
- `woodpecker_get_logs` - Build Logs abrufen
- `woodpecker_list_secrets` - Secrets auflisten (nur Namen!)

**Sicherheit:**
- Secrets nie auslesen (nur Namen)
- Branch Protection für main/production
- Manual Approval für Production Deploys
- Repo Whitelist

### 3. Qdrant MCP (Priorität: MITTEL)

**Vector Store für RAG und Code Intelligence**

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

**Tools:**
- `qdrant_list_collections` - Collections auflisten
- `qdrant_get_collection` - Collection Info
- `qdrant_create_collection` - Collection erstellen
- `qdrant_search` - Similarity Search
- `qdrant_search_batch` - Batch Search
- `qdrant_upsert_points` - Punkte einfügen/updaten
- `qdrant_get_points` - Punkte abrufen
- `qdrant_scroll` - Durch Collection iterieren
- `qdrant_count` - Punkte zählen

**Use Cases für CTO:**
1. **Code Search** - Ähnlichen Code finden
2. **Error Analysis** - Ähnliche Fehler finden
3. **Documentation** - Relevante Docs finden
4. **Duplicate Detection** - Doppelte Issues erkennen

### 4. n8n MCP (Priorität: MITTEL)

**Workflow Automation**

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

**Tools:**
- `n8n_list_workflows` - Workflows auflisten
- `n8n_get_workflow` - Workflow Details
- `n8n_create_workflow` - Workflow erstellen
- `n8n_update_workflow` - Workflow bearbeiten
- `n8n_activate_workflow` / `n8n_deactivate_workflow` - An/Aus
- `n8n_execute_workflow` - Manuell ausführen
- `n8n_list_executions` - Ausführungen auflisten
- `n8n_list_credentials` - Credentials auflisten (nur Namen!)

### 5. GitHub MCP (Priorität: NIEDRIG)

**NPM Package existiert bereits!**

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

**Tools (vom Package):**
- `create_repository` / `search_repositories`
- `create_pull_request` / `merge_pull_request`
- `list_issues` / `create_issue` / `update_issue`
- `get_file_contents` / `push_files`
- `create_branch` / `list_commits`
- `search_code` / `search_issues`

---

## Worker-Typen

### 1. Code Worker
**Aufgabe:** Code generieren, refactoren, fixen

```json
{
  "type": "spawn_worker",
  "task": "Create new TypeScript module for user authentication with JWT",
  "servers": ["github", "filesystem"],
  "timeout": 300000
}
```

### 2. Test Worker
**Aufgabe:** Tests schreiben und ausführen

```json
{
  "type": "spawn_worker",
  "task": "Trigger Woodpecker pipeline for auth module and report results",
  "servers": ["woodpecker", "filesystem"],
  "timeout": 180000
}
```

### 3. Deploy Worker
**Aufgabe:** Deployments durchführen

```json
{
  "type": "spawn_worker",
  "task": "Deploy latest main branch: 1. Start Woodpecker build 2. Wait for success 3. Update Portainer stack 4. Verify health",
  "servers": ["woodpecker", "portainer", "n8n"],
  "timeout": 600000
}
```

### 4. Monitor Worker
**Aufgabe:** Systeme überwachen

```json
{
  "type": "spawn_worker",
  "task": "Check all endpoints, query Qdrant for similar past errors, create alert if needed",
  "servers": ["fetch", "qdrant", "n8n"],
  "timeout": 120000
}
```

### 5. RAG Worker
**Aufgabe:** Code Intelligence und Dokumentation

```json
{
  "type": "spawn_worker",
  "task": "Search Qdrant for similar code patterns, find documentation for error X",
  "servers": ["qdrant", "filesystem"],
  "timeout": 60000
}
```

---

## n8n Workflow Templates

### 1. Auto-Deploy on Merge (Woodpecker → Portainer)
```
Trigger: GitHub Webhook (PR merged to main)
    ↓
Action: Trigger Woodpecker Pipeline
    ↓
Wait: Pipeline completion
    ↓
Action: Update Portainer Stack
    ↓
Action: Health Check
    ↓
Notify: Telegram/Discord
```

### 2. Error Alert Pipeline
```
Trigger: Webhook from Monitoring
    ↓
Filter: Error Count > Threshold
    ↓
Action: Query Qdrant for similar errors
    ↓
Action: Aggregate Errors + Context
    ↓
Action: Create GitHub Issue
    ↓
Notify: Telegram Alert
    ↓
Action: Notify CTO Agent
```

### 3. Scheduled Security Scan
```
Trigger: Cron (daily 3 AM)
    ↓
Action: Trigger Woodpecker security pipeline
    ↓
Action: Run npm audit
    ↓
Filter: Critical/High Vulnerabilities
    ↓
Action: Create Issue
    ↓
Notify: Alert Team
```

### 4. Backup Automation
```
Trigger: Cron (hourly)
    ↓
Action: Dump PostgreSQL (via Portainer exec)
    ↓
Action: Backup Redis
    ↓
Action: Upload to S3/Backblaze
    ↓
Action: Cleanup old backups
    ↓
Log: Backup complete
```

---

## Projekt-Management

### CTO kann Projekte erstellen:

```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Create new project 'shibc-api' with TypeScript template, initialize git, create GitHub repo, setup Woodpecker CI, prepare Portainer stack",
    "servers": ["github", "filesystem", "woodpecker", "n8n"],
    "timeout": 600000
  }]
}
```

### Projekt-Struktur:
```
/app/workspace/projects/
├── shibc-api/
│   ├── src/
│   ├── tests/
│   ├── package.json
│   ├── Dockerfile
│   ├── .woodpecker.yml       # Woodpecker CI config
│   ├── docker-compose.yml    # Für Portainer Stack
│   └── README.md
├── shibc-website/
└── shibc-contracts/
```

### Lifecycle:
1. **Create** - Repo + Template + Woodpecker CI
2. **Develop** - Code Workers + Tests
3. **Review** - PR Workflow
4. **Build** - Woodpecker Pipeline
5. **Deploy** - Portainer Stack Update
6. **Monitor** - Health + Alerts + Qdrant Analysis

---

## CTO Profile Update (Entwurf)

### Neue MCP Server Tabelle:

| Server | Hauptloop | Worker | Verwendung |
|--------|-----------|--------|------------|
| `filesystem` | ✅ JA | ✅ JA | Workspace-Dateien |
| `fetch` | ✅ JA | ✅ JA | HTTP Requests, APIs |
| `portainer` | ❌ NEIN | ✅ JA | Container via Portainer API |
| `woodpecker` | ❌ NEIN | ✅ JA | CI/CD Pipelines |
| `qdrant` | ❌ NEIN | ✅ JA | Vector Search, RAG |
| `n8n` | ❌ NEIN | ✅ JA | Workflow Automation |
| `github` | ❌ NEIN | ✅ JA | Repos, PRs, Issues (high context) |
| `directus` | ❌ NEIN | ✅ JA | CMS Content (high context) |

### Neue Worker Task Templates:

**Projekt erstellen:**
```json
{"actions": [{"type": "spawn_worker", "task": "Create new TypeScript project [name] with: 1. GitHub repo 2. Woodpecker CI config 3. Portainer stack definition 4. Initial structure", "servers": ["github", "filesystem", "woodpecker"], "timeout": 300000}]}
```

**Deployment ausführen:**
```json
{"actions": [{"type": "spawn_worker", "task": "Deploy [project] to [environment]: 1. Trigger Woodpecker build 2. Wait for success 3. Update Portainer stack 4. Verify health", "servers": ["woodpecker", "portainer"], "timeout": 600000}]}
```

**n8n Workflow erstellen:**
```json
{"actions": [{"type": "spawn_worker", "task": "Create n8n workflow: Auto-deploy on PR merge for [repo]. Trigger: GitHub webhook. Actions: Woodpecker build, Portainer deploy, Health check, Notify.", "servers": ["n8n"], "timeout": 180000}]}
```

**Code Intelligence:**
```json
{"actions": [{"type": "spawn_worker", "task": "Search Qdrant for similar code to [pattern]. Find related documentation and past issues.", "servers": ["qdrant", "filesystem"], "timeout": 60000}]}
```

**Tests ausführen:**
```json
{"actions": [{"type": "spawn_worker", "task": "Trigger Woodpecker test pipeline for [project]. Wait for completion. Report: passed, failed, coverage. Create issue if failures.", "servers": ["woodpecker", "github"], "timeout": 300000}]}
```

---

## Implementierungs-Roadmap

### Phase 1: Basis (Woche 1-2)
- [ ] GitHub MCP einrichten (NPM Package, schnell)
- [ ] Portainer MCP entwickeln
- [ ] Testen: Stack deploy, Container restart

### Phase 2: CI/CD (Woche 3-4)
- [ ] Woodpecker MCP entwickeln
- [ ] n8n MCP entwickeln
- [ ] Testen: Pipeline trigger, Workflow creation

### Phase 3: Intelligence (Woche 5)
- [ ] Qdrant MCP entwickeln
- [ ] RAG Integration
- [ ] Testen: Similarity search, Code patterns

### Phase 4: Integration (Woche 6)
- [ ] Alle MCPs zusammen testen
- [ ] CTO Profile finalisieren
- [ ] Worker Templates dokumentieren
- [ ] E2E Test: Projekt → Woodpecker → Portainer → Monitor

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

### Verbotene Aktionen

| MCP | Verboten |
|-----|----------|
| Portainer | Production Stack löschen |
| Woodpecker | Secrets auslesen (Werte) |
| Qdrant | Collection ohne Backup löschen |
| n8n | Credentials auslesen |
| GitHub | Force push to main |

### Environment Variables (niemals exponiert)

```env
# Diese Werte werden NIEMALS in Logs oder Responses angezeigt
PORTAINER_API_KEY=xxx
WOODPECKER_TOKEN=xxx
QDRANT_API_KEY=xxx
N8N_API_KEY=xxx
GITHUB_TOKEN=xxx
```

---

## Nächste Schritte

1. **Sofort:** GitHub MCP einrichten (NPM Package existiert)
2. **Dann:** Portainer MCP entwickeln (Container Control)
3. **Dann:** Woodpecker MCP entwickeln (CI/CD Control)
4. **Dann:** n8n MCP entwickeln (Workflow Automation)
5. **Dann:** Qdrant MCP entwickeln (Vector Search)
6. **Final:** CTO Profile komplett überarbeiten

Siehe `docs/TASK-BACKLOG.md` für detaillierte Tasks im 7-Phasen-Format.

---

## Offene Fragen

1. Soll der CTO auch **Smart Contract Deployments** machen? (Hardhat/Foundry)
2. Brauchen wir ein **Database MCP** für Migrations?
3. Wie viel Autonomie für **Production Deployments**?
4. **Budget-Limits** für Cloud Resources?
5. Soll Qdrant auch für **Agent Memory** genutzt werden?
