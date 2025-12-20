import { Pool, PoolClient } from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';
import type {
  Agent,
  AgentHistory,
  Decision,
  Task,
  Event,
  Escalation,
  AgentType,
  AgentStatus,
  DecisionStatus,
  TaskStatus,
} from './types.js';

// Connection pool
const pool = new Pool({
  connectionString: config.POSTGRES_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

// Query helper
async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

// Single result helper
async function queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] || null;
}

// Transaction helper
async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Agent Repository
export const agentRepo = {
  async findAll(): Promise<Agent[]> {
    return query<Agent>(`
      SELECT id, type, name, profile_path as "profilePath",
             loop_interval as "loopInterval", git_repo as "gitRepo",
             git_filter as "gitFilter", status, container_id as "containerId",
             last_heartbeat as "lastHeartbeat", created_at as "createdAt",
             updated_at as "updatedAt"
      FROM agents
      ORDER BY type
    `);
  },

  async findById(id: string): Promise<Agent | null> {
    return queryOne<Agent>(
      `SELECT id, type, name, profile_path as "profilePath",
              loop_interval as "loopInterval", git_repo as "gitRepo",
              git_filter as "gitFilter", status, container_id as "containerId",
              last_heartbeat as "lastHeartbeat", created_at as "createdAt",
              updated_at as "updatedAt"
       FROM agents WHERE id = $1`,
      [id]
    );
  },

  async findByType(type: AgentType): Promise<Agent | null> {
    return queryOne<Agent>(
      `SELECT id, type, name, profile_path as "profilePath",
              loop_interval as "loopInterval", git_repo as "gitRepo",
              git_filter as "gitFilter", status, container_id as "containerId",
              last_heartbeat as "lastHeartbeat", created_at as "createdAt",
              updated_at as "updatedAt"
       FROM agents WHERE type = $1`,
      [type]
    );
  },

  async create(agent: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Promise<Agent> {
    const [result] = await query<Agent>(
      `INSERT INTO agents (type, name, profile_path, loop_interval, git_repo, git_filter, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, type, name, profile_path as "profilePath",
                 loop_interval as "loopInterval", git_repo as "gitRepo",
                 git_filter as "gitFilter", status, created_at as "createdAt",
                 updated_at as "updatedAt"`,
      [agent.type, agent.name, agent.profilePath, agent.loopInterval, agent.gitRepo, agent.gitFilter, agent.status]
    );
    return result;
  },

  async updateStatus(id: string, status: AgentStatus, containerId?: string): Promise<void> {
    await query(
      `UPDATE agents SET status = $2, container_id = $3, updated_at = NOW() WHERE id = $1`,
      [id, status, containerId]
    );
  },

  async updateHeartbeat(id: string): Promise<void> {
    await query(
      `UPDATE agents SET last_heartbeat = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );
  },
};

// State keys that contain external/volatile data and need TTL enforcement
// These should expire and force agents to fetch fresh data via spawn_worker
const VOLATILE_STATE_KEYS = [
  // Treasury/Balance data
  'treasury_status',
  'treasury_total_usd',
  'treasury_balance',
  'balance_data',
  'eth_balance',
  'eth_balance_usd',
  'eth_balance_confirmed',
  'solana_balance',
  'solana_balance_usd',
  'solana_balance_confirmed',
  'solana_balance_worker_pending',
  'bnb_balance',
  // Market data - CRITICAL: agents hallucinate these!
  'market_prices',
  'market_data',
  'market_sentiment',
  'market_data_current',
  'market_data_fetched',
  'market_data_source',
  'price_data',
  'token_metrics',
  'holder_count',
  'liquidity_data',
  'volume_data',
  'fear_greed_index',
  // Reference prices - agents use these to avoid spawning workers!
  'reference_prices',
  'reference_prices_used',
  'shibc_metrics',
  'shibc_price',
  // Verification flags (must be re-verified each loop)
  'balance_monitoring',
  'data_verified',
];

// Default TTL for volatile data: 1 hour
const STATE_TTL_HOURS = 1;

// Agent State Repository
export const stateRepo = {
  async get(agentId: string, key: string): Promise<unknown | null> {
    const result = await queryOne<{ stateValue: unknown }>(
      `SELECT state_value as "stateValue" FROM agent_state WHERE agent_id = $1 AND state_key = $2`,
      [agentId, key]
    );
    return result?.stateValue ?? null;
  },

  async set(agentId: string, key: string, value: unknown): Promise<void> {
    await query(
      `INSERT INTO agent_state (agent_id, state_key, state_value)
       VALUES ($1, $2, $3)
       ON CONFLICT (agent_id, state_key) DO UPDATE SET state_value = $3, updated_at = NOW()`,
      [agentId, key, JSON.stringify(value)]
    );
  },

  /**
   * Get all state values with TTL enforcement for volatile keys.
   * Volatile keys (market data, balances, etc.) older than TTL are excluded.
   * This forces agents to fetch fresh data via spawn_worker.
   */
  async getAll(agentId: string): Promise<Record<string, unknown>> {
    // Get all state with updated_at timestamp
    const rows = await query<{ stateKey: string; stateValue: unknown; updatedAt: Date }>(
      `SELECT state_key as "stateKey", state_value as "stateValue", updated_at as "updatedAt"
       FROM agent_state WHERE agent_id = $1`,
      [agentId]
    );

    const now = new Date();
    const ttlMs = STATE_TTL_HOURS * 60 * 60 * 1000;
    const result: Record<string, unknown> = {};

    for (const row of rows) {
      const isVolatile = VOLATILE_STATE_KEYS.some(vk =>
        row.stateKey === vk || row.stateKey.startsWith(vk + '_') || row.stateKey.endsWith('_' + vk)
      );

      if (isVolatile) {
        // Check TTL for volatile keys
        const age = now.getTime() - new Date(row.updatedAt).getTime();
        if (age > ttlMs) {
          logger.info({ agentId, key: row.stateKey, ageHours: (age / 3600000).toFixed(1) },
            'Skipping stale volatile state (TTL expired)');
          continue; // Skip stale volatile data
        }
      }

      // Include fresh volatile data and all persistent data
      result[row.stateKey] = row.stateValue;
    }

    return result;
  },

  /**
   * Delete all stale volatile state for an agent
   */
  async deleteStale(agentId: string): Promise<number> {
    const volatilePattern = VOLATILE_STATE_KEYS.map(k => `'${k}'`).join(',');
    const result = await query<{ count: string }>(
      `WITH deleted AS (
        DELETE FROM agent_state
        WHERE agent_id = $1
          AND state_key = ANY($2::text[])
          AND updated_at < NOW() - INTERVAL '${STATE_TTL_HOURS} hours'
        RETURNING 1
      ) SELECT COUNT(*)::text as count FROM deleted`,
      [agentId, VOLATILE_STATE_KEYS]
    );
    const count = parseInt(result[0]?.count || '0', 10);
    if (count > 0) {
      logger.info({ agentId, deletedCount: count }, 'Deleted stale volatile state');
    }
    return count;
  },

  async delete(agentId: string, key: string): Promise<void> {
    await query(`DELETE FROM agent_state WHERE agent_id = $1 AND state_key = $2`, [agentId, key]);
  },
};

// Agent History Repository
export const historyRepo = {
  async add(entry: Omit<AgentHistory, 'id' | 'createdAt'>): Promise<AgentHistory> {
    const [result] = await query<AgentHistory>(
      `INSERT INTO agent_history (agent_id, action_type, summary, details, embedding)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, agent_id as "agentId", action_type as "actionType",
                 summary, details, embedding, created_at as "createdAt"`,
      [entry.agentId, entry.actionType, entry.summary, JSON.stringify(entry.details), entry.embedding]
    );
    return result;
  },

  async getRecent(agentId: string, limit = 50): Promise<AgentHistory[]> {
    return query<AgentHistory>(
      `SELECT id, agent_id as "agentId", action_type as "actionType",
              summary, details, created_at as "createdAt"
       FROM agent_history WHERE agent_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [agentId, limit]
    );
  },

  async search(agentId: string, queryEmbedding: number[], limit = 10): Promise<AgentHistory[]> {
    // Uses pgvector for similarity search
    return query<AgentHistory>(
      `SELECT id, agent_id as "agentId", action_type as "actionType",
              summary, details, created_at as "createdAt",
              1 - (embedding <=> $2::vector) as similarity
       FROM agent_history
       WHERE agent_id = $1 AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [agentId, JSON.stringify(queryEmbedding), limit]
    );
  },
};

// Decision Repository
export const decisionRepo = {
  async create(decision: Omit<Decision, 'id' | 'createdAt'>): Promise<Decision> {
    const [result] = await query<Decision>(
      `INSERT INTO decisions (title, description, proposed_by, decision_type, status, veto_round)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, description, proposed_by as "proposedBy",
                 decision_type as "decisionType", status, veto_round as "vetoRound",
                 ceo_vote as "ceoVote", dao_vote as "daoVote",
                 c_level_votes as "cLevelVotes", human_decision as "humanDecision",
                 resolved_at as "resolvedAt", created_at as "createdAt"`,
      [decision.title, decision.description, decision.proposedBy, decision.decisionType, decision.status, decision.vetoRound]
    );
    return result;
  },

  async findById(id: string): Promise<Decision | null> {
    return queryOne<Decision>(
      `SELECT id, title, description, proposed_by as "proposedBy",
              decision_type as "decisionType", status, veto_round as "vetoRound",
              ceo_vote as "ceoVote", dao_vote as "daoVote",
              c_level_votes as "cLevelVotes", human_decision as "humanDecision",
              resolved_at as "resolvedAt", created_at as "createdAt"
       FROM decisions WHERE id = $1`,
      [id]
    );
  },

  async findPending(): Promise<Decision[]> {
    return query<Decision>(
      `SELECT id, title, description, proposed_by as "proposedBy",
              decision_type as "decisionType", status, veto_round as "vetoRound",
              ceo_vote as "ceoVote", dao_vote as "daoVote",
              c_level_votes as "cLevelVotes", created_at as "createdAt"
       FROM decisions WHERE status IN ('pending', 'escalated')
       ORDER BY created_at ASC`
    );
  },

  async updateVote(id: string, voter: 'ceo' | 'dao', vote: string): Promise<void> {
    const column = voter === 'ceo' ? 'ceo_vote' : 'dao_vote';
    await query(`UPDATE decisions SET ${column} = $2 WHERE id = $1`, [id, vote]);
  },

  async updateCLevelVotes(id: string, votes: Record<string, string>): Promise<void> {
    await query(`UPDATE decisions SET c_level_votes = $2 WHERE id = $1`, [id, JSON.stringify(votes)]);
  },

  async updateStatus(id: string, status: DecisionStatus, resolvedAt?: Date): Promise<void> {
    await query(
      `UPDATE decisions SET status = $2, resolved_at = $3 WHERE id = $1`,
      [id, status, resolvedAt]
    );
  },

  async incrementVetoRound(id: string): Promise<void> {
    await query(`UPDATE decisions SET veto_round = veto_round + 1 WHERE id = $1`, [id]);
  },

  async findEscalated(): Promise<Decision[]> {
    return query<Decision>(
      `SELECT id, title, description, proposed_by as "proposedBy",
              decision_type as "decisionType", status, veto_round as "vetoRound",
              ceo_vote as "ceoVote", dao_vote as "daoVote",
              c_level_votes as "cLevelVotes", human_decision as "humanDecision",
              resolved_at as "resolvedAt", created_at as "createdAt"
       FROM decisions WHERE status = 'escalated'
       ORDER BY created_at ASC`
    );
  },

  async setHumanDecision(id: string, decision: string, reason?: string): Promise<void> {
    await query(
      `UPDATE decisions SET human_decision = $1, human_reason = $2 WHERE id = $3`,
      [decision, reason || null, id]
    );
  },

  async findAll(limit = 50, offset = 0): Promise<Decision[]> {
    return query<Decision>(
      `SELECT id, title, description, proposed_by as "proposedBy",
              decision_type as "decisionType", status, veto_round as "vetoRound",
              ceo_vote as "ceoVote", dao_vote as "daoVote",
              c_level_votes as "cLevelVotes", human_decision as "humanDecision",
              resolved_at as "resolvedAt", created_at as "createdAt"
       FROM decisions
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  },
};

// Task Repository
export const taskRepo = {
  async create(task: Omit<Task, 'id' | 'createdAt'>): Promise<Task> {
    const [result] = await query<Task>(
      `INSERT INTO tasks (title, description, assigned_to, created_by, status, priority, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, description, assigned_to as "assignedTo",
                 created_by as "createdBy", status, priority,
                 due_date as "dueDate", completed_at as "completedAt",
                 result, created_at as "createdAt"`,
      [task.title, task.description, task.assignedTo, task.createdBy, task.status, task.priority, task.dueDate]
    );
    return result;
  },

  async findByAgent(agentId: string, status?: TaskStatus): Promise<Task[]> {
    if (status) {
      return query<Task>(
        `SELECT id, title, description, assigned_to as "assignedTo",
                created_by as "createdBy", status, priority,
                due_date as "dueDate", completed_at as "completedAt",
                result, created_at as "createdAt"
         FROM tasks WHERE assigned_to = $1 AND status = $2
         ORDER BY priority ASC, created_at ASC`,
        [agentId, status]
      );
    }
    return query<Task>(
      `SELECT id, title, description, assigned_to as "assignedTo",
              created_by as "createdBy", status, priority,
              due_date as "dueDate", completed_at as "completedAt",
              result, created_at as "createdAt"
       FROM tasks WHERE assigned_to = $1
       ORDER BY priority ASC, created_at ASC`,
      [agentId]
    );
  },

  async updateStatus(id: string, status: TaskStatus, result?: unknown): Promise<void> {
    const completedAt = status === 'completed' ? new Date() : null;
    await query(
      `UPDATE tasks SET status = $2, completed_at = $3, result = $4 WHERE id = $1`,
      [id, status, completedAt, result ? JSON.stringify(result) : null]
    );
  },
};

// Event Repository
export const eventRepo = {
  async log(event: Omit<Event, 'id' | 'createdAt'>): Promise<Event> {
    const [result] = await query<Event>(
      `INSERT INTO events (event_type, source_agent, target_agent, payload, correlation_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, event_type as "eventType", source_agent as "sourceAgent",
                 target_agent as "targetAgent", payload, correlation_id as "correlationId",
                 created_at as "createdAt"`,
      [event.eventType, event.sourceAgent, event.targetAgent, JSON.stringify(event.payload), event.correlationId]
    );
    return result;
  },

  async getRecent(limit = 100): Promise<Event[]> {
    return query<Event>(
      `SELECT id, event_type as "eventType", source_agent as "sourceAgent",
              target_agent as "targetAgent", payload, correlation_id as "correlationId",
              created_at as "createdAt"
       FROM events ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
  },

  async getByAgent(agentId: string, limit = 50): Promise<Event[]> {
    return query<Event>(
      `SELECT id, event_type as "eventType", source_agent as "sourceAgent",
              target_agent as "targetAgent", payload, correlation_id as "correlationId",
              created_at as "createdAt"
       FROM events
       WHERE source_agent = $1 OR target_agent = $1
       ORDER BY created_at DESC LIMIT $2`,
      [agentId, limit]
    );
  },

  async getByType(eventType: string, limit = 50): Promise<Event[]> {
    return query<Event>(
      `SELECT id, event_type as "eventType", source_agent as "sourceAgent",
              target_agent as "targetAgent", payload, correlation_id as "correlationId",
              created_at as "createdAt"
       FROM events
       WHERE event_type = $1
       ORDER BY created_at DESC LIMIT $2`,
      [eventType, limit]
    );
  },
};

// Escalation Repository
export const escalationRepo = {
  async create(escalation: Omit<Escalation, 'id' | 'createdAt'>): Promise<Escalation> {
    const [result] = await query<Escalation>(
      `INSERT INTO escalations (decision_id, reason, channels_notified, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, decision_id as "decisionId", reason,
                 channels_notified as "channelsNotified", human_response as "humanResponse",
                 responded_at as "respondedAt", status, created_at as "createdAt"`,
      [escalation.decisionId, escalation.reason, JSON.stringify(escalation.channelsNotified), escalation.status]
    );
    return result;
  },

  async findPending(): Promise<Escalation[]> {
    return query<Escalation>(
      `SELECT id, decision_id as "decisionId", reason,
              channels_notified as "channelsNotified", human_response as "humanResponse",
              responded_at as "respondedAt", status, created_at as "createdAt"
       FROM escalations WHERE status = 'pending'
       ORDER BY created_at ASC`
    );
  },

  async respond(id: string, response: string): Promise<void> {
    await query(
      `UPDATE escalations SET human_response = $2, responded_at = NOW(), status = 'responded' WHERE id = $1`,
      [id, response]
    );
  },

  async timeout(id: string): Promise<void> {
    await query(`UPDATE escalations SET status = 'timeout' WHERE id = $1`, [id]);
  },
};

// Domain Whitelist Repository
export interface DomainWhitelist {
  id: string;
  domain: string;
  category: string;
  description: string | null;
  isActive: boolean;
  addedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export const domainWhitelistRepo = {
  async getAll(): Promise<DomainWhitelist[]> {
    return query<DomainWhitelist>(
      `SELECT id, domain, category, description, is_active as "isActive",
              added_by as "addedBy", created_at as "createdAt", updated_at as "updatedAt"
       FROM domain_whitelist WHERE is_active = true
       ORDER BY category, domain`
    );
  },

  async getAllDomains(): Promise<string[]> {
    const rows = await query<{ domain: string }>(
      `SELECT domain FROM domain_whitelist WHERE is_active = true`
    );
    return rows.map(r => r.domain);
  },

  async getByCategory(category: string): Promise<DomainWhitelist[]> {
    return query<DomainWhitelist>(
      `SELECT id, domain, category, description, is_active as "isActive",
              added_by as "addedBy", created_at as "createdAt", updated_at as "updatedAt"
       FROM domain_whitelist WHERE category = $1 AND is_active = true
       ORDER BY domain`,
      [category]
    );
  },

  async isDomainWhitelisted(domain: string): Promise<boolean> {
    const normalizedDomain = domain.toLowerCase();
    const result = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM domain_whitelist
        WHERE is_active = true
          AND (domain = $1 OR $1 LIKE '%.' || domain)
      ) as exists`,
      [normalizedDomain]
    );
    return result?.exists || false;
  },

  async add(domain: string, category: string, description?: string, addedBy = 'human'): Promise<DomainWhitelist> {
    const [result] = await query<DomainWhitelist>(
      `INSERT INTO domain_whitelist (domain, category, description, added_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (domain) DO UPDATE SET is_active = true, updated_at = NOW()
       RETURNING id, domain, category, description, is_active as "isActive",
                 added_by as "addedBy", created_at as "createdAt", updated_at as "updatedAt"`,
      [domain.toLowerCase(), category, description, addedBy]
    );
    return result;
  },

  async remove(domain: string): Promise<void> {
    await query(
      `UPDATE domain_whitelist SET is_active = false WHERE domain = $1`,
      [domain.toLowerCase()]
    );
  },

  async getCategories(): Promise<string[]> {
    const rows = await query<{ category: string }>(
      `SELECT DISTINCT category FROM domain_whitelist WHERE is_active = true ORDER BY category`
    );
    return rows.map(r => r.category);
  },
};

// Domain Approval Requests Repository
export interface DomainApprovalRequest {
  id: string;
  domain: string;
  url: string;
  requestedBy: string;
  taskContext: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  reviewedBy: string | null;
  reviewNotes: string | null;
  suggestedCategory: string | null;
  securityScore: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export const domainApprovalRepo = {
  async create(data: {
    domain: string;
    url: string;
    requestedBy: string;
    taskContext: string;
    reason?: string;
    suggestedCategory?: string;
    securityScore?: number;
  }): Promise<DomainApprovalRequest> {
    const [result] = await query<DomainApprovalRequest>(
      `INSERT INTO domain_approval_requests
        (domain, url, requested_by, task_context, reason, suggested_category, security_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, domain, url, requested_by as "requestedBy", task_context as "taskContext",
                 reason, status, reviewed_by as "reviewedBy", review_notes as "reviewNotes",
                 suggested_category as "suggestedCategory", security_score as "securityScore",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [data.domain, data.url, data.requestedBy, data.taskContext, data.reason, data.suggestedCategory, data.securityScore]
    );
    return result;
  },

  async getPending(): Promise<DomainApprovalRequest[]> {
    return query<DomainApprovalRequest>(
      `SELECT id, domain, url, requested_by as "requestedBy", task_context as "taskContext",
              reason, status, reviewed_by as "reviewedBy", review_notes as "reviewNotes",
              suggested_category as "suggestedCategory", security_score as "securityScore",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM domain_approval_requests WHERE status = 'pending'
       ORDER BY created_at ASC`
    );
  },

  async getAll(limit = 50): Promise<DomainApprovalRequest[]> {
    return query<DomainApprovalRequest>(
      `SELECT id, domain, url, requested_by as "requestedBy", task_context as "taskContext",
              reason, status, reviewed_by as "reviewedBy", review_notes as "reviewNotes",
              suggested_category as "suggestedCategory", security_score as "securityScore",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM domain_approval_requests
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
  },

  async getById(id: string): Promise<DomainApprovalRequest | null> {
    return queryOne<DomainApprovalRequest>(
      `SELECT id, domain, url, requested_by as "requestedBy", task_context as "taskContext",
              reason, status, reviewed_by as "reviewedBy", review_notes as "reviewNotes",
              suggested_category as "suggestedCategory", security_score as "securityScore",
              created_at as "createdAt", updated_at as "updatedAt"
       FROM domain_approval_requests WHERE id = $1`,
      [id]
    );
  },

  async hasPendingRequest(domain: string): Promise<boolean> {
    const result = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM domain_approval_requests WHERE domain = $1 AND status = 'pending') as exists`,
      [domain.toLowerCase()]
    );
    return result?.exists || false;
  },

  async approve(id: string, reviewedBy: string, reviewNotes?: string, category = 'general'): Promise<DomainApprovalRequest | null> {
    // Update approval status
    const [result] = await query<DomainApprovalRequest>(
      `UPDATE domain_approval_requests
       SET status = 'approved', reviewed_by = $2, review_notes = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING id, domain, url, requested_by as "requestedBy", task_context as "taskContext",
                 reason, status, reviewed_by as "reviewedBy", review_notes as "reviewNotes",
                 suggested_category as "suggestedCategory", security_score as "securityScore",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [id, reviewedBy, reviewNotes]
    );

    if (result) {
      // Also add to whitelist
      await domainWhitelistRepo.add(
        result.domain,
        result.suggestedCategory || category,
        `Approved via request: ${result.taskContext}`,
        reviewedBy
      );
    }

    return result;
  },

  async reject(id: string, reviewedBy: string, reviewNotes?: string): Promise<DomainApprovalRequest | null> {
    const [result] = await query<DomainApprovalRequest>(
      `UPDATE domain_approval_requests
       SET status = 'rejected', reviewed_by = $2, review_notes = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING id, domain, url, requested_by as "requestedBy", task_context as "taskContext",
                 reason, status, reviewed_by as "reviewedBy", review_notes as "reviewNotes",
                 suggested_category as "suggestedCategory", security_score as "securityScore",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [id, reviewedBy, reviewNotes]
    );
    return result;
  },

  async autoApprove(id: string, reason: string): Promise<DomainApprovalRequest | null> {
    const request = await this.getById(id);
    if (!request) return null;

    const [result] = await query<DomainApprovalRequest>(
      `UPDATE domain_approval_requests
       SET status = 'auto_approved', reviewed_by = 'auto', review_notes = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, domain, url, requested_by as "requestedBy", task_context as "taskContext",
                 reason, status, reviewed_by as "reviewedBy", review_notes as "reviewNotes",
                 suggested_category as "suggestedCategory", security_score as "securityScore",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [id, reason]
    );

    if (result) {
      await domainWhitelistRepo.add(
        result.domain,
        result.suggestedCategory || 'auto_approved',
        `Auto-approved: ${reason}`,
        'auto'
      );
    }

    return result;
  },
};

// Agent Profile Repository
export interface AgentProfile {
  id: string;
  agentId: string;
  version: number;
  content: string;
  identity: Record<string, unknown>;
  mcpServers: Record<string, unknown>;
  capabilities: unknown[];
  constraints: unknown[];
  loopActions: unknown[];
  decisionAuthority: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export const profileRepo = {
  async getActive(agentId: string): Promise<AgentProfile | null> {
    return queryOne<AgentProfile>(
      `SELECT id, agent_id as "agentId", version, content,
              identity, mcp_servers as "mcpServers", capabilities, constraints,
              loop_actions as "loopActions", decision_authority as "decisionAuthority",
              is_active as "isActive", created_at as "createdAt",
              updated_at as "updatedAt", created_by as "createdBy"
       FROM agent_profiles WHERE agent_id = $1 AND is_active = true`,
      [agentId]
    );
  },

  async getByAgentType(agentType: AgentType): Promise<AgentProfile | null> {
    return queryOne<AgentProfile>(
      `SELECT p.id, p.agent_id as "agentId", p.version, p.content,
              p.identity, p.mcp_servers as "mcpServers", p.capabilities, p.constraints,
              p.loop_actions as "loopActions", p.decision_authority as "decisionAuthority",
              p.is_active as "isActive", p.created_at as "createdAt",
              p.updated_at as "updatedAt", p.created_by as "createdBy"
       FROM agent_profiles p
       JOIN agents a ON p.agent_id = a.id
       WHERE a.type = $1 AND p.is_active = true`,
      [agentType]
    );
  },

  async create(profile: Omit<AgentProfile, 'id' | 'version' | 'createdAt' | 'updatedAt'>): Promise<AgentProfile> {
    const [result] = await query<AgentProfile>(
      `INSERT INTO agent_profiles (agent_id, content, identity, mcp_servers, capabilities,
                                   constraints, loop_actions, decision_authority, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, agent_id as "agentId", version, content,
                 identity, mcp_servers as "mcpServers", capabilities, constraints,
                 loop_actions as "loopActions", decision_authority as "decisionAuthority",
                 is_active as "isActive", created_at as "createdAt",
                 updated_at as "updatedAt", created_by as "createdBy"`,
      [
        profile.agentId, profile.content, JSON.stringify(profile.identity),
        JSON.stringify(profile.mcpServers), JSON.stringify(profile.capabilities),
        JSON.stringify(profile.constraints), JSON.stringify(profile.loopActions),
        JSON.stringify(profile.decisionAuthority), profile.isActive, profile.createdBy
      ]
    );
    return result;
  },

  async update(id: string, updates: Partial<Pick<AgentProfile, 'content' | 'identity' | 'mcpServers' | 'capabilities' | 'constraints' | 'loopActions' | 'decisionAuthority'>>): Promise<AgentProfile | null> {
    const setClause: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.content !== undefined) {
      setClause.push(`content = $${paramIndex++}`);
      values.push(updates.content);
    }
    if (updates.identity !== undefined) {
      setClause.push(`identity = $${paramIndex++}`);
      values.push(JSON.stringify(updates.identity));
    }
    if (updates.mcpServers !== undefined) {
      setClause.push(`mcp_servers = $${paramIndex++}`);
      values.push(JSON.stringify(updates.mcpServers));
    }
    if (updates.capabilities !== undefined) {
      setClause.push(`capabilities = $${paramIndex++}`);
      values.push(JSON.stringify(updates.capabilities));
    }
    if (updates.constraints !== undefined) {
      setClause.push(`constraints = $${paramIndex++}`);
      values.push(JSON.stringify(updates.constraints));
    }
    if (updates.loopActions !== undefined) {
      setClause.push(`loop_actions = $${paramIndex++}`);
      values.push(JSON.stringify(updates.loopActions));
    }
    if (updates.decisionAuthority !== undefined) {
      setClause.push(`decision_authority = $${paramIndex++}`);
      values.push(JSON.stringify(updates.decisionAuthority));
    }

    if (setClause.length === 0) return this.getActive(id);

    values.push(id);
    const [result] = await query<AgentProfile>(
      `UPDATE agent_profiles SET ${setClause.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING id, agent_id as "agentId", version, content,
                 identity, mcp_servers as "mcpServers", capabilities, constraints,
                 loop_actions as "loopActions", decision_authority as "decisionAuthority",
                 is_active as "isActive", created_at as "createdAt",
                 updated_at as "updatedAt", created_by as "createdBy"`,
      values
    );
    return result;
  },

  async getVersionHistory(agentId: string): Promise<AgentProfile[]> {
    return query<AgentProfile>(
      `SELECT id, agent_id as "agentId", version, content,
              identity, mcp_servers as "mcpServers", capabilities, constraints,
              loop_actions as "loopActions", decision_authority as "decisionAuthority",
              is_active as "isActive", created_at as "createdAt",
              updated_at as "updatedAt", created_by as "createdBy"
       FROM agent_profiles WHERE agent_id = $1
       ORDER BY version DESC`,
      [agentId]
    );
  },
};

// LLM Usage Repository
export interface LLMUsageRecord {
  id: string;
  provider: string;
  model: string | null;
  agentId: string | null;
  agentType: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costCents: number;
  durationMs: number | null;
  requestType: string | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: Date;
}

export const llmUsageRepo = {
  async log(usage: Omit<LLMUsageRecord, 'id' | 'totalTokens' | 'createdAt'>): Promise<LLMUsageRecord> {
    const [result] = await query<LLMUsageRecord>(
      `INSERT INTO llm_usage (provider, model, agent_id, agent_type, prompt_tokens,
                              completion_tokens, cost_cents, duration_ms, request_type, success, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, provider, model, agent_id as "agentId", agent_type as "agentType",
                 prompt_tokens as "promptTokens", completion_tokens as "completionTokens",
                 total_tokens as "totalTokens", cost_cents as "costCents",
                 duration_ms as "durationMs", request_type as "requestType",
                 success, error_message as "errorMessage", created_at as "createdAt"`,
      [
        usage.provider, usage.model, usage.agentId, usage.agentType,
        usage.promptTokens, usage.completionTokens, usage.costCents,
        usage.durationMs, usage.requestType, usage.success, usage.errorMessage
      ]
    );
    return result;
  },

  async getMonthlyStats(provider: string, year: number, month: number): Promise<{
    totalRequests: number;
    successfulRequests: number;
    totalTokens: number;
    totalCostCents: number;
    avgDurationMs: number;
  }> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    const [result] = await query<{
      totalRequests: string;
      successfulRequests: string;
      totalTokens: string;
      totalCostCents: string;
      avgDurationMs: string;
    }>(
      `SELECT
         COUNT(*)::text as "totalRequests",
         SUM(CASE WHEN success THEN 1 ELSE 0 END)::text as "successfulRequests",
         COALESCE(SUM(total_tokens), 0)::text as "totalTokens",
         COALESCE(SUM(cost_cents), 0)::text as "totalCostCents",
         COALESCE(AVG(duration_ms), 0)::text as "avgDurationMs"
       FROM llm_usage
       WHERE provider = $1 AND created_at >= $2 AND created_at < $3`,
      [provider, startDate, endDate]
    );

    return {
      totalRequests: parseInt(result?.totalRequests || '0', 10),
      successfulRequests: parseInt(result?.successfulRequests || '0', 10),
      totalTokens: parseInt(result?.totalTokens || '0', 10),
      totalCostCents: parseInt(result?.totalCostCents || '0', 10),
      avgDurationMs: Math.round(parseFloat(result?.avgDurationMs || '0')),
    };
  },

  async getByAgent(agentId: string, limit = 100): Promise<LLMUsageRecord[]> {
    return query<LLMUsageRecord>(
      `SELECT id, provider, model, agent_id as "agentId", agent_type as "agentType",
              prompt_tokens as "promptTokens", completion_tokens as "completionTokens",
              total_tokens as "totalTokens", cost_cents as "costCents",
              duration_ms as "durationMs", request_type as "requestType",
              success, error_message as "errorMessage", created_at as "createdAt"
       FROM llm_usage WHERE agent_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [agentId, limit]
    );
  },
};

// Worker Execution Repository
export interface WorkerExecution {
  id: string;
  workerId: string | null;
  agentId: string | null;
  agentType: string | null;
  task: string;
  mcpServers: string[];
  output: string | null;
  success: boolean;
  errorMessage: string | null;
  durationMs: number | null;
  tokenCount: number | null;
  correlationId: string | null;
  createdAt: Date;
}

export const workerExecutionRepo = {
  async log(execution: Omit<WorkerExecution, 'id' | 'createdAt'>): Promise<WorkerExecution> {
    const [result] = await query<WorkerExecution>(
      `INSERT INTO worker_executions (worker_id, agent_id, agent_type, task, mcp_servers,
                                       output, success, error_message, duration_ms, token_count, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, worker_id as "workerId", agent_id as "agentId", agent_type as "agentType",
                 task, mcp_servers as "mcpServers", output, success, error_message as "errorMessage",
                 duration_ms as "durationMs", token_count as "tokenCount",
                 correlation_id as "correlationId", created_at as "createdAt"`,
      [
        execution.workerId, execution.agentId, execution.agentType, execution.task,
        execution.mcpServers, execution.output, execution.success, execution.errorMessage,
        execution.durationMs, execution.tokenCount, execution.correlationId
      ]
    );
    return result;
  },

  async getByAgent(agentId: string, limit = 50): Promise<WorkerExecution[]> {
    return query<WorkerExecution>(
      `SELECT id, worker_id as "workerId", agent_id as "agentId", agent_type as "agentType",
              task, mcp_servers as "mcpServers", output, success, error_message as "errorMessage",
              duration_ms as "durationMs", token_count as "tokenCount",
              correlation_id as "correlationId", created_at as "createdAt"
       FROM worker_executions WHERE agent_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [agentId, limit]
    );
  },

  async getRecent(limit = 100): Promise<WorkerExecution[]> {
    return query<WorkerExecution>(
      `SELECT id, worker_id as "workerId", agent_id as "agentId", agent_type as "agentType",
              task, mcp_servers as "mcpServers", output, success, error_message as "errorMessage",
              duration_ms as "durationMs", token_count as "tokenCount",
              correlation_id as "correlationId", created_at as "createdAt"
       FROM worker_executions
       ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
  },
};

// Benchmark Repository
export interface BenchmarkRun {
  id: string;
  runId: string;
  models: unknown[];
  tasks: unknown[];
  enableTools: boolean;
  results: Record<string, unknown>;
  evaluations: Record<string, unknown>;
  leaderboard: unknown[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  totalCostCents: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export const benchmarkRepo = {
  async create(benchmark: Pick<BenchmarkRun, 'runId' | 'models' | 'tasks' | 'enableTools' | 'createdBy'>): Promise<BenchmarkRun> {
    const [result] = await query<BenchmarkRun>(
      `INSERT INTO benchmark_runs (run_id, models, tasks, enable_tools, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, run_id as "runId", models, tasks, enable_tools as "enableTools",
                 results, evaluations, leaderboard, status, started_at as "startedAt",
                 completed_at as "completedAt", duration_ms as "durationMs",
                 total_cost_cents as "totalCostCents", created_at as "createdAt",
                 updated_at as "updatedAt", created_by as "createdBy"`,
      [benchmark.runId, JSON.stringify(benchmark.models), JSON.stringify(benchmark.tasks),
       benchmark.enableTools, benchmark.createdBy]
    );
    return result;
  },

  async getByRunId(runId: string): Promise<BenchmarkRun | null> {
    return queryOne<BenchmarkRun>(
      `SELECT id, run_id as "runId", models, tasks, enable_tools as "enableTools",
              results, evaluations, leaderboard, status, started_at as "startedAt",
              completed_at as "completedAt", duration_ms as "durationMs",
              total_cost_cents as "totalCostCents", created_at as "createdAt",
              updated_at as "updatedAt", created_by as "createdBy"
       FROM benchmark_runs WHERE run_id = $1`,
      [runId]
    );
  },

  async updateResults(runId: string, results: Record<string, unknown>, evaluations?: Record<string, unknown>, leaderboard?: unknown[]): Promise<void> {
    await query(
      `UPDATE benchmark_runs
       SET results = $2, evaluations = COALESCE($3, evaluations), leaderboard = COALESCE($4, leaderboard),
           updated_at = NOW()
       WHERE run_id = $1`,
      [runId, JSON.stringify(results), evaluations ? JSON.stringify(evaluations) : null,
       leaderboard ? JSON.stringify(leaderboard) : null]
    );
  },

  async setStatus(runId: string, status: BenchmarkRun['status'], durationMs?: number, totalCostCents?: number): Promise<void> {
    const completedAt = status === 'completed' || status === 'failed' ? new Date() : null;
    const startedAt = status === 'running' ? new Date() : null;

    await query(
      `UPDATE benchmark_runs
       SET status = $2, started_at = COALESCE($3, started_at), completed_at = COALESCE($4, completed_at),
           duration_ms = COALESCE($5, duration_ms), total_cost_cents = COALESCE($6, total_cost_cents),
           updated_at = NOW()
       WHERE run_id = $1`,
      [runId, status, startedAt, completedAt, durationMs, totalCostCents]
    );
  },

  async getRecent(limit = 20): Promise<BenchmarkRun[]> {
    return query<BenchmarkRun>(
      `SELECT id, run_id as "runId", models, tasks, enable_tools as "enableTools",
              results, evaluations, leaderboard, status, started_at as "startedAt",
              completed_at as "completedAt", duration_ms as "durationMs",
              total_cost_cents as "totalCostCents", created_at as "createdAt",
              updated_at as "updatedAt", created_by as "createdBy"
       FROM benchmark_runs
       ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
  },
};

// System Settings Repository
export interface SystemSetting {
  id: string;
  category: string;
  settingKey: string;
  settingValue: unknown;
  description: string | null;
  isSecret: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const settingsRepo = {
  async getAll(): Promise<SystemSetting[]> {
    return query<SystemSetting>(
      `SELECT id, category, setting_key as "settingKey", setting_value as "settingValue",
              description, is_secret as "isSecret", created_at as "createdAt", updated_at as "updatedAt"
       FROM system_settings
       ORDER BY category, setting_key`
    );
  },

  async getByCategory(category: string): Promise<SystemSetting[]> {
    return query<SystemSetting>(
      `SELECT id, category, setting_key as "settingKey", setting_value as "settingValue",
              description, is_secret as "isSecret", created_at as "createdAt", updated_at as "updatedAt"
       FROM system_settings WHERE category = $1
       ORDER BY setting_key`,
      [category]
    );
  },

  async get(category: string, key: string): Promise<SystemSetting | null> {
    return queryOne<SystemSetting>(
      `SELECT id, category, setting_key as "settingKey", setting_value as "settingValue",
              description, is_secret as "isSecret", created_at as "createdAt", updated_at as "updatedAt"
       FROM system_settings WHERE category = $1 AND setting_key = $2`,
      [category, key]
    );
  },

  async getValue<T = unknown>(category: string, key: string, defaultValue?: T): Promise<T> {
    const setting = await this.get(category, key);
    if (!setting) return defaultValue as T;
    return setting.settingValue as T;
  },

  async set(category: string, key: string, value: unknown, description?: string): Promise<SystemSetting> {
    const [result] = await query<SystemSetting>(
      `INSERT INTO system_settings (category, setting_key, setting_value, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (category, setting_key) DO UPDATE SET setting_value = $3, updated_at = NOW()
       RETURNING id, category, setting_key as "settingKey", setting_value as "settingValue",
                 description, is_secret as "isSecret", created_at as "createdAt", updated_at as "updatedAt"`,
      [category, key, JSON.stringify(value), description]
    );
    return result;
  },

  async delete(category: string, key: string): Promise<void> {
    await query(`DELETE FROM system_settings WHERE category = $1 AND setting_key = $2`, [category, key]);
  },

  async getCategories(): Promise<string[]> {
    const rows = await query<{ category: string }>(
      `SELECT DISTINCT category FROM system_settings ORDER BY category`
    );
    return rows.map(r => r.category);
  },

  // Convenience methods for common settings
  async getQueueDelays(): Promise<Record<string, number>> {
    const settings = await this.getByCategory('queue');
    const delays: Record<string, number> = {};
    for (const s of settings) {
      const priority = s.settingKey.replace('delay_', '');
      delays[priority] = typeof s.settingValue === 'number' ? s.settingValue : parseInt(String(s.settingValue), 10);
    }
    return delays;
  },

  async getAgentLoopIntervals(): Promise<Record<string, number>> {
    const settings = await this.getByCategory('agents');
    const intervals: Record<string, number> = {};
    for (const s of settings) {
      if (s.settingKey.startsWith('loop_interval_')) {
        const agent = s.settingKey.replace('loop_interval_', '');
        intervals[agent] = typeof s.settingValue === 'number' ? s.settingValue : parseInt(String(s.settingValue), 10);
      }
    }
    return intervals;
  },

  async getLLMSettings(): Promise<{
    routingStrategy: string;
    enableFallback: boolean;
    preferGemini: boolean;
    geminiDefaultModel: string;
  }> {
    const settings = await this.getByCategory('llm');
    const map = new Map(settings.map(s => [s.settingKey, s.settingValue]));
    return {
      routingStrategy: (map.get('routing_strategy') as string) || 'claude-only',
      enableFallback: map.get('enable_fallback') === true,
      preferGemini: map.get('prefer_gemini') === true,
      geminiDefaultModel: (map.get('gemini_default_model') as string) || 'gemini-2.5-flash',
    };
  },

  async getDecisionTimeouts(): Promise<{
    minor: number;
    major: number;
    critical: number;
  }> {
    const settings = await this.getByCategory('decisions');
    const map = new Map(settings.map(s => [s.settingKey, s.settingValue]));
    return {
      minor: Number(map.get('timeout_minor')) || 14400000,    // 4 hours
      major: Number(map.get('timeout_major')) || 86400000,    // 24 hours
      critical: Number(map.get('timeout_critical')) || 172800000, // 48 hours
    };
  },

  async getEscalationTimeouts(): Promise<{
    critical: number;
    high: number;
    normal: number;
  }> {
    const settings = await this.getByCategory('escalation');
    const map = new Map(settings.map(s => [s.settingKey, s.settingValue]));
    return {
      critical: Number(map.get('timeout_critical')) || 14400, // 4 hours
      high: Number(map.get('timeout_high')) || 43200,         // 12 hours
      normal: Number(map.get('timeout_normal')) || 86400,     // 24 hours
    };
  },

  async getTaskSettings(): Promise<{
    maxConcurrentPerAgent: number;
  }> {
    const value = await this.getValue<number>('tasks', 'max_concurrent_per_agent', 2);
    return {
      maxConcurrentPerAgent: Number(value) || 2,
    };
  },

  async getWorkspaceSettings(): Promise<{
    autoCommit: boolean;
    usePR: boolean;
    autoMerge: boolean;
    skipPR: boolean;
  }> {
    const settings = await this.getByCategory('workspace');
    const map = new Map(settings.map(s => [s.settingKey, s.settingValue]));
    return {
      autoCommit: map.get('auto_commit') === true || map.get('auto_commit') === 'true',
      usePR: map.get('use_pr') === true || map.get('use_pr') === 'true',
      autoMerge: map.get('auto_merge') === true || map.get('auto_merge') === 'true',
      skipPR: map.get('skip_pr') === true || map.get('skip_pr') === 'true',
    };
  },

  async getFeedbackSettings(): Promise<{
    operationalNotifyCeo: boolean;
    broadcastDecisions: boolean;
    targetedFeedback: boolean;
  }> {
    const settings = await this.getByCategory('feedback');
    const map = new Map(settings.map(s => [s.settingKey, s.settingValue]));
    return {
      operationalNotifyCeo: map.get('operational_notify_ceo') !== false && map.get('operational_notify_ceo') !== 'false',
      broadcastDecisions: map.get('broadcast_decisions') !== false && map.get('broadcast_decisions') !== 'false',
      targetedFeedback: map.get('targeted_feedback') !== false && map.get('targeted_feedback') !== 'false',
    };
  },

  async getInitiativeSettings(): Promise<{
    cooldownHours: number;
    maxPerDay: number;
    onlyOnScheduled: boolean;
  }> {
    const settings = await this.getByCategory('initiative');
    const map = new Map(settings.map(s => [s.settingKey, s.settingValue]));
    return {
      cooldownHours: Number(map.get('cooldown_hours')) || 4,
      maxPerDay: Number(map.get('max_per_day')) || 3,
      onlyOnScheduled: map.get('only_on_scheduled') !== false && map.get('only_on_scheduled') !== 'false',
    };
  },
};

// Health check
export async function checkConnection(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// Graceful shutdown
export async function closePool(): Promise<void> {
  await pool.end();
}

export { pool, query, queryOne, transaction };
