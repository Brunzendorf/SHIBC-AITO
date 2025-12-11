# Telegram Bot DAO Voting

## Overview

Integration des Telegram Bots für Community-basiertes Voting bei Major/Critical Decisions.

## Konzept

Anstatt dass der DAO AI-Agent autonom über Decisions entscheidet, wird bei `major` und `critical` Tier Decisions ein Poll in der Telegram Gruppe erstellt.

```
Decision(major/critical) → TG Bot → Poll in Gruppe → Votes sammeln → Result → Orchestrator
```

## Voting Eligibility

Nur Gruppenmitglieder die **länger als 30 Tage** in der Telegram Gruppe sind, dürfen abstimmen.

### Membership Tracking

Da die Telegram Bot API `joined_date` nur für Admins exposed, muss eigenes Tracking implementiert werden:

```typescript
// Bei jedem neuen Member speichern
bot.on('new_chat_members', async (msg) => {
  for (const user of msg.new_chat_members) {
    await db.members.upsert({
      chatId: msg.chat.id,
      oderjusterId: user.id,
      username: user.username,
      joinedAt: new Date(),
    });
  }
});

// Bei Vote prüfen
async function canVote(chatId: number, userId: number): Promise<boolean> {
  const member = await db.members.findOne({ chatId, userId });
  if (!member) return false;

  const daysSinceJoin = (Date.now() - member.joinedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceJoin >= 30;
}
```

## Flow

### 1. Decision kommt rein (major/critical)

Orchestrator erkennt Tier und sendet an TG Bot statt an DAO AI Agent.

### 2. TG Bot erstellt Poll

```
🗳️ **DAO Vote Required**

**Decision:** [Title]
**Proposed by:** [Agent]
**Tier:** Major

[Description...]

Vote ends in 24h or when quorum reached.

✅ Approve | ❌ Veto | 🤷 Abstain
```

### 3. Vote Validation

- Bei jedem Vote: Check ob User >= 30 Tage Member
- Ungültige Votes werden mit DM informiert

### 4. Result

Nach Timeout (24h für major, 48h für critical) oder Quorum:
- Ergebnis wird in Gruppe gepostet
- Result wird an Orchestrator gesendet
- DAO Vote wird mit Community-Result eingetragen

## Quorum Requirements

| Tier | Min. Votes | Approval Threshold |
|------|------------|-------------------|
| major | 5 | Simple Majority (>50%) |
| critical | 10 | Supermajority (>66%) |

## Database Schema

```sql
CREATE TABLE tg_members (
  id SERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  username VARCHAR(255),
  joined_at TIMESTAMP DEFAULT NOW(),
  left_at TIMESTAMP,
  UNIQUE(chat_id, user_id)
);

CREATE TABLE tg_votes (
  id SERIAL PRIMARY KEY,
  decision_id UUID REFERENCES decisions(id),
  poll_message_id BIGINT,
  chat_id BIGINT,
  user_id BIGINT,
  vote VARCHAR(20), -- 'approve', 'veto', 'abstain'
  voted_at TIMESTAMP DEFAULT NOW(),
  valid BOOLEAN DEFAULT true,
  UNIQUE(decision_id, user_id)
);
```

## Environment Variables

```env
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_DAO_CHAT_ID=-100xxx  # Gruppe für DAO Voting
TELEGRAM_ADMIN_CHAT_ID=xxx    # Admin für Escalations
TG_MIN_MEMBERSHIP_DAYS=30
TG_MAJOR_QUORUM=5
TG_CRITICAL_QUORUM=10
```

## Implementation Steps

1. [ ] Member Tracking implementieren
2. [ ] Vote Handler mit Eligibility Check
3. [ ] Poll Creation für Decisions
4. [ ] Result Aggregation und Timeout Handling
5. [ ] Orchestrator Integration (DAO Vote via TG)
6. [ ] Dashboard: Show TG Vote Status

## Related

- [Tiered Approval System](./ARCHITECTURE.md#tiered-approval)
- [DAO Agent Profile](../profiles/dao.md)
