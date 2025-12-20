-- Migration: Add worker_executions table for MCP worker execution history
-- Provides persistent logging of all worker tasks and their outcomes

-- Create table for worker executions
CREATE TABLE IF NOT EXISTS worker_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id VARCHAR(100),               -- Worker process/container ID
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    agent_type VARCHAR(50),               -- Denormalized for quick queries

    -- Task details
    task TEXT NOT NULL,                   -- Task description/prompt
    mcp_servers TEXT[] DEFAULT '{}',      -- MCP servers used

    -- Execution results
    output TEXT,                          -- Worker output/result
    success BOOLEAN DEFAULT false,
    error_message TEXT,

    -- Performance
    duration_ms INTEGER,
    token_count INTEGER,

    -- Metadata
    correlation_id VARCHAR(100),          -- Link to parent task/event
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_worker_exec_agent ON worker_executions(agent_id);
CREATE INDEX IF NOT EXISTS idx_worker_exec_agent_type ON worker_executions(agent_type);
CREATE INDEX IF NOT EXISTS idx_worker_exec_success ON worker_executions(success);
CREATE INDEX IF NOT EXISTS idx_worker_exec_created ON worker_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_exec_correlation ON worker_executions(correlation_id);
CREATE INDEX IF NOT EXISTS idx_worker_exec_servers ON worker_executions USING GIN(mcp_servers);

-- Create materialized view for worker stats by agent
CREATE MATERIALIZED VIEW IF NOT EXISTS worker_stats_by_agent AS
SELECT
    agent_type,
    COUNT(*) as total_executions,
    SUM(CASE WHEN success THEN 1 ELSE 0 END) as success_count,
    SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as failure_count,
    ROUND(AVG(duration_ms))::INTEGER as avg_duration_ms,
    SUM(token_count) as total_tokens,
    MAX(created_at) as last_execution
FROM worker_executions
WHERE agent_type IS NOT NULL
GROUP BY agent_type
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_stats_agent_type
ON worker_stats_by_agent(agent_type);

-- Create function to refresh stats view
CREATE OR REPLACE FUNCTION refresh_worker_stats()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY worker_stats_by_agent;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT ALL PRIVILEGES ON worker_executions TO aito;
GRANT ALL PRIVILEGES ON worker_stats_by_agent TO aito;

-- Add comments
COMMENT ON TABLE worker_executions IS 'Persistent log of MCP worker executions (replaces Redis logs)';
COMMENT ON COLUMN worker_executions.mcp_servers IS 'Array of MCP servers used for this worker task';
COMMENT ON COLUMN worker_executions.correlation_id IS 'Links worker to originating agent loop or task';
