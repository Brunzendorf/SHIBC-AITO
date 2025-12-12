# Environment Variables Reference

## Core Infrastructure

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_DB` | Yes | `aito` | Database name |
| `POSTGRES_USER` | Yes | `aito` | Database user |
| `POSTGRES_PASSWORD` | Yes | - | Database password |
| `POSTGRES_URL` | Auto | - | Full connection string (generated) |
| `REDIS_URL` | Yes | - | Redis connection URL |
| `OLLAMA_URL` | Yes | - | Ollama API endpoint |

## Orchestrator

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `production` | Environment mode |
| `LOG_LEVEL` | No | `info` | Logging verbosity |
| `PORTAINER_URL` | Yes | - | Portainer API URL |
| `PORTAINER_API_KEY` | Yes | - | Portainer authentication |
| `PORTAINER_ENV_ID` | No | `4` | Portainer environment ID |

## GitHub & Workspace

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_TOKEN` | Yes | - | GitHub PAT with `repo` scope |
| `GITHUB_ORG` | No | - | GitHub organization name |
| `WORKSPACE_REPO_URL` | Yes | - | Git repository for agent outputs |
| `WORKSPACE_BRANCH` | No | `main` | Target branch |
| `WORKSPACE_AUTO_COMMIT` | No | `true` | Auto-commit changes |
| `WORKSPACE_USE_PR` | No | `true` | Use PR workflow (quality gate) |
| `WORKSPACE_AUTO_MERGE` | No | `false` | Auto-merge after RAG approval |

## CMS & Content

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DIRECTUS_URL` | CTO | - | Directus CMS URL |
| `DIRECTUS_TOKEN` | CTO | - | Directus API token |

## Social Media

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TWITTER_BEARER_TOKEN` | CMO | - | Twitter API v2 bearer token |
| `TELEGRAM_BOT_TOKEN` | COO/CMO | - | Telegram Bot API token |
| `TELEGRAM_ADMIN_CHAT_ID` | No | - | Admin chat for escalations |
| `DISCORD_BOT_TOKEN` | COO | - | Discord bot token |

## Blockchain & Crypto

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ETHERSCAN_API_KEY` | CFO | - | Etherscan API key |
| `COINMARKETCAP_API_KEY` | CFO | - | CoinMarketCap API key |
| `COINGECKO_API_KEY` | CFO | - | CoinGecko API key (optional) |
| `COINGECKO_TOKEN_ID` | CFO | - | Token ID on CoinGecko |
| `TOKEN_CONTRACT_ETH` | CFO | - | Token contract address |
| `QUICKNODE_HTTP_URL` | CFO | - | QuickNode RPC endpoint |
| `INFURA_PROJECT_ID` | CFO | - | Infura project ID (backup) |
| `ALCHEMY_API_KEY` | CFO | - | Alchemy API key (backup) |
| `GNOSIS_SAFE_ADDRESS` | CFO/DAO | - | Treasury multisig address |

## News & Social Intelligence

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEWS_API_KEY` | CMO | - | NewsAPI.org key |
| `REDDIT_CLIENT_ID` | CMO | - | Reddit OAuth client ID |
| `REDDIT_CLIENT_SECRET` | CMO | - | Reddit OAuth client secret |
| `REDDIT_USER_AGENT` | CMO | - | Reddit API user agent |

## Workflow Automation (N8N)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `N8N_ENCRYPTION_KEY` | Yes | - | N8N encryption key (32 chars) |
| `N8N_USER` | No | `admin` | N8N basic auth user |
| `N8N_PASSWORD` | No | `admin` | N8N basic auth password |
| `N8N_WEBHOOK_URL` | No | - | N8N webhook base URL |
| `N8N_API_KEY` | No | - | N8N API key for automation |

## Human Escalation

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENDGRID_API_KEY` | No | - | SendGrid for email alerts |
| `ADMIN_EMAIL` | No | - | Admin email for escalations |
| `TELEGRAM_ADMIN_CHAT_ID` | No | - | Telegram chat for alerts |

## Agent-Specific

Each agent receives these via docker-compose:

| Variable | Description |
|----------|-------------|
| `AGENT_TYPE` | Agent type (ceo, cmo, cto, etc.) |
| `AGENT_PROFILE` | Path to profile markdown |
| `LOOP_INTERVAL` | Seconds between loops |
| `GIT_FILTER` | File path filter for workspace |

## Example .env

See `.env.example` in the repository root for a template with all variables.
Copy to `.env` and fill in your values:

```bash
cp .env.example .env
# Edit .env with your actual values
```

**IMPORTANT**: Never commit `.env` to git. Only `.env.example` with placeholder values.

## Security Notes

1. **Never commit .env to git** - use `.env.example` as template
2. **Rotate tokens regularly** - especially GITHUB_TOKEN
3. **Use minimal scopes** - only grant required permissions
4. **Separate prod/dev** - use different tokens for each environment
5. **Encrypt at rest** - use secrets management in production
