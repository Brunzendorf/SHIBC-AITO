# Scrumban Workflow Design

## Prinzip: Worker-First

Alles was mit GitHub Issues passiert, läuft über **Worker mit `gh` CLI** - nicht programmatisch.
Agents entscheiden selbst via Claude was zu tun ist und spawnen entsprechende Worker.

---

## Issue Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SCRUMBAN BOARD                                   │
├──────────────┬──────────────┬──────────────┬──────────────┬─────────────┤
│   BACKLOG    │    READY     │ IN-PROGRESS  │    REVIEW    │    DONE     │
│              │              │              │              │             │
│ Neue Issues  │ Priorisiert  │ In Arbeit    │ Braucht      │ Erledigt    │
│ warten auf   │ von CEO,     │ von Agent    │ Approval     │             │
│ Triage       │ bereit zum   │ bearbeitet   │              │             │
│              │ Picken       │              │              │             │
└──────────────┴──────────────┴──────────────┴──────────────┴─────────────┘
```

---

## Status Labels

| Label | Bedeutung | Wer setzt es |
|-------|-----------|--------------|
| `status:backlog` | Neu, nicht priorisiert | Auto bei Creation |
| `status:ready` | Priorisiert, bereit zum Picken | CEO/Backlog Groomer |
| `status:in-progress` | Agent arbeitet dran | Agent der es pickt |
| `status:review` | Braucht Review/Approval | Agent wenn fertig |
| `status:done` | Komplett erledigt | Nach Review |
| `status:blocked` | Blockiert durch Dependency | Agent |

---

## Worker-Based Actions

### 1. Issue Triage (CEO/Backlog Groomer)

**Trigger:** Backlog Groomer sendet Prioritization-Request an CEO

**CEO Action:**
```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Triage GitHub issues: Set priority labels and move to ready. Use gh CLI:\n1. gh issue list --label 'status:backlog' --json number,title,labels\n2. For high priority: gh issue edit NUMBER --add-label 'priority:high,status:ready' --remove-label 'status:backlog'\n3. For medium: gh issue edit NUMBER --add-label 'priority:medium,status:ready' --remove-label 'status:backlog'\n4. Add comment explaining priority decision",
    "servers": ["fetch"],
    "timeout": 120000
  }]
}
```

### 2. Pick Issue (Any Agent)

**Trigger:** Agent Loop sieht ready Issues mit eigenem `agent:xxx` Label

**Agent Action:**
```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Pick issue #NUMBER for work:\n1. gh issue edit NUMBER --add-label 'status:in-progress' --remove-label 'status:ready'\n2. gh issue comment NUMBER --body 'Picked by AGENT_TYPE - starting work'\n3. Return issue details for context",
    "servers": ["fetch"],
    "timeout": 60000
  }]
}
```

### 3. Update Progress (Agent während Arbeit)

**Agent Action:**
```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Update progress on issue #NUMBER:\ngh issue comment NUMBER --body 'Progress update: [STATUS]\n\nCompleted:\n- Item 1\n- Item 2\n\nNext steps:\n- Item 3'",
    "servers": ["fetch"],
    "timeout": 30000
  }]
}
```

### 4. Complete Issue (Agent wenn fertig)

**Agent Action:**
```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Mark issue #NUMBER as ready for review:\n1. gh issue edit NUMBER --add-label 'status:review' --remove-label 'status:in-progress'\n2. gh issue comment NUMBER --body 'Work completed by AGENT_TYPE.\n\nSummary:\n[WHAT_WAS_DONE]\n\nDeliverables:\n- [LINKS_OR_DESCRIPTIONS]\n\nReady for review.'",
    "servers": ["fetch"],
    "timeout": 60000
  }]
}
```

### 5. Review & Close (CEO or Reviewer)

**CEO Action:**
```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Review and close issue #NUMBER:\n1. Check deliverables mentioned in comments\n2. gh issue edit NUMBER --add-label 'status:done' --remove-label 'status:review'\n3. gh issue close NUMBER --comment 'Approved and closed. Good work!'\n4. Or if needs changes: gh issue comment NUMBER --body 'Changes needed: [FEEDBACK]' and move back to in-progress",
    "servers": ["fetch"],
    "timeout": 60000
  }]
}
```

---

## Agent Loop Integration

### Loop Prompt Erweiterung

Jeder Agent bekommt in seinem Loop-Prompt:

```markdown
## YOUR KANBAN TASKS

### In Progress (YOU ARE WORKING ON THESE)
{issues with status:in-progress AND agent:{type}}

### Ready to Pick (PICK ONE IF NOTHING IN PROGRESS)
{issues with status:ready AND agent:{type}}

### Waiting for Review (CHECK IF YOU CAN HELP)
{issues with status:review}

