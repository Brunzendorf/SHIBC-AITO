# Tiered Approval System

## Overview

AITO uses a 4-tier approval system to differentiate between routine operations and critical decisions. This prevents bottlenecks where trivial tasks wait for CEO/DAO approval.

## Tiers

| Tier | Examples | Approval Required | Timeout | On Timeout |
|------|----------|-------------------|---------|------------|
| **operational** | File writes, status checks, logs | None | N/A | Auto-execute |
| **minor** | Task delegation, routine campaigns | CEO can veto | 4h | Auto-approve |
| **major** | Budget >$500, partnerships | CEO + DAO | 24h | Escalate to Human |
| **critical** | Smart contracts, token burns | CEO + DAO + Human | 48h | Escalate to Human |

## Decision Flow

### Operational (No Approval)
```
Agent action → Log to history → Broadcast completion → Done
```
- No Decision record created
- Immediately executed
- Only logged for audit trail

### Minor (CEO Veto-Only)
```
Agent proposes → Create Decision → Notify CEO →
  CEO vetos within 4h: Vetoed
  CEO does nothing: Auto-Approved after 4h
```
- CEO doesn't need to explicitly approve
- Only needs to veto if problematic
- Auto-approves on timeout

### Major (CEO + DAO)
```
Agent proposes → Create Decision → Notify HEAD (CEO+DAO) →
  Both vote → Process result
  Timeout → Escalate to Human
```
- Requires explicit votes from both
- Uses existing veto round logic for disagreements
- Human escalation on timeout

### Critical (CEO + DAO + Human)
```
Agent proposes → Create Decision → Notify HEAD →
  Both vote approve → Escalate to Human for confirmation →
  Human confirms → Execute
  Human rejects → Rejected
```
- Even after CEO+DAO approve, human must confirm
- Always escalates to Telegram/Email/Dashboard
- No auto-approval ever

## Type Definitions

```typescript
export type DecisionType = 'operational' | 'minor' | 'major' | 'critical';

export interface ApprovalRequirements {
  ceoRequired: boolean;
  daoRequired: boolean;
  humanRequired: boolean;
  timeoutMs: number;
  autoApproveOnTimeout: boolean;
}

export const APPROVAL_REQUIREMENTS: Record<DecisionType, ApprovalRequirements> = {
  operational: {
    ceoRequired: false,
    daoRequired: false,
    humanRequired: false,
    timeoutMs: 0,
    autoApproveOnTimeout: true,
  },
  minor: {
    ceoRequired: true,
    daoRequired: false,
    humanRequired: false,
    timeoutMs: 4 * 60 * 60 * 1000, // 4 hours
    autoApproveOnTimeout: true,
  },
  major: {
    ceoRequired: true,
    daoRequired: true,
    humanRequired: false,
    timeoutMs: 24 * 60 * 60 * 1000, // 24 hours
    autoApproveOnTimeout: false,
  },
  critical: {
    ceoRequired: true,
    daoRequired: true,
    humanRequired: true,
    timeoutMs: 48 * 60 * 60 * 1000, // 48 hours
    autoApproveOnTimeout: false,
  },
};
```

## Agent Guidelines

### When to use each tier:

**Operational:**
- Writing status reports
- Creating logs
- Internal file operations
- Routine monitoring

**Minor:**
- Delegating tasks to other agents
- Starting routine campaigns
- Configuration changes
- A/B tests

**Major:**
- Budget allocations >$500
- New strategic initiatives
- Partnership proposals
- Tokenomics changes

**Critical:**
- Smart contract deployments
- Token burns
- Exchange listings
- Legal commitments

## Escalation Channels

When human intervention is needed:

```typescript
export type EscalationChannel = 'telegram' | 'email' | 'dashboard';

// All channels are notified for critical decisions
channelsNotified: ['telegram', 'email', 'dashboard']
```

## Database Schema

```sql
-- Decisions table includes tier info
CREATE TABLE decisions (
  id UUID PRIMARY KEY,
  title VARCHAR(255),
  description TEXT,
  proposed_by UUID REFERENCES agents(id),
  decision_type VARCHAR(20), -- 'operational' | 'minor' | 'major' | 'critical'
  status VARCHAR(20),
  veto_round INTEGER DEFAULT 0,
  ceo_vote VARCHAR(20),
  dao_vote VARCHAR(20),
  human_decision VARCHAR(20),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Escalations track human notifications
CREATE TABLE escalations (
  id UUID PRIMARY KEY,
  decision_id UUID REFERENCES decisions(id),
  reason TEXT,
  channels_notified JSONB,
  human_response TEXT,
  responded_at TIMESTAMP,
  status VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Files Modified

| File | Changes |
|------|---------|
| `src/lib/types.ts` | Added `DecisionType`, `ApprovalRequirements`, `APPROVAL_REQUIREMENTS` |
| `src/orchestrator/events.ts` | Tiered decision handling |
| `src/agents/daemon.ts` | Proper `propose_decision` action |
| `profiles/*.md` | Tier guidance for each agent |
