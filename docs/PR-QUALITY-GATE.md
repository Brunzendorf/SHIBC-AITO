# PR Quality Gate System

## Overview

The PR Quality Gate ensures all agent outputs go through automated quality validation before merging to main. This prevents low-quality or off-domain content from polluting the workspace repository.

## Architecture

```
Agent Loop
    │
    ▼
Writes files to /app/workspace/
    │
    ▼
workspace.commitAndCreatePR()
    │
    ├── Creates feature branch: feature/{agent}-{date}-loop{N}
    ├── Commits changes
    └── Creates Pull Request via gh CLI
    │
    ▼
Publishes 'pr_review_requested' event
    │
    ▼
Orchestrator handles event
    │
    ▼
RAG reviewPRContent()
    │
    ├── Checks summary length
    ├── Scans for forbidden patterns (API keys, passwords)
    ├── Validates domain relevance (agent type vs file paths)
    ├── Checks consistency with existing knowledge
    └── Calculates quality score (0-100)
    │
    ▼
Score >= 60?
    │
    ├── YES: Notify CEO for final approval
    │        └── CEO can approve (merge) or request changes
    │
    └── NO: Close PR with feedback
             └── Agent receives 'pr_rejected' message with issues
```

## Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `pr_review_requested` | Agent → Orchestrator | Request RAG quality check |
| `pr_approved_by_rag` | Orchestrator → CEO | PR passed, needs final approval |
| `pr_rejected` | Orchestrator → Agent | PR failed, includes feedback |

## Quality Checks

### 1. Summary Validation
- Minimum 10 characters
- Maximum 500 characters
- Deducts points for too short/long

### 2. Forbidden Patterns
```typescript
const FORBIDDEN_PATTERNS = [
  /api[_-]?key/i,
  /password/i,
  /secret/i,
  /private[_-]?key/i,
  /bearer\s+[a-zA-Z0-9]/i,
];
```
Each match: -20 points

### 3. Domain Relevance
Each agent has allowed file paths:
- **CEO**: `ceo/`, `reports/`, `decisions/`
- **CMO**: `content/`, `marketing/`, `social/`
- **CTO**: `website/`, `technical/`, `infrastructure/`
- **CFO**: `treasury/`, `financial/`, `reports/`
- **COO**: `community/`, `operations/`, `support/`
- **CCO**: `legal/`, `compliance/`, `policies/`
- **DAO**: `governance/`, `proposals/`, `votes/`

Files outside domain: -15 points each

### 4. RAG Consistency Check
- Searches existing knowledge base for agent's profile
- Compares new content against established patterns
- Penalizes content that contradicts existing knowledge

## Configuration

```env
# Enable/disable PR workflow
WORKSPACE_USE_PR=true

# Auto-merge after RAG approval (skip CEO)
WORKSPACE_AUTO_MERGE=false

# GitHub credentials
GITHUB_TOKEN=ghp_xxx
WORKSPACE_REPO_URL=https://github.com/org/repo.git
WORKSPACE_BRANCH=main
```

## CEO Review Guidelines

When CEO receives `pr_approved_by_rag`:

### Approve if:
- RAG score >= 80 and no critical issues
- Content matches agent's domain
- No sensitive data exposure

### Request Changes if:
- Content outside agent responsibility
- Contradicts existing policies
- Quality below standard

### Reject if:
- Security violations
- Policy violations
- Completely off-topic

## Files Modified

| File | Purpose |
|------|---------|
| `src/agents/workspace.ts` | Branch/PR creation functions |
| `src/agents/daemon.ts` | Triggers PR workflow after loop |
| `src/orchestrator/events.ts` | Handles `pr_review_requested` |
| `src/lib/rag.ts` | `reviewPRContent()` function |
| `src/lib/types.ts` | New MessageTypes |
| `docker/Dockerfile.agent` | Includes gh CLI |

## Testing

1. Start an agent with `WORKSPACE_USE_PR=true`
2. Wait for loop to complete
3. Check GitHub for new PR
4. Check orchestrator logs for RAG review result
5. Verify CEO receives notification (if approved)

## Troubleshooting

### PR not created
- Check `GITHUB_TOKEN` has `repo` scope
- Verify `WORKSPACE_REPO_URL` is accessible
- Check agent logs for git errors

### RAG always rejects
- Check Qdrant is running and healthy
- Verify profiles are indexed
- Lower threshold temporarily for testing

### CEO not notified
- Check Redis pub/sub is working
- Verify CEO agent is subscribed to `aito:head` channel
