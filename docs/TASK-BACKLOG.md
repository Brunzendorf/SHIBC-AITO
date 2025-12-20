# AITO 3.0 - Task Backlog

> **Generiert:** 2025-12-20
> **Basis:** Vollständiges Code-Review aller Module
> **Referenz:** [FEATURE-REFERENCE.md](./FEATURE-REFERENCE.md)

---

## Legende

| Status | Bedeutung |
|--------|-----------|
| 🔴 KRITISCH | Muss sofort gefixt werden - Blocking |
| 🟠 HOCH | Wichtig für Production-Readiness |
| 🟡 MITTEL | Sollte gemacht werden |
| 🟢 NIEDRIG | Nice-to-have |
| 🐛 BUG | Fehler im Code |
| ⚠️ SECURITY | Sicherheitsproblem |
| 🔧 IMPROVEMENT | Verbesserung |
| ✨ FEATURE | Neue Funktion |

---

## 1. Agent Daemon (`src/agents/daemon.ts`)

### 🔴 KRITISCH

#### TASK-001: Task-Queue Race Condition
**Status:** 🐛 BUG
**Aufwand:** 4h
**Datei:** `src/agents/daemon.ts:566-899`

**Problem:**
```typescript
// Zeile 566: Erste Lesung
const rawTasks = await redis.lrange(taskQueueKey, 0, 9);

// ... loop processing ...

// Zeile 871: Tasks entfernen
await redis.ltrim(taskQueueKey, pendingTasks.length, -1);

// Zeile 899: Zweite Lesung (für continuation check)
const rawTasks = await redis.lrange(taskQueueKey, 0, 9);
```

**Folge:** Zwischen Reads/Trims können neue Tasks ankommen → Tasks übersprungen oder dupliziert

**Fix:**
1. Tasks als Snapshot speichern, nur einmal lesen
2. Atomic operations mit Redis MULTI/EXEC
3. Task acknowledgment mit BRPOPLPUSH pattern

---

#### TASK-002: loopInProgress schützt nicht vor Message Overlap
**Status:** 🐛 BUG
**Aufwand:** 3h
**Datei:** `src/agents/daemon.ts:528-530`

**Problem:**
```typescript
if (this.loopInProgress) {
  logger.debug({ trigger }, 'Loop already in progress, skipping');
  return;
}
```

- Verhindert nur geteilten `runLoop()` Start
- `handleMessage()` wird trotzdem ausgeführt während loop läuft
- Parallele RAG-Searches, State-Updates können konflikten

**Fix:**
1. Message-Queue für incoming messages während loop
2. Semaphore für exclusive access
3. Oder: Messages queuen und nach loop-end verarbeiten

---

#### TASK-003: Parser-Output nicht robust ✅ DONE
**Status:** 🐛 BUG → ✅ ERLEDIGT (2025-12-20)
**Aufwand:** 1h

**Problem:** Null-Check fehlte nach parseClaudeOutput()

**Lösung:** Code bereits korrekt implementiert - `if (parsed) { ... }` Check existiert in daemon.ts:701+

---

### 🟠 HOCH

#### TASK-004: Kein Retry-Mechanism für Actions
**Status:** 🔧 IMPROVEMENT
**Aufwand:** 4h
**Datei:** `src/agents/daemon.ts:1085-1694`

**Problem:**
- `processAction()` hat keinen Retry bei Fehlern
- Wenn `spawn_worker` fehlschlägt, wird es nicht wiederholt
- Kein Dead-Letter Queue für failed actions

**Fix:**
1. Retry-Wrapper um `processAction()`
2. Max 3 Retries mit exponential backoff
3. Failed actions in `queue:failed:${agentType}` speichern

---

#### TASK-005: Initiative-Phase nur bei "scheduled" Trigger
**Status:** 🔧 IMPROVEMENT
**Aufwand:** 2h
**Datei:** `src/agents/daemon.ts:926-958`

**Problem:**
```typescript
if (trigger === 'scheduled') {
  // Initiative phase runs
}
```

- C-Level agents verpassen Initiative-Chance bei task reactions
- Nach Task-Bearbeitung sollte auch Initiative möglich sein

