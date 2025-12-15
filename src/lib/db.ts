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