### ACTION REQUIRED:
1. If you have in-progress issues: Continue work or mark complete
2. If no in-progress: Pick a ready issue assigned to you
3. Update progress on any issue you touch
```

### Context aus Redis

Der Backlog Groomer speichert in `context:backlog`:
- Issues by Status
- Issues by Agent
- High Priority Items

Agents lesen diesen Context im Loop.

---

## Automatische Issue-Zuweisung

### Option A: Label-based (Empfohlen)

Issues werden mit `agent:cmo`, `agent:cto` etc. gelabelt.
Agents sehen nur ihre Issues im Loop-Prompt.

**Wer setzt Agent-Labels?**
- CEO bei Triage
- Issue Creator (wenn Agent selbst Issue erstellt)
- Backlog Groomer basierend auf Issue-Inhalt (via Worker)

### Option B: Claim-based

Agents können Issues claimen die noch keinen Agent haben:
```json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Claim issue #NUMBER for CMO:\ngh issue edit NUMBER --add-label 'agent:cmo'",
    "servers": ["fetch"]
  }]
}
```

---

## Neue Claude Agents (.claude/agents/)

### issue-manager.md

```markdown
---
name: issue-manager
description: Manages GitHub issue lifecycle - triage, status updates, assignments
tools: Bash, Read
---

# Issue Manager Agent

You manage GitHub issues for the AITO Scrumban board.

## Available Commands

### Triage Issues
```bash
# List backlog issues
gh issue list --repo Brunzendorf/SHIBC-AITO --label "status:backlog" --json number,title,labels,body

# Set priority and move to ready
gh issue edit NUMBER --repo Brunzendorf/SHIBC-AITO \
  --add-label "priority:high,status:ready,agent:cmo" \
  --remove-label "status:backlog"
```

### Pick Issue
```bash
gh issue edit NUMBER --repo Brunzendorf/SHIBC-AITO \
  --add-label "status:in-progress" \
  --remove-label "status:ready"
gh issue comment NUMBER --repo Brunzendorf/SHIBC-AITO \
  --body "Picked by [AGENT] - starting work"
```

### Complete Issue
```bash
gh issue edit NUMBER --repo Brunzendorf/SHIBC-AITO \
  --add-label "status:review" \
  --remove-label "status:in-progress"
gh issue comment NUMBER --repo Brunzendorf/SHIBC-AITO \
  --body "Work completed. Summary: [DETAILS]"
```

### Close Issue
```bash
gh issue close NUMBER --repo Brunzendorf/SHIBC-AITO \
  --comment "Approved and closed."
gh issue edit NUMBER --repo Brunzendorf/SHIBC-AITO \
  --add-label "status:done" \
  --remove-label "status:review"
```

## Environment
- GITHUB_TOKEN is set
- Repo: Brunzendorf/SHIBC-AITO
```

---

## Implementation Steps

### Phase 1: Issue Manager Agent (Heute)
1. Create `.claude/agents/issue-manager.md`
2. Test mit manuellem spawn_worker

### Phase 2: Loop Integration (Morgen)
1. Backlog Context in Loop-Prompt einbauen
2. Agent sieht seine assigned Issues
3. Agent entscheidet selbst was zu tun

### Phase 3: Automatisierung
1. Backlog Groomer assigned Issues automatisch basierend auf Keywords
2. CEO Triage als regelmäßiger Task
3. Status-Tracking im Dashboard

---

## Dashboard Integration

Das Dashboard zeigt:
- Kanban Board mit allen Status-Spalten
- Drag & Drop (via Worker im Hintergrund)
- Agent-Filter
- Priority-Filter

API Endpoints:
- `GET /backlog/issues` - Alle Issues mit Status
- `POST /backlog/refresh` - Manueller Refresh
- `GET /backlog/stats` - Statistiken

---

## Beispiel: CMO bearbeitet Marketing-Issue

**1. CEO Triage:**
```
CEO sieht: "Issue #42: Create Q4 social media campaign"
CEO spawnt Worker: "Set priority:high, agent:cmo, status:ready on #42"
```

**2. CMO Loop:**
```
CMO Loop-Prompt enthält:
"Ready to pick: #42 - Create Q4 social media campaign [priority:high]"

CMO entscheidet: "Ich picke #42"
CMO spawnt Worker: "Pick issue #42, set in-progress"
```

**3. CMO arbeitet:**
```
CMO erstellt Content, speichert in Workspace
CMO spawnt Worker: "Comment on #42: Draft created in workspace/content/"
```

**4. CMO fertig:**
```
CMO spawnt Worker: "Mark #42 as review, comment with summary"
```

**5. CEO Review:**
```
CEO sieht: "Review needed: #42"
CEO prüft, spawnt Worker: "Close #42 with approval"
```

---

## Vorteile dieses Designs

1. **Keine neuen Action-Types** - Alles via spawn_worker
2. **Flexibel** - Agents entscheiden selbst
3. **Transparent** - Alle Changes als GitHub Comments
4. **Auditierbar** - Git History zeigt wer was wann
5. **Worker-basiert** - Claude Code CLI macht die Arbeit