**Fix:**
```typescript
// Run initiative if:
// 1. Scheduled loop OR
// 2. Queue empty after task processing AND cooldown passed
if (trigger === 'scheduled' || (trigger !== 'queue_continuation' && await canGenerateInitiative())) {
  await runInitiativePhase();
}
```

---

### 🟡 MITTEL

#### TASK-006: Performance - Unnötige State-Abfrage
**Status:** 🔧 IMPROVEMENT
**Aufwand:** 1h
**Datei:** `src/agents/daemon.ts:543`

**Problem:**
```typescript
const currentState = await this.state.getAll();
// currentState wird später nur für loopPrompt verwendet
```

- Bei jedem loop wird kompletter state geladen
- Bei 1000+ state keys = langsam

**Fix:** Lazy loading oder nur benötigte keys laden

---

#### TASK-007: Kein Audit-Log für sensitive Actions
**Status:** ✨ FEATURE
**Aufwand:** 3h
**Datei:** `src/agents/daemon.ts:1085+`

**Problem:**
- `merge_pr`, `vote`, `spawn_worker` werden nicht separat geloggt
- Kein Audit-Trail für Compliance

**Fix:**
1. `auditRepo.log()` für kritische Actions
2. Separate `audit_log` Tabelle
3. Immutable entries

---

## 2. Initiative System (`src/agents/initiative.ts`)

### 🟠 HOCH

#### TASK-008: Hash-Kollision bei Duplikat-Erkennung
**Status:** 🐛 BUG
**Aufwand:** 2h
**Datei:** `src/agents/initiative.ts:316`

**Problem:**
```typescript
hash = title.toLowerCase().replace(/[^a-z0-9]/g, '');
// "activate twitter" → "activatetwitter"
// "activate-twitter" → "activatetwitter" (SAME HASH!)
```

**Folge:** False positives bei Duplikat-Erkennung

**Fix:**
```typescript
import crypto from 'crypto';
const hash = crypto.createHash('sha256').update(title.toLowerCase()).digest('hex').slice(0, 16);
```

---

#### TASK-009: GitHub API Error zu permissiv
**Status:** 🐛 BUG
**Aufwand:** 2h
**Datei:** `src/agents/initiative.ts:366-369`

**Problem:**
```typescript
} catch (error) {
  logger.warn({ error }, 'GitHub search failed');
  continue; // Schluckt ALLE Fehler!
}
```

- Wenn search API rate-limited ist → false-positive "not duplicate"
- Neue Issues werden erstellt obwohl Duplikate existieren

**Fix:**
1. Unterscheide zwischen rate-limit und anderen Fehlern
2. Bei rate-limit: Retry mit backoff
3. Bei network error: Fail loudly

---

#### TASK-010: Keine Pagination in GitHub Search ✅ DONE
**Status:** 🐛 BUG → ✅ ERLEDIGT (2025-12-20)
**Aufwand:** 1h
**Datei:** `src/agents/initiative.ts:345`

**Problem:** `per_page: 10` war hart-codiert, zu wenige Ergebnisse für Duplikat-Erkennung

**Lösung:** `per_page` von 10 auf 30 erhöht - ausreichend für Duplikat-Erkennung ohne Overhead von voller Pagination

---

### 🟡 MITTEL

#### TASK-011: buildInitiativeContext() blockiert
**Status:** 🔧 IMPROVEMENT
**Aufwand:** 3h
**Datei:** `src/agents/initiative.ts:520-524`

**Problem:**
```typescript
Promise.all([fetchGitHubIssues, getTeamStatus, buildDataContext])
// buildDataContext kann 30+ Sekunden dauern
```

**Fix:**
1. Cache results in Redis mit 15min TTL
2. Background-Refresh statt blocking
3. Fallback zu cached data wenn API langsam

---

## 3. Workspace (`src/agents/workspace.ts`)

### 🔴 KRITISCH

#### TASK-012: Git Merge Conflicts nicht behandelt
**Status:** 🐛 BUG
**Aufwand:** 4h
**Datei:** `src/agents/workspace.ts:179`

