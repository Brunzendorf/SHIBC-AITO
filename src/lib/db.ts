import { Pool, PoolClient } from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';
import type {
  Agent,
  AgentState,
  AgentHistory,
  Decision,
  Task,
  Event,
  Escalation,
  AgentType,
  AgentStatus,
  DecisionStatus,
  TaskStatus,
  EscalationStatus,
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

  async getAll(agentId: string): Promise<Record<string, unknown>> {
    const rows = await query<{ stateKey: string; stateValue: unknown }>(
      `SELECT state_key as "stateKey", state_value as "stateValue" FROM agent_state WHERE agent_id = $1`,
      [agentId]
    );
    return Object.fromEntries(rows.map((r) => [r.stateKey, r.stateValue]));
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
      `INSERT INTO events (event_type, source_agent, target_agent, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING id, event_type as "eventType", source_agent as "sourceAgent",
                 target_agent as "targetAgent", payload, created_at as "createdAt"`,
      [event.eventType, event.sourceAgent, event.targetAgent, JSON.stringify(event.payload)]
    );
    return result;
  },

  async getRecent(limit = 100): Promise<Event[]> {
    return query<Event>(
      `SELECT id, event_type as "eventType", source_agent as "sourceAgent",
              target_agent as "targetAgent", payload, created_at as "createdAt"
       FROM events ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
  },

  async getByAgent(agentId: string, limit = 50): Promise<Event[]> {
    return query<Event>(
      `SELECT id, event_type as "eventType", source_agent as "sourceAgent",
              target_agent as "targetAgent", payload, created_at as "createdAt"
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
