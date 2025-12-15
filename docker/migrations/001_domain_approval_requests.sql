-- Migration: Add domain_approval_requests table
-- Run this on existing databases to add the domain approval workflow

-- Create table if not exists
CREATE TABLE IF NOT EXISTS domain_approval_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    requested_by VARCHAR(50) NOT NULL,
    task_context TEXT NOT NULL,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    reviewed_by VARCHAR(50),
    review_notes TEXT,
    suggested_category VARCHAR(50),
    security_score INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes if not exist
CREATE INDEX IF NOT EXISTS idx_domain_approval_status ON domain_approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_domain_approval_domain ON domain_approval_requests(domain);
CREATE INDEX IF NOT EXISTS idx_domain_approval_created ON domain_approval_requests(created_at DESC);

-- Create trigger for updated_at (if function exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'update_domain_approval_updated_at'
    ) THEN
        CREATE TRIGGER update_domain_approval_updated_at
            BEFORE UPDATE ON domain_approval_requests
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Grant permissions
GRANT ALL PRIVILEGES ON domain_approval_requests TO aito;
