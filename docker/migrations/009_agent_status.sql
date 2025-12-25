-- Migration 009: Agent Status Service Tables
-- Purpose: Persistent storage for agent status updates (TASK-108)
-- Replaces: workspace loop-XXX.md files and "proof" GitHub issues

-- Agent status history table
CREATE TABLE IF NOT EXISTS agent_status (
  id SERIAL PRIMARY KEY,
  agent_type VARCHAR(10) NOT NULL,           -- ceo, cmo, cto, cfo, coo, cco, dao
  loop_number INTEGER NOT NULL,
  status_type VARCHAR(20) NOT NULL,          -- working, idle, blocked, completed
  activity TEXT NOT NULL,                     -- "Executing Q1 webinar planning"
  details JSONB,                              -- Additional structured data
  issue_ref INTEGER,                          -- Optional: GitHub Issue # being worked on
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_agent_status_agent ON agent_status(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_status_created ON agent_status(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_status_agent_created ON agent_status(agent_type, created_at DESC);

-- Current heartbeat table (one row per agent)
CREATE TABLE IF NOT EXISTS agent_heartbeat (
  agent_type VARCHAR(10) PRIMARY KEY,
  loop_number INTEGER NOT NULL DEFAULT 0,
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  current_status VARCHAR(20) DEFAULT 'idle',
  current_activity TEXT
);

-- Insert initial heartbeat rows for all agents
INSERT INTO agent_heartbeat (agent_type, loop_number, current_status, current_activity)
VALUES
  ('ceo', 0, 'idle', 'Initializing'),
  ('cmo', 0, 'idle', 'Initializing'),
  ('cto', 0, 'idle', 'Initializing'),
  ('cfo', 0, 'idle', 'Initializing'),
  ('coo', 0, 'idle', 'Initializing'),
  ('cco', 0, 'idle', 'Initializing'),
  ('dao', 0, 'idle', 'Initializing')
ON CONFLICT (agent_type) DO NOTHING;

-- Retention policy function (keep 30 days of data)
CREATE OR REPLACE FUNCTION cleanup_old_status()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM agent_status
  WHERE created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Helper view for dashboard
CREATE OR REPLACE VIEW agent_status_summary AS
SELECT
  h.agent_type,
  h.loop_number,
  h.current_status,
  h.current_activity,
  h.last_seen,
  EXTRACT(EPOCH FROM (NOW() - h.last_seen)) as seconds_since_seen,
  CASE
    WHEN h.last_seen > NOW() - INTERVAL '5 minutes' THEN 'online'
    WHEN h.last_seen > NOW() - INTERVAL '30 minutes' THEN 'away'
    ELSE 'offline'
  END as presence,
  (SELECT COUNT(*) FROM agent_status s WHERE s.agent_type = h.agent_type AND s.created_at > NOW() - INTERVAL '24 hours') as actions_24h
FROM agent_heartbeat h
ORDER BY h.agent_type;
