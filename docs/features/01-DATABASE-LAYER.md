# Database Layer - Detaillierte Feature-Dokumentation

> **Modul:** `src/lib/db.ts`
> **Schema:** `docker/init-db.sql`
> **Status:** ✅ 95% Production-Ready
> **Letzte Überprüfung:** 2025-12-20

---

## Übersicht

Der Database Layer ist das Rückgrat des AITO-Systems. Er verwaltet alle persistenten Daten über PostgreSQL 15 mit pgvector-Erweiterung für Vektor-Suche.

### Technologie-Stack
- **PostgreSQL 15** mit Extensions:
  - `uuid-ossp` - UUID-Generierung
  - `pgcrypto` - Verschlüsselung
  - `vector` - pgvector für RAG
  - `pg_trgm` - Fuzzy-Suche
- **Node-Postgres (pg)** - Connection Pool
- **Parameterized Queries** - SQL-Injection-sicher

### Connection Pool
```typescript
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  max: 20,                    // Max connections
  idleTimeoutMillis: 30000,   // 30s idle timeout
  connectionTimeoutMillis: 2000
});
```

---

## 1. Agent Repository

### Zweck
Verwaltet Agent-Definitionen (CEO, CMO, CTO, etc.) - wer existiert, welchen Status hat er, wann war letzter Heartbeat.

