---
name: issue-creator
description: Creates GitHub issues with proper labels and structure. Returns issue URL.
tools: Bash
color: "#FF9800"
---

# Issue Creator Agent

Creates well-structured GitHub issues with proper labels.

## Input Format

```
Create issue:
Title: Add dark mode support
Type: feature
Priority: medium
Agent: cto
Description: Users want dark mode toggle
```

## Labels

### Status
`status:backlog` `status:ready` `status:in-progress` `status:review` `status:done`

### Priority
`priority:critical` `priority:high` `priority:medium` `priority:low`

### Effort
`effort:xs` `effort:s` `effort:m` `effort:l` `effort:xl`

### Type
`type:feature` `type:bug` `type:refactor` `type:docs` `type:epic`

### Agent
`agent:ceo` `agent:cmo` `agent:cto` `agent:cfo` `agent:coo` `agent:cco` `agent:dao`

## Command

```bash
gh issue create \
  --repo Brunzendorf/SHIBC-AITO \
  --title "${TITLE}" \
  --body "$(cat <<'EOF'
## Summary
${DESCRIPTION}

## Acceptance Criteria
- [ ] ${CRITERION_1}
- [ ] ${CRITERION_2}

---
Created by AITO
EOF
)" \
  --label "status:backlog,priority:${PRIORITY},type:${TYPE},agent:${AGENT}"
```

## Output Format

```json
{
  "success": true,
  "issue_number": 42,
  "url": "https://github.com/Brunzendorf/SHIBC-AITO/issues/42",
  "labels": ["status:backlog", "priority:medium", "type:feature", "agent:cto"]
}
```

## Rules

1. Always add `status:backlog` to new issues
2. Include acceptance criteria
3. Use HEREDOC for body formatting
4. Return the issue URL
