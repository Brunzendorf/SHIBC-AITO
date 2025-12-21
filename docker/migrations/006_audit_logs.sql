-- TASK-007: Audit Log for Sensitive Actions
-- Immutable audit trail for compliance-relevant agent actions

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Who performed the action
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    agent_type VARCHAR(50) NOT NULL,
    -- What action was performed
    action_type VARCHAR(50) NOT NULL,  -- merge_pr, vote, spawn_worker, etc.
    -- Action details (immutable JSON)
    action_data JSONB NOT NULL,
    -- Result of the action
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    -- Correlation for tracing
    correlation_id VARCHAR(100),
    -- Timestamp (immutable)
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_audit_logs_agent ON audit_logs(agent_id);
CREATE INDEX idx_audit_logs_agent_type ON audit_logs(agent_type);
CREATE INDEX idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_correlation ON audit_logs(correlation_id) WHERE correlation_id IS NOT NULL;

-- Prevent updates and deletes for immutability
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are immutable and cannot be modified or deleted';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_modification();

COMMENT ON TABLE audit_logs IS 'Immutable audit trail for compliance-relevant agent actions';
