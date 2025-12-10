# AITO 2.0 - Detailed Requirements & External Systems

## Inhaltsverzeichnis

1. [Architektur-Entscheidungen](#architektur-entscheidungen)
2. [Container-Übersicht](#container-übersicht)
3. [Externe Systeme & APIs](#externe-systeme--apis)
4. [MCP Server Konfiguration](#mcp-server-konfiguration)
5. [Credentials & Zugänge](#credentials--zugänge)
6. [N8N Workflows](#n8n-workflows)
7. [Ollama für lokale Entscheidungen](#ollama-für-lokale-entscheidungen)
8. [Übersetzungs-Strategie](#übersetzungs-strategie)
9. [Datenbank-Schema](#datenbank-schema)
10. [Implementierungs-Reihenfolge](#implementierungs-reihenfolge)

---

## Architektur-Entscheidungen

| Entscheidung | Gewählt | Begründung |
|--------------|---------|------------|
| AI Engine | Claude Code CLI | Alle Agents mit eigenem Auth, Max Plan $200/Monat |
| AI Trigger | Event-basiert | Kein permanentes Polling, nur bei Bedarf |
| State Persistence | Postgres | Reliable, ACID, JSON Support |
| Fast Cache | Redis | Pub/Sub, Queues, Locks |
| Git Structure | Mono-Repo | Big Picture für alle, Filter für Domains |
| Human Interface | Multi-Channel | Telegram + Dashboard + Email |
| Small Decisions | Ollama | Kostenlos, lokal, schnell |
| Translations | DeepL API | Qualität > Kosten, 500k Zeichen/Monat frei |
| Workflows | N8N | Visual, Self-hosted, Webhooks |
| Container Mgmt | Docker-in-Docker | Orchestrator steuert alle |

---

## Container-Übersicht

### Tier 1: Infrastructure (Immer aktiv)

| Container | Image | Ressourcen | Ports | Beschreibung |
|-----------|-------|------------|-------|--------------|
| `postgres` | postgres:15 | 512MB, 1 CPU | 5432 | Hauptdatenbank |
| `redis` | redis:7-alpine | 256MB, 0.5 CPU | 6379 | Cache, Pub/Sub, Queues |
| `orchestrator` | aito-orchestrator | 256MB, 0.5 CPU | 8080 | Container Lifecycle |

### Tier 2: AI Infrastructure (Immer aktiv)

| Container | Image | Ressourcen | Ports | Beschreibung |
|-----------|-------|------------|-------|--------------|
| `ollama` | ollama/ollama | 2GB, 2 CPU | 11434 | Lokale LLMs |
| `qdrant` | qdrant/qdrant | 512MB, 1 CPU | 6333 | Vector DB für RAG |

### Tier 3: Workflow & Automation (Immer aktiv)

| Container | Image | Ressourcen | Ports | Beschreibung |
|-----------|-------|------------|-------|--------------|
| `n8n` | n8nio/n8n | 512MB, 1 CPU | 5678 | Workflow Automation |

### Tier 4: Head Layer (Immer aktiv, AI on-demand)

| Container | Image | Ressourcen | Loop | Beschreibung |
|-----------|-------|------------|------|--------------|
| `ceo-agent` | aito-agent | 512MB, 1 CPU | 1h | Chief Executive |
| `dao-agent` | aito-agent | 512MB, 1 CPU | 6h | Governance |

### Tier 5: C-Level Layer (Immer aktiv, AI on-demand)

| Container | Image | Ressourcen | Loop | Git Domain |
|-----------|-------|------------|------|------------|
| `cmo-agent` | aito-agent | 512MB, 1 CPU | 4h | /content/* |
| `cto-agent` | aito-agent | 512MB, 1 CPU | 1h | /website/* |
| `cfo-agent` | aito-agent | 512MB, 1 CPU | 6h | /treasury/* |
| `coo-agent` | aito-agent | 512MB, 1 CPU | 2h | /community/* |
| `cco-agent` | aito-agent | 512MB, 1 CPU | 24h | /legal/* |

### Tier 6: Workers (On-Demand)

| Container | Spawned By | Max Instances | Auto-Terminate |
|-----------|------------|---------------|----------------|
| `content-writer` | CMO | 3 | Nach Task |
| `code-reviewer` | CTO | 2 | Nach Task |
| `analyst` | CFO | 2 | Nach Task |
| `support-bot` | COO | 5 | Nach Inaktivität |
| `translator` | Any | 2 | Nach Task |

---

## Externe Systeme & APIs

### Blockchain & Crypto

| System | Verwendung | API Type | Rate Limits | Agent |
|--------|------------|----------|-------------|-------|
| **CoinGecko** | Preis, Marktdaten | REST | 30/min (free) | CFO |
| **Etherscan** | Blockchain Data | REST | 5/sec (free) | CFO |
| **QuickNode** | Ethereum RPC | WebSocket | Unlimited (paid) | CFO |
| **DefiLlama** | DeFi Analytics | REST | Unlimited | CFO |
| **Dune Analytics** | Custom Queries | REST | 10/min (free) | CFO |

### Social Media & Community

| System | Verwendung | API Type | Rate Limits | Agent |
|--------|------------|----------|-------------|-------|
| **Twitter/X** | Posts, Mentions | REST v2 | 300/15min | CMO |
| **Telegram** | Bot, Groups | Bot API | 30/sec | COO |
| **Discord** | Bot, Channels | Gateway | 50/sec | COO |
| **Reddit** | r/shibaclassic | REST | 60/min | CMO |

### Content & CMS

| System | Verwendung | API Type | Rate Limits | Agent |
|--------|------------|----------|-------------|-------|
| **Directus** | Website CMS | REST/GraphQL | Unlimited | CTO |
| **GitHub** | Code, Issues, PRs | REST/GraphQL | 5000/h | ALL |
| **IPFS/Pinata** | NFT Metadata | REST | 100/min | CMO |

### Communication

| System | Verwendung | API Type | Rate Limits | Agent |
|--------|------------|----------|-------------|-------|
| **SendGrid** | Transactional Email | REST | 100/day (free) | Orchestrator |
| **Telegram Bot** | Human Alerts | Bot API | 30/sec | Orchestrator |

### AI & Translation

| System | Verwendung | API Type | Rate Limits | Kosten |
|--------|------------|----------|-------------|--------|
| **Claude Code** | Agent Intelligence | CLI | Session Limits | $200/mo |
| **Ollama** | Simple Decisions | REST | Unlimited | Free |
| **DeepL** | Translation | REST | 500k chars/mo | Free |
| **OpenAI** | Embeddings (RAG) | REST | 3500/min | ~$0.0001/1k |

### Governance

| System | Verwendung | API Type | Rate Limits | Agent |
|--------|------------|----------|-------------|-------|
| **Snapshot** | DAO Voting | GraphQL | Unlimited | DAO |
| **Gnosis Safe** | Multi-Sig | REST | Unlimited | CFO |

---

## MCP Server Konfiguration

### Benötigte MCP Server

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      },
      "description": "GitHub Issues, PRs, Code Access"
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_URL": "${DATABASE_URL}"
      },
      "description": "Agent State & History"
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/app/workspace"],
      "description": "Local File Access"
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "description": "Session Memory"
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "${BRAVE_API_KEY}"
      },
      "description": "Web Search für Research"
    },
    "slack": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "env": {
        "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}"
      },
      "description": "Team Communication (optional)"
    }
  }
}
```

### Custom MCP Server (zu entwickeln)

| MCP Server | Funktion | Priority |
|------------|----------|----------|
| `mcp-aito-state` | Agent State CRUD | HIGH |
| `mcp-aito-events` | Event Bus Interface | HIGH |
| `mcp-aito-tasks` | Task Management | HIGH |
| `mcp-blockchain` | Crypto Data Aggregator | MEDIUM |
| `mcp-social` | Social Media Aggregator | MEDIUM |
| `mcp-n8n` | N8N Workflow Trigger | LOW |

---

## Credentials & Zugänge

### Erforderliche Secrets

```yaml
# .env.secrets (NICHT in Git!)

# === CORE ===
POSTGRES_PASSWORD=<secure-password>
REDIS_PASSWORD=<secure-password>

# === AI ===
# Claude Code: Login via `claude auth login` in jedem Container
ANTHROPIC_API_KEY=<für-embeddings-fallback>
OPENAI_API_KEY=<für-embeddings>

# === BLOCKCHAIN ===
ETHERSCAN_API_KEY=<etherscan-key>
QUICKNODE_HTTP_URL=<quicknode-endpoint>
QUICKNODE_WSS_URL=<quicknode-websocket>
COINGECKO_API_KEY=<optional-für-pro>
DUNE_API_KEY=<dune-analytics>

# === SOCIAL ===
TWITTER_BEARER_TOKEN=<twitter-api-v2>
TWITTER_API_KEY=<twitter-key>
TWITTER_API_SECRET=<twitter-secret>
TWITTER_ACCESS_TOKEN=<twitter-access>
TWITTER_ACCESS_SECRET=<twitter-access-secret>

TELEGRAM_BOT_TOKEN=<telegram-bot>
TELEGRAM_ADMIN_CHAT_ID=<admin-chat-für-alerts>

DISCORD_BOT_TOKEN=<discord-bot>
DISCORD_GUILD_ID=<server-id>

REDDIT_CLIENT_ID=<reddit-app>
REDDIT_CLIENT_SECRET=<reddit-secret>
REDDIT_USERNAME=<bot-account>
REDDIT_PASSWORD=<bot-password>

# === CMS & CODE ===
DIRECTUS_TOKEN=<directus-admin-token>
DIRECTUS_URL=https://directus.shibaclassic.io

GITHUB_TOKEN=<github-pat-mit-repo-admin>
GITHUB_ORG=og-shibaclassic

# === COMMUNICATION ===
SENDGRID_API_KEY=<sendgrid>
ADMIN_EMAIL=admin@shibaclassic.io

# === TRANSLATION ===
DEEPL_API_KEY=<deepl-free-oder-pro>

# === SEARCH ===
BRAVE_API_KEY=<brave-search>

# === GOVERNANCE ===
SNAPSHOT_HUB=https://hub.snapshot.org
GNOSIS_SAFE_ADDRESS=<multisig-address>
```

### Claude Code Auth Setup (Pro Container)

```bash
#!/bin/bash
# setup-claude-auth.sh - In jedem Agent Container ausführen

# Interactive login (einmalig)
claude auth login

# Verify
claude --version
claude --print "Auth test successful"

# Config speichern (für Container Restart)
cp -r ~/.claude /app/.claude-auth-backup
```

### GitHub App vs PAT

**Empfehlung: GitHub App** für bessere Security

```yaml
# GitHub App benötigte Permissions:
- Repository: Read & Write
- Issues: Read & Write
- Pull Requests: Read & Write
- Contents: Read & Write
- Metadata: Read
- Webhooks: Read & Write
```

---

## N8N Workflows

### Warum N8N?

| Feature | Vorteil für AITO |
|---------|------------------|
| Visual Workflow Builder | Schnelle Iteration |
| Self-Hosted | Keine externen Kosten |
| 400+ Integrations | Weniger Custom Code |
| Webhooks | Event-Trigger für Agents |
| Scheduling | Cron ohne Custom Code |
| Error Handling | Automatische Retries |

### Geplante N8N Workflows

#### 1. Social Media Monitor
```
Trigger: Every 15 min
→ Fetch Twitter Mentions
→ Fetch Telegram Messages
→ Analyze Sentiment (Ollama)
→ If negative spike → Alert COO
→ Log to Postgres
```

#### 2. Price Alert
```
Trigger: Every 5 min
→ Fetch CoinGecko Price
→ Compare to thresholds
→ If significant change:
   → Notify CFO Agent
   → Post to Telegram (if positive)
   → Log event
```

#### 3. GitHub Activity
```
Trigger: Webhook from GitHub
→ New Issue → Route to appropriate Agent
→ New PR → Notify CTO
→ Merged PR → Log & Celebrate
```

#### 4. Daily Digest
```
Trigger: Every day 9:00 UTC
→ Collect all Agent reports
→ Aggregate metrics
→ Generate summary (Claude via API)
→ Send Email to Admin
→ Post to Telegram
```

#### 5. Human Escalation
```
Trigger: Webhook from Orchestrator
→ Format escalation message
→ Send to Telegram
→ Send Email
→ Create Dashboard notification
→ Wait for response
→ Forward decision to Orchestrator
```

#### 6. Content Publisher
```
Trigger: Webhook from CMO Agent
→ Validate content
→ Post to Twitter
→ Post to Telegram
→ Update Directus
→ Log success/failure
→ Notify CMO
```

---

## Ollama für lokale Entscheidungen

### Use Cases für Ollama (statt Claude)

| Task | Model | Warum lokal? |
|------|-------|--------------|
| Sentiment Analysis | llama3.2:3b | Schnell, häufig, einfach |
| Content Classification | llama3.2:1b | Kategorisierung |
| Spam Detection | orca-mini | Einfache Ja/Nein |
| Summary Generation | llama3.2:3b | Nicht kritisch |
| Translation Check | llama3.2:3b | Qualitätsprüfung |
| Intent Detection | llama3.2:1b | Routing |

### Ollama Models Setup

```bash
# Im Ollama Container
ollama pull llama3.2:1b    # 1.3GB - Ultraschnell
ollama pull llama3.2:3b    # 2.0GB - Balanciert
ollama pull orca-mini      # 1.9GB - Backup
ollama pull nomic-embed-text # 274MB - Embeddings
```

### Decision Routing Logic

```typescript
interface DecisionRequest {
  type: 'sentiment' | 'classification' | 'spam' | 'summary' | 'complex';
  content: string;
  urgency: 'low' | 'normal' | 'high';
}

function routeDecision(req: DecisionRequest): 'ollama' | 'claude' {
  // Einfache Tasks → Ollama
  if (['sentiment', 'classification', 'spam'].includes(req.type)) {
    return 'ollama';
  }

  // Komplexe Tasks → Claude
  if (req.type === 'complex') {
    return 'claude';
  }

  // Summary: Ollama für Draft, Claude für Final
  if (req.type === 'summary' && req.urgency !== 'high') {
    return 'ollama';
  }

  return 'claude';
}
```

### Kosteneinsparung durch Ollama

```
Geschätzte monatliche AI Calls:
- Sentiment Checks: 10,000 (alle 15min für 30 Tage)
- Classifications: 5,000
- Spam Detection: 20,000
- Summaries: 500
- Complex Decisions: 1,000

Mit nur Claude: ~36,500 calls = Session Limits schnell erreicht
Mit Ollama für Simple: ~35,000 lokal, ~1,500 Claude = Nachhaltig
```

---

## Übersetzungs-Strategie

### Empfehlung: DeepL API

| Aspekt | DeepL | Claude | Google Translate |
|--------|-------|--------|------------------|
| Qualität | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| Kosten | 500k free | Session verbraucht | $20/1M chars |
| Speed | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| API Simplicity | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |

### Sprach-Matrix

| Sprache | Code | Priorität | Use Case |
|---------|------|-----------|----------|
| English | en | Primary | Default, Technical |
| Deutsch | de | High | DACH Community |
| Français | fr | Medium | EU Expansion |
| 中文 | zh | Medium | Asia Expansion |
| العربية | ar | Low | MENA Region |
| Tiếng Việt | vi | Low | SEA Region |

### Translation Workflow

```
Content Created (EN)
       │
       ▼
┌──────────────────┐
│  CMO Reviews     │
│  English Version │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  DeepL API       │
│  Batch Translate │
│  → DE, FR, ZH... │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Ollama Check    │  ← Optional: Qualitätsprüfung
│  (Consistency)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Publish to      │
│  Directus CMS    │
└──────────────────┘
```

### DeepL API Integration

```typescript
// lib/translation.ts
import * as deepl from 'deepl-node';

const translator = new deepl.Translator(process.env.DEEPL_API_KEY);

const SUPPORTED_LANGS: deepl.TargetLanguageCode[] = [
  'de', 'fr', 'zh', 'ar', 'vi'
];

async function translateContent(
  content: string,
  sourceLang: deepl.SourceLanguageCode = 'en'
): Promise<Record<string, string>> {
  const translations: Record<string, string> = { en: content };

  for (const targetLang of SUPPORTED_LANGS) {
    const result = await translator.translateText(
      content,
      sourceLang,
      targetLang,
      { preserveFormatting: true }
    );
    translations[targetLang] = result.text;
  }

  return translations;
}
```

---

## Datenbank-Schema

### Postgres Erweiterungen

```sql
-- Erforderliche Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- UUID Generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- Encryption
CREATE EXTENSION IF NOT EXISTS "vector";         -- pgvector für Embeddings
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- Fuzzy Search
```

### Core Tables (siehe ARCHITECTURE.md)

- `agents` - Agent Definitionen
- `agent_state` - Persistenter State
- `agent_history` - Aktions-Log mit Embeddings
- `decisions` - Veto-Prozess Tracking
- `tasks` - Work Items
- `events` - Audit Log

### Zusätzliche Tables

```sql
-- Translations Cache
CREATE TABLE translations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_text TEXT NOT NULL,
    source_lang VARCHAR(5) DEFAULT 'en',
    target_lang VARCHAR(5) NOT NULL,
    translated_text TEXT NOT NULL,
    source_hash VARCHAR(64) NOT NULL,  -- SHA256 für Cache Lookup
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(source_hash, target_lang)
);

-- External API Cache
CREATE TABLE api_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint VARCHAR(255) NOT NULL,
    params_hash VARCHAR(64) NOT NULL,
    response JSONB NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(endpoint, params_hash)
);

-- Metrics Time Series
CREATE TABLE metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_name VARCHAR(100) NOT NULL,
    metric_value NUMERIC NOT NULL,
    labels JSONB DEFAULT '{}',
    recorded_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_metrics_name_time ON metrics(metric_name, recorded_at DESC);

-- Human Escalations
CREATE TABLE escalations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    decision_id UUID REFERENCES decisions(id),
    reason TEXT NOT NULL,
    channels_notified JSONB DEFAULT '[]',  -- ['telegram', 'email', 'dashboard']
    human_response TEXT,
    responded_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending',  -- pending, responded, timeout
    created_at TIMESTAMP DEFAULT NOW()
);

-- N8N Workflow Executions
CREATE TABLE workflow_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id VARCHAR(100) NOT NULL,
    workflow_name VARCHAR(255),
    trigger_type VARCHAR(50),  -- webhook, schedule, manual
    input_data JSONB,
    output_data JSONB,
    status VARCHAR(20),  -- running, success, error
    error_message TEXT,
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);
```

---

## Implementierungs-Reihenfolge

### Phase 1: Foundation (Woche 1)
| Task | Beschreibung | Abhängigkeiten |
|------|--------------|----------------|
| 1.1 | Postgres Setup + Schema | - |
| 1.2 | Redis Setup | - |
| 1.3 | Orchestrator Base Container | 1.1, 1.2 |
| 1.4 | Docker-in-Docker Setup | 1.3 |
| 1.5 | Health Check System | 1.3 |

### Phase 2: AI Infrastructure (Woche 1-2)
| Task | Beschreibung | Abhängigkeiten |
|------|--------------|----------------|
| 2.1 | Ollama Setup + Models | 1.1 |
| 2.2 | Qdrant Setup | 1.1 |
| 2.3 | Embedding Pipeline | 2.1, 2.2 |
| 2.4 | RAG System | 2.3 |

### Phase 3: Agent Framework (Woche 2)
| Task | Beschreibung | Abhängigkeiten |
|------|--------------|----------------|
| 3.1 | Base Agent Container Image | 1.3 |
| 3.2 | Claude Code Auth System | 3.1 |
| 3.3 | Agent State Management | 1.1, 3.1 |
| 3.4 | Event-based Trigger System | 1.2, 3.1 |
| 3.5 | MCP Server Integration | 3.1 |

### Phase 4: Head Layer (Woche 2-3)
| Task | Beschreibung | Abhängigkeiten |
|------|--------------|----------------|
| 4.1 | CEO Agent Implementation | 3.* |
| 4.2 | DAO Agent Implementation | 3.* |
| 4.3 | Veto Loop System | 4.1, 4.2 |
| 4.4 | Head Communication Channel | 1.2, 4.1, 4.2 |

### Phase 5: C-Level Layer (Woche 3-4)
| Task | Beschreibung | Abhängigkeiten |
|------|--------------|----------------|
| 5.1 | CMO Agent | 3.*, 4.1 |
| 5.2 | CTO Agent | 3.*, 4.1 |
| 5.3 | CFO Agent | 3.*, 4.1 |
| 5.4 | COO Agent | 3.*, 4.1 |
| 5.5 | CCO Agent | 3.*, 4.1 |

### Phase 6: External Integration (Woche 4)
| Task | Beschreibung | Abhängigkeiten |
|------|--------------|----------------|
| 6.1 | N8N Setup | 1.* |
| 6.2 | N8N Workflows | 6.1 |
| 6.3 | Social Media APIs | 5.1, 5.4 |
| 6.4 | Blockchain APIs | 5.3 |
| 6.5 | Translation Pipeline | 2.1 |

### Phase 7: Human Interface (Woche 4-5)
| Task | Beschreibung | Abhängigkeiten |
|------|--------------|----------------|
| 7.1 | Telegram Bot für Escalation | 1.3 |
| 7.2 | Dashboard UI | 1.1 |
| 7.3 | Email Notifications | 6.1 |
| 7.4 | Multi-Channel Router | 7.1, 7.2, 7.3 |

### Phase 8: Autonomy (Woche 5-6)
| Task | Beschreibung | Abhängigkeiten |
|------|--------------|----------------|
| 8.1 | Worker Spawning System | 1.3, 3.* |
| 8.2 | Self-Healing Containers | 1.3 |
| 8.3 | Idea Generation Loop | 4.1, 5.* |
| 8.4 | Full System Test | ALL |
| 8.5 | Documentation | ALL |

---

## Ressourcen-Schätzung

### Server Requirements

```
Minimum Production Setup:
- CPU: 8 Cores
- RAM: 16 GB
- Storage: 100 GB SSD
- Network: 100 Mbit/s

Recommended:
- CPU: 16 Cores
- RAM: 32 GB
- Storage: 250 GB NVMe
- Network: 1 Gbit/s
```

### Monatliche Kosten (Geschätzt)

| Service | Kosten | Notizen |
|---------|--------|---------|
| Claude Max Plan | $200 | Flat Rate |
| Server (Hetzner) | ~$50 | Dedicated oder Cloud |
| Domains/SSL | ~$5 | |
| DeepL | $0 | Free Tier reicht |
| Etherscan | $0 | Free Tier |
| SendGrid | $0 | Free Tier |
| **Total** | **~$255/Monat** | |