### Tabelle: `agents`
```sql
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL UNIQUE,  -- ceo, cmo, cto, cfo, coo, cco, dao
    name VARCHAR(100) NOT NULL,
    profile_path VARCHAR(255),
    loop_interval INTEGER DEFAULT 3600,
    git_repo VARCHAR(255),
    git_filter VARCHAR(255),
    status VARCHAR(20) DEFAULT 'inactive',  -- inactive, starting, active, stopping, error
    container_id VARCHAR(100),
    last_heartbeat TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Funktionen

#### `agentRepo.findAll()`
Gibt alle registrierten Agenten zurück.

**Signatur:**
```typescript
async findAll(): Promise<Agent[]>
```

**Rückgabe:**
```typescript
interface Agent {
  id: string;           // UUID
  type: AgentType;      // 'ceo' | 'cmo' | 'cto' | 'cfo' | 'coo' | 'cco' | 'dao'
  name: string;
  profilePath: string | null;
  loopInterval: number; // Sekunden
  gitRepo: string | null;
  gitFilter: string | null;
  status: 'inactive' | 'starting' | 'active' | 'stopping' | 'error';
  containerId: string | null;
  lastHeartbeat: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

**Beispiel:**
```typescript
const agents = await agentRepo.findAll();
// [
//   { id: 'abc-123', type: 'ceo', name: 'CEO Agent', status: 'active', ... },
//   { id: 'def-456', type: 'cmo', name: 'CMO Agent', status: 'inactive', ... },
//   ...
// ]
```

**Status:** ✅ Vollständig implementiert

---

#### `agentRepo.findById(id)`
Findet einen Agent anhand seiner UUID.

**Signatur:**
```typescript
async findById(id: string): Promise<Agent | null>
```

**Parameter:**
| Name | Typ | Beschreibung |
|------|-----|--------------|
| `id` | `string` | UUID des Agenten |

**Rückgabe:** Agent-Objekt oder `null` wenn nicht gefunden

**Beispiel:**
```typescript
const agent = await agentRepo.findById('abc-123-def-456');
if (agent) {
  console.log(`Found: ${agent.name}, Status: ${agent.status}`);
}
```

**Status:** ✅ Vollständig implementiert

---

#### `agentRepo.findByType(type)`
Findet einen Agent anhand seines Typs. Da Typen unique sind, gibt es maximal einen Treffer.

**Signatur:**
```typescript
async findByType(type: AgentType): Promise<Agent | null>
```

**Parameter:**
| Name | Typ | Beschreibung |
|------|-----|--------------|
| `type` | `AgentType` | 'ceo', 'cmo', 'cto', 'cfo', 'coo', 'cco', oder 'dao' |

**Beispiel:**
```typescript
const ceo = await agentRepo.findByType('ceo');
if (ceo) {
  console.log(`CEO ID: ${ceo.id}, Last Heartbeat: ${ceo.lastHeartbeat}`);
}
```

**Verwendung im System:**
- `daemon.ts:138` - Agent-ID aus DB laden bei Startup
- `orchestrator/api.ts` - Agent-Details für API-Response

**Status:** ✅ Vollständig implementiert

---

#### `agentRepo.create(agent)`
Erstellt einen neuen Agent-Eintrag in der Datenbank.

**Signatur:**
```typescript
async create(agent: Partial<Agent>): Promise<Agent>
```

**Parameter:**
| Feld | Typ | Required | Beschreibung |
|------|-----|----------|--------------|
| `type` | `AgentType` | ✅ | Agent-Typ (unique) |
| `name` | `string` | ✅ | Anzeigename |
| `profilePath` | `string` | ❌ | Pfad zur Profil-Datei |
| `loopInterval` | `number` | ❌ | Loop-Interval in Sekunden (default: 3600) |
| `gitRepo` | `string` | ❌ | Git-Repository |
| `gitFilter` | `string` | ❌ | Git-Pfad-Filter |

**Beispiel:**
```typescript
const newAgent = await agentRepo.create({
  type: 'cmo',
  name: 'CMO Agent',
  profilePath: '/profiles/cmo.md',
  loopInterval: 7200
});
```

**Hinweis:** Normalerweise werden Agenten über `init-db.sql` Seed-Data erstellt, nicht zur Laufzeit.

**Status:** ✅ Vollständig implementiert

---

#### `agentRepo.updateStatus(id, status)`
Aktualisiert den Status eines Agenten.

**Signatur:**
```typescript
async updateStatus(id: string, status: AgentStatus): Promise<void>
```

**Parameter:**
| Name | Typ | Beschreibung |
|------|-----|--------------|
| `id` | `string` | Agent-UUID |
| `status` | `AgentStatus` | 'inactive', 'starting', 'active', 'stopping', 'error' |

**Status-Übergänge:**
```
inactive → starting → active → stopping → inactive
                ↓                    ↓
              error              error
```

**Beispiel:**
```typescript
await agentRepo.updateStatus(agent.id, 'active');
```

**Verwendung:**
- `daemon.ts:1700` - Status bei Start/Stop aktualisieren
- `orchestrator/container.ts` - Container-Lifecycle

**Status:** ✅ Vollständig implementiert

---

#### `agentRepo.updateHeartbeat(id)`
Aktualisiert den Heartbeat-Timestamp eines Agenten.

**Signatur:**
```typescript
async updateHeartbeat(id: string): Promise<void>
```

**Verwendung:**
- Health-Monitoring prüft `last_heartbeat`
- Agents mit Heartbeat > 5min gelten als unresponsive

**Beispiel:**
```typescript
// Im Agent-Loop
await agentRepo.updateHeartbeat(this.config.agentId);
```

**Status:** ✅ Vollständig implementiert

---

## 2. State Repository

### Zweck
Persistente Key-Value-Speicherung für Agent-State. Jeder Agent hat seinen eigenen Namespace.

### Tabelle: `agent_state`
```sql
CREATE TABLE agent_state (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    state_key VARCHAR(255) NOT NULL,
    state_value JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(agent_id, state_key)
);
```

### Volatile State Handling

**Kritisches Feature:** Bestimmte State-Keys haben eine TTL von 1 Stunde, um Halluzinationen zu verhindern.

**Volatile Key-Patterns:**
```typescript
const VOLATILE_PATTERNS = [
  'market_',      // market_price, market_cap, etc.
  'price_',       // price_shibc, price_etc
  'treasury_',    // treasury_balance, treasury_eth
  'holder_',      // holder_count
  'telegram_',    // telegram_members
  'fear_greed_',  // fear_greed_index
  'last_shibc_',  // last_shibc_price
];
```

**Warum?** Ohne TTL würden Agenten auf veraltete Marktdaten vertrauen und falsche Entscheidungen treffen.

### Funktionen

#### `stateRepo.get<T>(agentId, key)`
Holt einen State-Wert typsicher.

**Signatur:**
```typescript
async get<T>(agentId: string, key: string): Promise<T | null>
```

**Beispiel:**
```typescript
const loopCount = await stateRepo.get<number>(agentId, 'LOOP_COUNT');
const focus = await stateRepo.get<string>(agentId, 'CURRENT_FOCUS');
const pendingTasks = await stateRepo.get<Task[]>(agentId, 'PENDING_TASKS');
```

**Status:** ✅ Vollständig implementiert

---

#### `stateRepo.set(agentId, key, value)`
Speichert einen State-Wert. UPSERT-Logik (Insert oder Update).

**Signatur:**
```typescript
async set(agentId: string, key: string, value: unknown): Promise<void>
```

**Beispiel:**
```typescript
await stateRepo.set(agentId, 'LOOP_COUNT', 42);
await stateRepo.set(agentId, 'CURRENT_FOCUS', 'marketing');
await stateRepo.set(agentId, 'last_decision', {
  id: 'dec-123',
  title: 'Launch Campaign',
  status: 'approved'
});
```

**SQL:**
```sql
INSERT INTO agent_state (agent_id, state_key, state_value)
VALUES ($1, $2, $3)
ON CONFLICT (agent_id, state_key)
DO UPDATE SET state_value = $3, updated_at = NOW()
```

**Status:** ✅ Vollständig implementiert

---

#### `stateRepo.getAll(agentId)`
Holt alle State-Werte eines Agenten. **Inklusive TTL-Enforcement!**

**Signatur:**
```typescript
async getAll(agentId: string): Promise<Record<string, unknown>>
```

**TTL-Logik (Zeilen 205-225):**
```typescript
const result: Record<string, unknown> = {};
const now = Date.now();

for (const row of rows) {
  // Check if key is volatile
  if (VOLATILE_PATTERNS.some(p => row.state_key.startsWith(p))) {
    const age = now - new Date(row.updated_at).getTime();
    if (age > 3600000) { // > 1 hour
      // Don't include stale volatile data
      continue;
    }
  }
  result[row.state_key] = row.state_value;
}
```

**Beispiel:**
```typescript
const allState = await stateRepo.getAll(agentId);
// {
//   LOOP_COUNT: 42,
//   CURRENT_FOCUS: 'marketing',
//   last_shibc_price: 0.00001234,  // Nur wenn < 1h alt
//   ...
// }
```

**Status:** ✅ Vollständig implementiert

---

#### `stateRepo.delete(agentId, key)`
Löscht einen einzelnen State-Key.

**Signatur:**
```typescript
async delete(agentId: string, key: string): Promise<void>
```

**Status:** ✅ Vollständig implementiert

---

#### `stateRepo.deleteStale(agentId)`
Löscht alle veralteten volatile State-Keys (> 1h alt).

**Signatur:**
```typescript
async deleteStale(agentId: string): Promise<number>
```

**Rückgabe:** Anzahl gelöschter Keys

**Verwendung:**
- Wird periodisch vom Archive-Worker aufgerufen
- Verhindert Datenbank-Bloat

**Status:** ✅ Vollständig implementiert

---

## 3. History Repository

### Zweck
Speichert Agent-Aktionen für RAG (Retrieval-Augmented Generation). Jede Aktion wird mit Embedding indexiert.

### Tabelle: `agent_history`
```sql
CREATE TABLE agent_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL,  -- decision, task, communication, error, idea
    summary TEXT NOT NULL,
    details JSONB,
    embedding VECTOR(1536),  -- OpenAI-kompatible Dimension
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agent_history_embedding
  ON agent_history USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

### Funktionen

#### `historyRepo.add(entry)`
Fügt einen neuen History-Eintrag hinzu.

**Signatur:**
```typescript
async add(entry: {
  agentId: string;
  actionType: 'decision' | 'task' | 'communication' | 'error' | 'idea';
  summary: string;
  details?: unknown;
}): Promise<void>
```

**Beispiel:**
```typescript
await historyRepo.add({
  agentId: agent.id,
  actionType: 'decision',
  summary: 'Approved marketing campaign for Q1',
  details: {
    campaignId: 'camp-123',
    budget: 5000,
    channels: ['twitter', 'telegram']
  }
});
```

**Hinweis:** Embedding wird async vom RAG-System generiert.

**Status:** ✅ Vollständig implementiert

---

#### `historyRepo.getRecent(agentId, limit)`
Holt die letzten N History-Einträge.

**Signatur:**
```typescript
async getRecent(agentId: string, limit: number = 50): Promise<HistoryEntry[]>
```

**Rückgabe:**
```typescript
interface HistoryEntry {
  id: string;
  agentId: string;
  actionType: string;
  summary: string;
  details: unknown;
  createdAt: Date;
}
```

**Status:** ✅ Vollständig implementiert

---

#### `historyRepo.search(agentId, embedding)`
Semantische Suche über History-Einträge.

**Signatur:**
```typescript
async search(agentId: string, embedding: number[], limit: number = 5): Promise<HistoryEntry[]>
```

**SQL:**
```sql
SELECT *, embedding <=> $2 AS distance
FROM agent_history
WHERE agent_id = $1
ORDER BY distance
LIMIT $3
```

**Verwendung:**
- RAG-System für Kontext-Retrieval
- Agent bekommt relevante vergangene Entscheidungen

**Status:** ✅ Vollständig implementiert

---

## 4. Decision Repository

### Zweck
Verwaltet das Entscheidungs- und Veto-System. Jede wichtige Entscheidung durchläuft einen strukturierten Approval-Prozess.

### Tabelle: `decisions`
```sql
CREATE TABLE decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    proposed_by UUID REFERENCES agents(id),
    decision_type VARCHAR(50) DEFAULT 'major',  -- operational, minor, major, critical
    status VARCHAR(20) DEFAULT 'pending',  -- pending, approved, rejected, vetoed, escalated
    veto_round INTEGER DEFAULT 0,
    ceo_vote VARCHAR(20),      -- approve, veto, abstain
    dao_vote VARCHAR(20),
    c_level_votes JSONB,       -- {"cmo": "approve", "cto": "veto", ...}
    human_decision VARCHAR(20),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Decision Tiers

| Tier | Beschreibung | Approval-Requirement | Timeout |
|------|--------------|---------------------|---------|
| `operational` | Routine-Tasks | Sofort (kein Approval) | - |
| `minor` | Kleine Änderungen | Auto-approve nach 4h | 4h |
| `major` | Wichtige Entscheidungen | CEO + DAO | 24h |
| `critical` | Strategische Entscheidungen | CEO + DAO + C-Level Majority | 48h |

### Funktionen

#### `decisionRepo.create(decision)`
Erstellt eine neue Decision.

**Signatur:**
```typescript
async create(decision: {
  title: string;
  description?: string;
  proposedBy: string;  // Agent-ID
  decisionType: 'operational' | 'minor' | 'major' | 'critical';
}): Promise<Decision>
```

**Beispiel:**
```typescript
const decision = await decisionRepo.create({
  title: 'Partner with Influencer XYZ',
  description: 'Proposal to partner with crypto influencer for $500',
  proposedBy: cmoAgent.id,
  decisionType: 'major'
});
```

**Status:** ✅ Vollständig implementiert

---

#### `decisionRepo.findPending()`
Findet alle ausstehenden Decisions.

**Signatur:**
```typescript
async findPending(): Promise<Decision[]>
```

**Verwendung:**
- CEO/DAO-Loop holt pending decisions
- Dashboard zeigt Voting-Queue

**Status:** ✅ Vollständig implementiert

---

#### `decisionRepo.updateVote(id, voterType, vote, reason?)`
Registriert eine Abstimmung.

**Signatur:**
```typescript
async updateVote(
  id: string,
  voterType: 'ceo' | 'dao',
  vote: 'approve' | 'veto' | 'abstain',
  reason?: string
): Promise<void>
```

**Beispiel:**
```typescript
await decisionRepo.updateVote(decision.id, 'ceo', 'approve', 'Good ROI expected');
await decisionRepo.updateVote(decision.id, 'dao', 'veto', 'Budget too high');
```

**Status:** ✅ Vollständig implementiert

---

#### `decisionRepo.updateCLevelVotes(id, votes)`
Speichert C-Level-Abstimmungen (bei major/critical).

**Signatur:**
```typescript
async updateCLevelVotes(id: string, votes: Record<string, string>): Promise<void>
```

**Beispiel:**
```typescript
await decisionRepo.updateCLevelVotes(decision.id, {
  cmo: 'approve',
  cto: 'approve',
  cfo: 'veto',
  coo: 'abstain',
  cco: 'approve'
});
```

**Status:** ✅ Vollständig implementiert

---

#### `decisionRepo.updateStatus(id, status)`
Ändert den Decision-Status.

**Signatur:**
```typescript
async updateStatus(
  id: string,
  status: 'pending' | 'approved' | 'rejected' | 'vetoed' | 'escalated'
): Promise<void>
```

**Status-Übergänge:**
```
pending → approved (beide approve)
pending → vetoed (mind. einer veto)
pending → escalated (timeout oder Patt)
vetoed → pending (neue Veto-Runde)
escalated → approved/rejected (human decision)
```

**Status:** ✅ Vollständig implementiert

---

#### `decisionRepo.incrementVetoRound(id)`
Erhöht den Veto-Runden-Zähler.

**Signatur:**
```typescript
async incrementVetoRound(id: string): Promise<number>
```

**Rückgabe:** Neue Runden-Nummer

**Logik:**
- Nach 3 Veto-Runden → Eskalation zu Human

**Status:** ✅ Vollständig implementiert

---

#### `decisionRepo.setHumanDecision(id, decision)`
Speichert die manuelle Entscheidung eines Menschen.

**Signatur:**
```typescript
async setHumanDecision(id: string, decision: 'approve' | 'reject'): Promise<void>
```

**Verwendung:**
- Dashboard-Voting
- Telegram-Bot-Voting

**Status:** ✅ Vollständig implementiert

---

## 5. Settings Repository

### Zweck
Zentrale Konfigurationsverwaltung. Alle Runtime-Settings werden in der Datenbank gespeichert, nicht in ENV.

### Tabelle: `system_settings`
```sql
CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(50) NOT NULL,
    setting_key VARCHAR(100) NOT NULL,
    setting_value JSONB NOT NULL,
    description TEXT,
    is_secret BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(category, setting_key)
);
```

### Kategorien

| Kategorie | Beschreibung |
|-----------|--------------|
| `queue` | Priority-basierte Task-Delays |
| `agents` | Loop-Intervale pro Agent |
| `llm` | LLM-Routing-Strategie |
| `decisions` | Decision-Timeouts |
| `escalation` | Eskalations-Timeouts |
| `tasks` | Task-Limits |
| `workspace` | Git/PR-Workflow |
| `feedback` | Feedback-Routing |
| `initiative` | Initiative-Cooldowns |

### Funktionen

#### `settingsRepo.get(category, key)`
Holt eine einzelne Setting.

**Signatur:**
```typescript
async get(category: string, key: string): Promise<SystemSetting | null>
```

**Rückgabe:**
```typescript
interface SystemSetting {
  id: string;
  category: string;
  settingKey: string;
  settingValue: unknown;
  description: string | null;
  isSecret: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

**Status:** ✅ Vollständig implementiert

---

#### `settingsRepo.getValue<T>(category, key, defaultValue)`
Holt den Wert einer Setting typsicher mit Default.

**Signatur:**
```typescript
async getValue<T>(category: string, key: string, defaultValue: T): Promise<T>
```

**Beispiel:**
```typescript
const maxTasks = await settingsRepo.getValue<number>('tasks', 'max_concurrent_per_agent', 2);
const routingStrategy = await settingsRepo.getValue<string>('llm', 'routing_strategy', 'claude-only');
```

**Status:** ✅ Vollständig implementiert

---

#### `settingsRepo.set(category, key, value, description?)`
Speichert eine Setting (UPSERT).

**Signatur:**
```typescript
async set(
  category: string,
  key: string,
  value: unknown,
  description?: string
): Promise<void>
```

**Beispiel:**
```typescript
await settingsRepo.set('queue', 'delay_critical', 0, 'Immediate processing');
await settingsRepo.set('agents', 'loop_interval_ceo', 1800, 'CEO loops every 30 minutes');
```

**Status:** ✅ Vollständig implementiert

---

#### Convenience Methods

Diese Methoden aggregieren mehrere Settings in einem Aufruf:

##### `settingsRepo.getQueueDelays()`
```typescript
async getQueueDelays(): Promise<{
  critical: number;    // Default: 0
  urgent: number;      // Default: 5000
  high: number;        // Default: 30000
  normal: number;      // Default: 120000
  low: number;         // Default: 300000
  operational: number; // Default: 600000
}>
```

##### `settingsRepo.getAgentLoopIntervals()`
```typescript
async getAgentLoopIntervals(): Promise<{
  ceo: number;  // Default: 1800
  dao: number;  // Default: 14400
  cmo: number;  // Default: 7200
  cto: number;  // Default: 3600
  cfo: number;  // Default: 14400
  coo: number;  // Default: 3600
  cco: number;  // Default: 43200
}>
```

##### `settingsRepo.getLLMSettings()`
```typescript
async getLLMSettings(): Promise<{
  routingStrategy: string;  // 'claude-only' | 'task-type' | 'gemini-prefer'
  enableFallback: boolean;
  preferGemini: boolean;
  geminiDefaultModel: string;
}>
```

##### `settingsRepo.getDecisionTimeouts()`
```typescript
async getDecisionTimeouts(): Promise<{
  minor: number;     // Default: 14400000 (4h)
  major: number;     // Default: 86400000 (24h)
  critical: number;  // Default: 172800000 (48h)
}>
```

##### `settingsRepo.getTaskSettings()`
```typescript
async getTaskSettings(): Promise<{
  maxConcurrentPerAgent: number;  // Default: 2
}>
```

##### `settingsRepo.getWorkspaceSettings()`
```typescript
async getWorkspaceSettings(): Promise<{
  autoCommit: boolean;  // Default: true
  usePR: boolean;       // Default: true
  autoMerge: boolean;   // Default: false
  skipPR: boolean;      // Default: false
}>
```

##### `settingsRepo.getFeedbackSettings()`
```typescript
async getFeedbackSettings(): Promise<{
  operationalNotifyCeo: boolean;   // Default: true
  broadcastDecisions: boolean;     // Default: true
  targetedFeedback: boolean;       // Default: true
}>
```

##### `settingsRepo.getInitiativeSettings()`
```typescript
async getInitiativeSettings(): Promise<{
  cooldownHours: number;     // Default: 4
  maxPerDay: number;         // Default: 3
  onlyOnScheduled: boolean;  // Default: true
}>
```

**Status:** ✅ Alle Convenience Methods implementiert

---

## 6. Domain Whitelist Repository

### Zweck
Sicherheits-Feature: Nur whitelistete Domains dürfen von Workers aufgerufen werden.

### Tabelle: `domain_whitelist`
```sql
CREATE TABLE domain_whitelist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain VARCHAR(255) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    added_by VARCHAR(50) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Kategorien

| Kategorie | Beispiele |
|-----------|-----------|
| `crypto_data` | coingecko.com, coinmarketcap.com |
| `blockchain` | etherscan.io, blockscout.com |
| `news` | cointelegraph.com, coindesk.com |
| `social` | twitter.com, telegram.org |
| `development` | github.com |
| `internal` | shibaclassic.io |
| `audit` | certik.com, hacken.io |

### Funktionen

#### `domainWhitelistRepo.isDomainWhitelisted(domain)`
Prüft ob eine Domain erlaubt ist.

**Signatur:**
```typescript
async isDomainWhitelisted(domain: string): Promise<boolean>
```

**Logik:**
1. Exakte Domain-Match prüfen
2. Subdomain-Match prüfen (api.coingecko.com → coingecko.com)
3. Nur aktive Domains (`is_active = true`)

**Beispiel:**
```typescript
const allowed = await domainWhitelistRepo.isDomainWhitelisted('api.coingecko.com');
// true (weil coingecko.com in whitelist)

const blocked = await domainWhitelistRepo.isDomainWhitelisted('evil.com');
// false
```

**Status:** ✅ Vollständig implementiert

---

#### `domainWhitelistRepo.add(domain, category, description)`
Fügt eine neue Domain hinzu.

**Signatur:**
```typescript
async add(
  domain: string,
  category: string,
  description?: string
): Promise<void>
```

**Status:** ✅ Vollständig implementiert

---

## 7. Benchmark Repository

### Zweck
Speichert LLM-Benchmark-Ergebnisse für Provider-Vergleich.

### Funktionen

#### `benchmarkRepo.create(run)`
Erstellt einen neuen Benchmark-Run.

**Signatur:**
```typescript
async create(run: {
  tasks: string[];
  models: string[];
}): Promise<{ runId: string }>
```

**Status:** ✅ Vollständig implementiert

---

#### `benchmarkRepo.updateResults(runId, results)`
Speichert Benchmark-Ergebnisse.

**Signatur:**
```typescript
async updateResults(runId: string, results: BenchmarkResult[]): Promise<void>
```

**Ergebnis-Struktur:**
```typescript
interface BenchmarkResult {
  model: string;
  task: string;
  duration: number;
  tokens: number;
  cost: number;
  success: boolean;
  output?: string;
  error?: string;
}
```

**Status:** ✅ Vollständig implementiert

---

## Bekannte Probleme

### 1. JSON Parsing nicht geschützt
**Datei:** `src/lib/db.ts:187, 265`
**Problem:** `JSON.stringify()` kann bei zirkulären Referenzen fehlschlagen
**Impact:** Low - kommt selten vor
**Fix:** Try-catch um JSON-Operationen

### 2. Keine Prepared Statements
**Problem:** Jede Query erstellt neue Prepared Statement
**Impact:** Performance bei hohem Load
**Fix:** Prepared Statement Pool verwenden

### 3. Keine Connection Health Checks
**Problem:** Pool prüft nicht aktiv Connection-Health
**Impact:** Veraltete Connections können Fehler verursachen
**Fix:** `pg.Pool` mit `query: 'SELECT 1'` Health-Check

---

## Verwendungsbeispiele

### Agent-Startup
```typescript
// In daemon.ts
const dbAgent = await agentRepo.findByType(this.config.agentType);
if (!dbAgent) throw new Error('Agent not in database');

this.config.agentId = dbAgent.id;
await agentRepo.updateStatus(dbAgent.id, 'active');
await agentRepo.updateHeartbeat(dbAgent.id);
```

### State-Management
```typescript
// Loop-Counter erhöhen
const count = await stateRepo.get<number>(agentId, 'LOOP_COUNT') || 0;
await stateRepo.set(agentId, 'LOOP_COUNT', count + 1);

// Volatile Marktdaten speichern (1h TTL)
await stateRepo.set(agentId, 'last_shibc_price', 0.00001234);
```

### Decision-Flow
```typescript
// C-Level schlägt vor
const decision = await decisionRepo.create({
  title: 'New Partnership',
  proposedBy: cmoId,
  decisionType: 'major'
});

// CEO stimmt ab
await decisionRepo.updateVote(decision.id, 'ceo', 'approve');

// DAO stimmt ab
await decisionRepo.updateVote(decision.id, 'dao', 'approve');

// Status updaten
await decisionRepo.updateStatus(decision.id, 'approved');
```
