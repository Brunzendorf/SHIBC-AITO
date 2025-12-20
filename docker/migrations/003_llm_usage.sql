-- Migration: Add llm_usage table for persistent LLM usage tracking
-- Replaces volatile Redis-based quota tracking with persistent storage

-- Create table for LLM usage tracking
CREATE TABLE IF NOT EXISTS llm_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider VARCHAR(20) NOT NULL,       -- 'claude', 'gemini', 'ollama', etc.
    model VARCHAR(100),                   -- specific model used
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    agent_type VARCHAR(50),               -- denormalized for quick queries

    -- Token counts
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,

    -- Cost tracking (in cents to avoid floating point issues)
    cost_cents INTEGER DEFAULT 0,

    -- Performance metrics
    duration_ms INTEGER,

    -- Request details
    request_type VARCHAR(50),             -- 'loop', 'worker', 'benchmark', etc.
    success BOOLEAN DEFAULT true,
    error_message TEXT,

    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_llm_usage_provider ON llm_usage(provider);
CREATE INDEX IF NOT EXISTS idx_llm_usage_agent ON llm_usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_agent_type ON llm_usage(agent_type);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_success ON llm_usage(success);

-- Create index for monthly aggregation queries
CREATE INDEX IF NOT EXISTS idx_llm_usage_monthly ON llm_usage(
    provider,
    date_trunc('month', created_at)
);

-- Create materialized view for daily summaries (optional, for dashboard)
CREATE MATERIALIZED VIEW IF NOT EXISTS llm_usage_daily AS
SELECT
    date_trunc('day', created_at) as day,
    provider,
    agent_type,
    COUNT(*) as request_count,
    SUM(CASE WHEN success THEN 1 ELSE 0 END) as success_count,
    SUM(total_tokens) as total_tokens,
    SUM(cost_cents) as total_cost_cents,
    AVG(duration_ms)::INTEGER as avg_duration_ms
FROM llm_usage
GROUP BY date_trunc('day', created_at), provider, agent_type
WITH DATA;

-- Create unique index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_usage_daily_unique
ON llm_usage_daily(day, provider, agent_type);

-- Create function to refresh daily view
CREATE OR REPLACE FUNCTION refresh_llm_usage_daily()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY llm_usage_daily;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT ALL PRIVILEGES ON llm_usage TO aito;
GRANT ALL PRIVILEGES ON llm_usage_daily TO aito;

-- Add comments
COMMENT ON TABLE llm_usage IS 'Persistent LLM usage tracking for all providers (replaces Redis quota tracking)';
COMMENT ON COLUMN llm_usage.cost_cents IS 'Cost in cents (USD) to avoid floating point precision issues';
