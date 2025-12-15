#!/bin/bash

# Setup Scrumban workflow labels for GitHub Issues
# Run with: GITHUB_TOKEN=xxx ./scripts/setup-workflow-labels.sh

REPO="${GITHUB_REPO:-Brunzendorf/SHIBC-AITO}"

echo "Setting up workflow labels for $REPO..."

# Status labels (workflow stages)
gh label create "status:backlog" --description "In Backlog - needs grooming" --color "666666" --repo "$REPO" 2>/dev/null || \
gh label edit "status:backlog" --description "In Backlog - needs grooming" --color "666666" --repo "$REPO"

gh label create "status:ready" --description "Ready for work - groomed and prioritized" --color "0E8A16" --repo "$REPO" 2>/dev/null || \
gh label edit "status:ready" --description "Ready for work - groomed and prioritized" --color "0E8A16" --repo "$REPO"

gh label create "status:in-progress" --description "In Progress - actively being worked" --color "FFA500" --repo "$REPO" 2>/dev/null || \
gh label edit "status:in-progress" --description "In Progress - actively being worked" --color "FFA500" --repo "$REPO"

gh label create "status:review" --description "In Review - awaiting approval" --color "1D76DB" --repo "$REPO" 2>/dev/null || \
gh label edit "status:review" --description "In Review - awaiting approval" --color "1D76DB" --repo "$REPO"

gh label create "status:done" --description "Done - completed and verified" --color "2ECC71" --repo "$REPO" 2>/dev/null || \
gh label edit "status:done" --description "Done - completed and verified" --color "2ECC71" --repo "$REPO"

gh label create "status:blocked" --description "Blocked - needs external input" --color "D93F0B" --repo "$REPO" 2>/dev/null || \
gh label edit "status:blocked" --description "Blocked - needs external input" --color "D93F0B" --repo "$REPO"

# Priority labels
gh label create "priority:critical" --description "Critical - needs immediate attention" --color "B60205" --repo "$REPO" 2>/dev/null || \
gh label edit "priority:critical" --description "Critical - needs immediate attention" --color "B60205" --repo "$REPO"

gh label create "priority:high" --description "High priority" --color "D93F0B" --repo "$REPO" 2>/dev/null || \
gh label edit "priority:high" --description "High priority" --color "D93F0B" --repo "$REPO"

gh label create "priority:medium" --description "Medium priority" --color "FBCA04" --repo "$REPO" 2>/dev/null || \
gh label edit "priority:medium" --description "Medium priority" --color "FBCA04" --repo "$REPO"

gh label create "priority:low" --description "Low priority" --color "0E8A16" --repo "$REPO" 2>/dev/null || \
gh label edit "priority:low" --description "Low priority" --color "0E8A16" --repo "$REPO"

# Effort labels
gh label create "effort:xs" --description "Extra Small - less than 1 hour" --color "C5DEF5" --repo "$REPO" 2>/dev/null || \
gh label edit "effort:xs" --description "Extra Small - less than 1 hour" --color "C5DEF5" --repo "$REPO"

gh label create "effort:s" --description "Small - 1-4 hours" --color "7DC4E4" --repo "$REPO" 2>/dev/null || \
gh label edit "effort:s" --description "Small - 1-4 hours" --color "7DC4E4" --repo "$REPO"

gh label create "effort:m" --description "Medium - 1-2 days" --color "0969DA" --repo "$REPO" 2>/dev/null || \
gh label edit "effort:m" --description "Medium - 1-2 days" --color "0969DA" --repo "$REPO"

gh label create "effort:l" --description "Large - 3-5 days" --color "1D76DB" --repo "$REPO" 2>/dev/null || \
gh label edit "effort:l" --description "Large - 3-5 days" --color "1D76DB" --repo "$REPO"

gh label create "effort:xl" --description "Extra Large - needs breakdown" --color "0E34A0" --repo "$REPO" 2>/dev/null || \
gh label edit "effort:xl" --description "Extra Large - needs breakdown" --color "0E34A0" --repo "$REPO"

# Type labels (for Grooming categories)
gh label create "type:epic" --description "Epic - parent issue with subtasks" --color "5319E7" --repo "$REPO" 2>/dev/null || \
gh label edit "type:epic" --description "Epic - parent issue with subtasks" --color "5319E7" --repo "$REPO"

gh label create "type:subtask" --description "Subtask - part of an Epic" --color "EDEDED" --repo "$REPO" 2>/dev/null || \
gh label edit "type:subtask" --description "Subtask - part of an Epic" --color "EDEDED" --repo "$REPO"

gh label create "type:duplicate" --description "Duplicate - of another issue" --color "CFD3D7" --repo "$REPO" 2>/dev/null || \
gh label edit "type:duplicate" --description "Duplicate - of another issue" --color "CFD3D7" --repo "$REPO"

# Agent labels (for assignment tracking)
for agent in ceo cmo cto cfo coo cco dao; do
  gh label create "agent:$agent" --description "Assigned to ${agent^^}" --color "F9D0C4" --repo "$REPO" 2>/dev/null || \
  gh label edit "agent:$agent" --description "Assigned to ${agent^^}" --color "F9D0C4" --repo "$REPO"
done

echo "Done! Workflow labels created for $REPO"