**Problem:**
```typescript
await pullWorkspace()
// Wenn pull fehlschlägt (conflicts), wird ignoriert!
```

**Folge:**
- Agent commitet auf falscher branch
- Merge conflicts können entstehen
- PRs können nicht merged werden

**Fix:**
```typescript
const pullResult = await pullWorkspace();
if (!pullResult.success) {
  if (pullResult.error?.includes('CONFLICT')) {
    await git.merge(['--abort']);
    throw new Error('Merge conflict detected - aborting');
  }
  throw new Error(`Pull failed: ${pullResult.error}`);
}
```

---

#### TASK-013: Stash-Logik unsicher
**Status:** 🐛 BUG
**Aufwand:** 3h
**Datei:** `src/agents/workspace.ts:151-188`

**Problem:**
```typescript
await git.stash(); // Zeile 151
// ... operations ...
await git.stash(['pop']); // Zeile 188 - kann feilen!
```

**Folge:** Uncommitted changes können verloren gehen

**Fix:**
1. Vor stash: Temp-branch erstellen
2. Changes committen (WIP commit)
3. Nach operations: Cherry-pick oder rebase
4. Cleanup temp-branch

---

### 🟠 HOCH

#### TASK-014: Token in Git-URL exposed ✅ DONE
**Status:** ⚠️ SECURITY → ✅ ERLEDIGT (2025-12-20)
**Aufwand:** 2h
**Datei:** `src/agents/workspace.ts`

**Problem:** GitHub tokens (ghp_*, gho_*, github_pat_*) konnten in Logs erscheinen

**Lösung:** `maskSensitiveData()` Funktion hinzugefügt, die alle Token-Patterns maskiert. Auf alle Error-Logs in workspace.ts angewendet.

---

#### TASK-015: Kein Cleanup bei PR-Workflow-Fehler
**Status:** 🐛 BUG
**Aufwand:** 2h
**Datei:** `src/agents/workspace.ts`

**Problem:**
- Branch erstellt → Commit → Push FAILS
- Branch bleibt dangling
- Kein Cleanup

**Fix:**
```typescript
try {
  await createBranch();
  await commit();
  await push();
} catch (error) {
  // Cleanup dangling branch
  await git.branch(['-D', branchName]);
  throw error;
}
```

---

## 4. Redis (`src/lib/redis.ts`)

### 🟠 HOCH

#### TASK-016: Pub/Sub keine Message Garantie
**Status:** 🔧 IMPROVEMENT
**Aufwand:** 6h
**Datei:** `src/lib/redis.ts`

**Problem:**
- Pub/Sub ist fire-and-forget
- Wenn subscriber nicht verbunden → Message verloren
- Kritische decisions/tasks können verloren gehen

**Fix:**
Migriere zu Redis Streams:
```typescript
// Statt publish:
await redis.xadd('stream:agent:ceo', '*', 'message', JSON.stringify(msg));

// Statt subscribe:
await redis.xread('BLOCK', '0', 'STREAMS', 'stream:agent:ceo', '$');

// Consumer groups für guaranteed delivery:
await redis.xgroup('CREATE', 'stream:agent:ceo', 'ceo-consumers', '$');
```

---

#### TASK-017: Task Queue nicht atomic
**Status:** 🐛 BUG
**Aufwand:** 2h
**Datei:** `src/lib/redis.ts:131-134`

**Problem:**
```typescript
await redis.lpush(queueKey, task); // Zeile 131
await publisher.publish(channel, notification); // Zeile 134
// Wenn zwischen diesen Zeilen crash → notification lost
```

**Fix:**
```typescript
// Use Redis transaction
const multi = redis.multi();
multi.lpush(queueKey, task);
multi.publish(channel, notification);
await multi.exec();
```

---

## 5. MCP Worker (`src/workers/worker.ts`)

### 🔴 KRITISCH

#### TASK-018: Domain-Whitelist-Enforcement zu schwach
**Status:** ⚠️ SECURITY
**Aufwand:** 8h
**Datei:** `src/workers/worker.ts:174-178`

