-- Migration: Add agent_profiles table for database-managed agent profiles
-- This allows dashboard editing of agent profiles instead of file-based management

-- Create table for agent profiles
CREATE TABLE IF NOT EXISTS agent_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    version INTEGER DEFAULT 1,
    content TEXT NOT NULL,           -- Full markdown profile content
    identity JSONB DEFAULT '{}',     -- Role, codename, department, etc.
    mcp_servers JSONB DEFAULT '{}',  -- Allowed MCP servers with access flags
    capabilities JSONB DEFAULT '[]', -- List of agent capabilities
    constraints JSONB DEFAULT '[]',  -- List of agent constraints/limitations
    loop_actions JSONB DEFAULT '[]', -- Scheduled loop actions
    decision_authority JSONB DEFAULT '{}', -- Decision levels: minor, major, critical
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(50) DEFAULT 'system'
);

-- Create partial unique index for one active profile per agent
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profiles_unique_active
ON agent_profiles(agent_id) WHERE (is_active = true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_agent_profiles_agent_id ON agent_profiles(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_active ON agent_profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_version ON agent_profiles(agent_id, version DESC);

-- Create trigger for updated_at
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'update_agent_profiles_updated_at'
    ) THEN
        CREATE TRIGGER update_agent_profiles_updated_at
            BEFORE UPDATE ON agent_profiles
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Add version history trigger - increment version on new active profile
CREATE OR REPLACE FUNCTION increment_profile_version()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_active = true THEN
        -- Get max version for this agent
        SELECT COALESCE(MAX(version), 0) + 1 INTO NEW.version
        FROM agent_profiles WHERE agent_id = NEW.agent_id;

        -- Deactivate old profiles
        UPDATE agent_profiles
        SET is_active = false, updated_at = NOW()
        WHERE agent_id = NEW.agent_id AND is_active = true AND id != NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trigger_increment_profile_version'
    ) THEN
        CREATE TRIGGER trigger_increment_profile_version
            BEFORE INSERT ON agent_profiles
            FOR EACH ROW EXECUTE FUNCTION increment_profile_version();
    END IF;
END $$;

-- Grant permissions
GRANT ALL PRIVILEGES ON agent_profiles TO aito;

-- Add comment
COMMENT ON TABLE agent_profiles IS 'Stores agent profile configurations, replacing file-based .md profiles';
