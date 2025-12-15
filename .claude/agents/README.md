# AITO Task Agents

Specialized agents that can be spawned by AITO C-Level agents.

## Output Conventions

**IMPORTANT:** Agents NEVER store results in local files!

### GitHub Issues (Persistent Documentation)
```bash
# Create report as issue
gh issue create --title "[REPORT] Weekly Analysis" --body "$CONTENT" --label "type:report"

# Append result to existing issue
gh issue comment $ISSUE_NUMBER --body "$RESULT"
```

### Redis (Temporary Context)
```bash
# Set context for other agents (TTL: 24h)
redis-cli SET "context:market:latest" "$JSON_DATA" EX 86400

# Read context
redis-cli GET "context:market:latest"
```

### Redis Key Convention
```
context:{domain}:{key}     - Shared context (TTL: 24h)
result:{agent}:{task_id}   - Task results (TTL: 1h)
cache:{source}:{query}     - API cache (TTL: 10min)
```

## Available Agents

| Agent | Purpose | Output |
|-------|---------|--------|
| `pr-creator` | Create PRs for workspace changes | GitHub PR URL |
| `issue-creator` | Create GitHub issues with labels | GitHub Issue URL |
| `analyst` | Code review, market data, metrics | Redis context |
| `executor` | Run tests, builds, deployments | Redis result |

## Spawn Example

```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Analyze SHIBC market data, store in context:market:daily",
    "servers": ["fetch"],
    "timeout": 60000
  }]
}
```