**Problem:**
```typescript
validateServerAccess() // Checks servers, NICHT domains
// Worker könnte trotzdem unerlaubte domains aufrufen
// Beispiel: "fetch" server ist whitelisted, aber agent ruft evil.com auf
```

**Fix:**
1. MCP-Server mit Domain-Filtering wrappen
2. Proxy für alle HTTP requests
3. Domain-Check vor jedem fetch

---

#### TASK-019: DRY-RUN nur als Text-Instruktion
**Status:** ⚠️ SECURITY
**Aufwand:** 4h
**Datei:** `src/workers/worker.ts:34-66`

**Problem:**
```typescript
getDryRunInstructions() // Nur Text!
// Claude könnte Instructions ignorieren und doch schreiben
```

**Fix:**
1. MCP-Server im Read-Only-Mode starten
2. Filesystem: Mount als read-only
3. Telegram: Nur getUpdates, kein sendMessage

---

### 🟠 HOCH

#### TASK-020: Kein Timeout-Enforcement ✅ DONE
**Status:** 🐛 BUG → ✅ ERLEDIGT (2025-12-20)
**Aufwand:** 2h

**Problem:** Worker-Timeout nicht enforced

**Lösung:** Bereits implementiert in `src/agents/claude.ts` via `setTimeout()` - Prozess wird mit SIGTERM beendet wenn Timeout erreicht

---

#### TASK-021: Config-File I/O bei jedem Call
**Status:** 🔧 IMPROVEMENT
**Aufwand:** 2h
**Datei:** `src/workers/worker.ts:73-80`

**Problem:**
```typescript
// Writes /tmp/mcp-worker-${taskId}.json
// Deletes file after
// Bei 1000 workers = viele I/O operations
```

**Fix:**
1. Config in memory halten
2. Oder: Shared config mit Template-Variablen
3. Oder: Redis-basierter Config-Store

---

## 6. Orchestrator API (`src/orchestrator/api.ts`)

### 🔴 KRITISCH

#### TASK-022: Keine Authentication ✅ DONE
**Status:** ⚠️ SECURITY → ✅ ERLEDIGT (2025-12-20)
**Aufwand:** 6h

**Problem:** Dashboard hatte keine Authentifizierung

**Lösung:** Supabase Auth implementiert:
- Login-Seite mit Email/Password
- 2FA (TOTP) Support mit Authenticator Apps
- Middleware für geschützte Routen
- Security Tab in Settings für 2FA-Enrollment
- Packages: `@supabase/supabase-js@2.89.0`, `@supabase/ssr@0.8.0`

---

#### TASK-023: Kein Rate Limiting ⏭️ ÜBERSPRUNGEN
**Status:** ⚠️ SECURITY → ⏭️ NICHT BENÖTIGT
**Aufwand:** 2h

**Grund:** Dashboard + Agents haben 1-1 Beziehung (Whitelabel-Lösung). Kein Multi-Tenant System, daher kein Rate Limiting nötig.

---

### 🟠 HOCH

#### TASK-024: Keine Request Validation
**Status:** 🐛 BUG
**Aufwand:** 4h
**Datei:** `src/orchestrator/api.ts:121`

**Problem:**
```typescript
parseInt(req.query.limit as string) // Keine Validation!
// "abc" → NaN
```

**Fix:**
```typescript
import { z } from 'zod';

const querySchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).optional()
});

const parsed = querySchema.safeParse(req.query);
if (!parsed.success) {
  return res.status(400).json({ error: parsed.error });
}
```

---

#### TASK-025: Unbounded Queries
**Status:** 🔧 IMPROVEMENT
**Aufwand:** 2h
**Datei:** `src/orchestrator/api.ts:200`

**Problem:**
```typescript
getRecent(limit) // default 100
// Bei 100k events in DB = slow query
```

**Fix:**
1. Hard limit: `Math.min(limit, 500)`
2. Cursor-basierte Pagination
3. Index auf `created_at`

---

### 🟡 MITTEL

#### TASK-026: Fehlende Endpoints
**Status:** ✨ FEATURE
**Aufwand:** 8h
**Datei:** `src/orchestrator/api.ts`

