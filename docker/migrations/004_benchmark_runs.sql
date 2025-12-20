-- Migration: Add benchmark_runs table for persistent benchmark results
-- Replaces Redis-based benchmark storage with persistent database

-- Create table for benchmark runs
CREATE TABLE IF NOT EXISTS benchmark_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id VARCHAR(50) NOT NULL UNIQUE,   -- External reference ID

    -- Configuration
    models JSONB NOT NULL DEFAULT '[]',    -- List of models tested
    tasks JSONB NOT NULL DEFAULT '[]',     -- List of tasks/prompts
    enable_tools BOOLEAN DEFAULT true,

    -- Results
    results JSONB NOT NULL DEFAULT '{}',   -- Raw results per model/task
    evaluations JSONB DEFAULT '{}',        -- Evaluation scores
    leaderboard JSONB DEFAULT '[]',        -- Sorted rankings

    -- Metadata
    status VARCHAR(20) DEFAULT 'pending',  -- pending, running, completed, failed
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    duration_ms INTEGER,
    total_cost_cents INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(50) DEFAULT 'system'
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_run_id ON benchmark_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_status ON benchmark_runs(status);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_created ON benchmark_runs(created_at DESC);

-- Create trigger for updated_at
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'update_benchmark_runs_updated_at'
    ) THEN
        CREATE TRIGGER update_benchmark_runs_updated_at
            BEFORE UPDATE ON benchmark_runs
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Grant permissions
GRANT ALL PRIVILEGES ON benchmark_runs TO aito;

-- Add comments
COMMENT ON TABLE benchmark_runs IS 'Persistent storage for LLM benchmark results (replaces Redis)';
COMMENT ON COLUMN benchmark_runs.run_id IS 'External reference ID for benchmark run';
COMMENT ON COLUMN benchmark_runs.models IS 'JSON array of model configurations tested';
COMMENT ON COLUMN benchmark_runs.results IS 'JSON object with results keyed by model and task';