**Fehlend:**
- `GET /workers/logs` - Worker-Aktivität
- `GET /agents/:type/state` - Agent State
- `POST /agents/:type/message` - Direct Message
- `GET /kanban` - Kanban Board Data
- `GET /initiatives` - Initiative List
- `POST /benchmark/compare` - Multi-Model Compare

---

## 7. Dashboard

### 🟠 HOCH

#### TASK-027: API Error Handling fehlt
**Status:** 🐛 BUG
**Aufwand:** 4h
**Datei:** `dashboard/src/`

**Problem:**
- Keine Error Boundaries
- 1 API error crasht ganze Page
- Keine Retry-Logic

**Fix:**
```tsx
// Error Boundary
class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <ErrorDisplay message="Something went wrong" />;
    }
    return this.props.children;
  }
}

// Wrap pages
<ErrorBoundary>
  <AgentsPage />
</ErrorBoundary>
```

---

#### TASK-028: WebSocket Connection fehlt
**Status:** ✨ FEATURE
**Aufwand:** 6h
**Datei:** `dashboard/src/hooks/`

**Problem:**
- Dashboard pollt alle 30s
- Daten sind veraltet
- Kein Live-Update

**Fix:**
```typescript
// useWebSocket.ts
export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8080/ws');
    ws.onopen = () => setConnected(true);
    ws.onmessage = (e) => {
      const event = JSON.parse(e.data);
      setEvents(prev => [event, ...prev]);
    };
    return () => ws.close();
  }, []);

  return { connected, events };
}
```

---

### 🟡 MITTEL

#### TASK-029: Settings nicht persistent
**Status:** 🐛 BUG
**Aufwand:** 3h
**Datei:** `dashboard/src/app/settings/page.tsx`

**Problem:**
- Focus Slider existiert
- Settings verschwinden bei Page Reload
- Kein Save-Button mit API Call

**Fix:**
1. Settings Hook mit API Integration
2. Auto-Save oder Save-Button
3. Loading/Success States

---

#### TASK-030: Decision Voting UI fehlt
**Status:** ✨ FEATURE
**Aufwand:** 4h
**Datei:** `dashboard/src/app/decisions/page.tsx`

**Problem:**
- Decisions werden angezeigt
- Aber kein Voting-Interface für Humans

**Fix:**
1. Voting Buttons (Approve/Reject/Escalate)
2. Reason-TextField
3. API Call zu `/decisions/:id/vote`

---

## 8. Allgemeine System-Probleme

### 🔴 KRITISCH

#### TASK-031: Single Redis ist SPOF
**Status:** 🔧 IMPROVEMENT
**Aufwand:** 16h
**Datei:** `docker-compose.yml`, `src/lib/redis.ts`

**Problem:**
- Alle agents hängen von Redis ab
- Wenn Redis down → all agents stuck
- Kein Failover

**Fix:**
1. Redis Sentinel für HA
2. Oder: Redis Cluster
3. Connection retry mit circuit breaker

---

#### TASK-032: Kein Circuit Breaker für externe APIs
**Status:** 🔧 IMPROVEMENT
**Aufwand:** 8h
**Datei:** `src/workers/worker.ts`, `src/agents/initiative.ts`

**Problem:**
- Wenn GitHub API down → daemon hängt
- Kein Fallback oder Timeout
- Cascading failures möglich

**Fix:**
```typescript
import CircuitBreaker from 'opossum';

const githubBreaker = new CircuitBreaker(githubApiCall, {
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000
});

githubBreaker.fallback(() => ({ items: [], cached: true }));
```

---

### 🟠 HOCH

#### TASK-033: Kein Distributed Tracing
**Status:** ✨ FEATURE
**Aufwand:** 12h

**Problem:**
- Kann nicht sehen wie Request durch System fließt
- Debugging schwierig
- Performance bottlenecks unklar

**Fix:**
1. OpenTelemetry Integration
2. Jaeger oder Datadog
3. Trace IDs in allen Logs

---

#### TASK-034: Secrets Rotation fehlt
**Status:** ⚠️ SECURITY
**Aufwand:** 8h

**Problem:**
- GitHub token, API keys in .env forever
- Kein Rotation
- Kompromittierte Keys bleiben aktiv

**Fix:**
1. HashiCorp Vault Integration
2. Oder: AWS Secrets Manager
3. Automated rotation schedules

---

#### TASK-035: Logger kann Secrets exposen
**Status:** ⚠️ SECURITY
**Aufwand:** 4h
**Datei:** `src/lib/logger.ts`

**Problem:**
```typescript
logger.error({ error: e }) // e könnte Token enthalten
```

**Fix:**
```typescript
// Sanitizer middleware
const sanitize = (obj: any) => {
  const sanitized = { ...obj };
  const sensitiveKeys = ['token', 'password', 'secret', 'key'];
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '***REDACTED***';
    }
  }
  return sanitized;
};

logger.error(sanitize({ error: e }));
```

---

## 9. Testing

### 🟠 HOCH

#### TASK-036: Test Coverage zu niedrig
**Status:** 🔧 IMPROVEMENT
**Aufwand:** 40h

**Aktueller Stand:**
- daemon.test.ts - existiert, incomplete
- initiative.test.ts - existiert
- workspace.test.ts - existiert
- API tests - FEHLEN
- Integration tests - FEHLEN

**Ziel:** 70%+ Coverage

**Prioritäten:**
1. API Endpoint Tests
2. Daemon Action Tests
3. Integration: Daemon + DB + Redis
4. E2E: Dashboard → API → Agent

---

## Zusammenfassung

### Nach Priorität

| Priorität | Anzahl Tasks | Offen | Geschätzter Aufwand |
|-----------|--------------|-------|---------------------|
| 🔴 KRITISCH | 8 | 5 | ~43h |
| 🟠 HOCH | 14 | 11 | ~60h |
| 🟡 MITTEL | 10 | 9 | ~34h |
| 🟢 NIEDRIG | 4 | 4 | ~12h |
| **GESAMT** | **36** | **29 offen** | **~149h** |

> **Update 2025-12-20:**
> - 4 Quick Wins erledigt (TASK-003, TASK-010, TASK-014, TASK-020)
> - TASK-022 erledigt (Supabase Auth + 2FA)
> - TASK-023 übersprungen (Rate Limiting nicht benötigt bei 1-1 Whitelabel)

### Nach Kategorie

| Kategorie | Anzahl | Offen |
|-----------|--------|-------|
| 🐛 BUG | 15 | 12 |
| ⚠️ SECURITY | 6 | 3 |
| 🔧 IMPROVEMENT | 10 | 10 |
| ✨ FEATURE | 5 | 5 |

### Quick Wins (< 2h) ✅ ALLE ERLEDIGT

1. ~~TASK-003: Parser null-check (1h)~~ ✅ Bereits implementiert
2. ~~TASK-010: GitHub search pagination (1h)~~ ✅ per_page 10→30
3. ~~TASK-014: Token masking in logs (2h)~~ ✅ maskSensitiveData()
4. ~~TASK-020: Worker timeout (2h)~~ ✅ Bereits implementiert

### Empfohlene Reihenfolge

**Sprint 1 (Security & Critical Bugs):**
- ~~TASK-022: API Authentication~~ ✅ Supabase Auth + 2FA
- ~~TASK-023: Rate Limiting~~ ⏭️ Nicht benötigt (1-1 Whitelabel)
- TASK-018: Domain Whitelist Enforcement
- TASK-001: Task Queue Race Condition

**Sprint 2 (Stability):**
- TASK-012: Git Merge Conflicts
- TASK-016: Redis Streams Migration
- TASK-032: Circuit Breaker
- TASK-027: Dashboard Error Handling

**Sprint 3 (Quality):**
- TASK-036: Test Coverage
- TASK-033: Distributed Tracing
- TASK-028: WebSocket Connection
- TASK-026: Missing Endpoints

---

## Referenzen

- [FEATURE-REFERENCE.md](./FEATURE-REFERENCE.md) - Vollständige Feature-Dokumentation
- [AITO-3.0-COMPLETE.md](./AITO-3.0-COMPLETE.md) - System-Übersicht
