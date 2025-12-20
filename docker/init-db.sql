-- AITO 2.0 Database Schema
-- PostgreSQL 15 with pgvector extension

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================
-- CORE TABLES
-- ============================================

-- Agent Definitions
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    profile_path VARCHAR(255),
    loop_interval INTEGER DEFAULT 3600,
    git_repo VARCHAR(255),
    git_filter VARCHAR(255),
    status VARCHAR(20) DEFAULT 'inactive',
    container_id VARCHAR(100),
    last_heartbeat TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Agent State (Persistent Memory)
CREATE TABLE agent_state (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    state_key VARCHAR(255) NOT NULL,
    state_value JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(agent_id, state_key)
);

-- Agent History (RAG Source)
CREATE TABLE agent_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL,
    summary TEXT NOT NULL,
    details JSONB,
    embedding VECTOR(1536),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agent_history_agent ON agent_history(agent_id);
CREATE INDEX idx_agent_history_type ON agent_history(action_type);
CREATE INDEX idx_agent_history_created ON agent_history(created_at DESC);
CREATE INDEX idx_agent_history_embedding ON agent_history USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Decisions (Veto Process)
CREATE TABLE decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    proposed_by UUID REFERENCES agents(id),
    decision_type VARCHAR(50) DEFAULT 'major',
    status VARCHAR(20) DEFAULT 'pending',
    veto_round INTEGER DEFAULT 0,
    ceo_vote VARCHAR(20),
    dao_vote VARCHAR(20),
    c_level_votes JSONB,
    human_decision VARCHAR(20),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_decisions_status ON decisions(status);
CREATE INDEX idx_decisions_created ON decisions(created_at DESC);

-- Tasks
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assigned_to UUID REFERENCES agents(id),
    created_by UUID REFERENCES agents(id),
    status VARCHAR(20) DEFAULT 'pending',
    priority INTEGER DEFAULT 5,
    due_date TIMESTAMP,
    completed_at TIMESTAMP,
    result JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);

-- Events (Audit Log)
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(50) NOT NULL,
    source_agent UUID REFERENCES agents(id),
    target_agent UUID REFERENCES agents(id),
    payload JSONB,
    correlation_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_source ON events(source_agent);
CREATE INDEX idx_events_target ON events(target_agent);
CREATE INDEX idx_events_created ON events(created_at DESC);
CREATE INDEX idx_events_correlation ON events(correlation_id);

-- Human Escalations
CREATE TABLE escalations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    decision_id UUID REFERENCES decisions(id),
    reason TEXT NOT NULL,
    channels_notified JSONB DEFAULT '[]',
    human_response TEXT,
    responded_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_escalations_status ON escalations(status);
CREATE INDEX idx_escalations_created ON escalations(created_at DESC);

-- ============================================
-- ADDITIONAL TABLES
-- ============================================

-- Translation Cache
CREATE TABLE translations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_text TEXT NOT NULL,
    source_lang VARCHAR(5) DEFAULT 'en',
    target_lang VARCHAR(5) NOT NULL,
    translated_text TEXT NOT NULL,
    source_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(source_hash, target_lang)
);

CREATE INDEX idx_translations_hash ON translations(source_hash);

-- API Response Cache
CREATE TABLE api_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint VARCHAR(255) NOT NULL,
    params_hash VARCHAR(64) NOT NULL,
    response JSONB NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(endpoint, params_hash)
);

CREATE INDEX idx_api_cache_expires ON api_cache(expires_at);

-- Metrics Time Series
CREATE TABLE metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_name VARCHAR(100) NOT NULL,
    metric_value NUMERIC NOT NULL,
    labels JSONB DEFAULT '{}',
    recorded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_metrics_name_time ON metrics(metric_name, recorded_at DESC);

-- N8N Workflow Executions Log
CREATE TABLE workflow_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id VARCHAR(100) NOT NULL,
    workflow_name VARCHAR(255),
    trigger_type VARCHAR(50),
    input_data JSONB,
    output_data JSONB,
    status VARCHAR(20),
    error_message TEXT,
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX idx_workflow_status ON workflow_executions(status);
CREATE INDEX idx_workflow_started ON workflow_executions(started_at DESC);

-- ============================================
-- DOMAIN WHITELIST (Security)
-- ============================================
-- Dynamic whitelist for trusted domains that workers can access

CREATE TABLE domain_whitelist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain VARCHAR(255) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    added_by VARCHAR(50) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_domain_active ON domain_whitelist(is_active);
CREATE INDEX idx_domain_category ON domain_whitelist(category);

CREATE TRIGGER update_domain_whitelist_updated_at
    BEFORE UPDATE ON domain_whitelist
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- DOMAIN APPROVAL REQUESTS
-- ============================================
-- Pending approval requests for non-whitelisted domains

CREATE TABLE domain_approval_requests (
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

CREATE INDEX idx_domain_approval_status ON domain_approval_requests(status);
CREATE INDEX idx_domain_approval_domain ON domain_approval_requests(domain);
CREATE INDEX idx_domain_approval_created ON domain_approval_requests(created_at DESC);

CREATE TRIGGER update_domain_approval_updated_at
    BEFORE UPDATE ON domain_approval_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SEED DATA: Default Agents
-- ============================================

INSERT INTO agents (type, name, profile_path, loop_interval, status) VALUES
    ('ceo', 'CEO Agent', '/profiles/ceo.md', 3600, 'inactive'),
    ('dao', 'DAO Agent', '/profiles/dao.md', 21600, 'inactive'),
    ('cmo', 'CMO Agent', '/profiles/cmo.md', 14400, 'inactive'),
    ('cto', 'CTO Agent', '/profiles/cto.md', 3600, 'inactive'),
    ('cfo', 'CFO Agent', '/profiles/cfo.md', 21600, 'inactive'),
    ('coo', 'COO Agent', '/profiles/coo.md', 7200, 'inactive'),
    ('cco', 'CCO Agent', '/profiles/cco.md', 86400, 'inactive');

-- ============================================
-- SEED DATA: Domain Whitelist
-- ============================================

INSERT INTO domain_whitelist (domain, category, description) VALUES
    -- Crypto Data Providers (API)
    ('api.coingecko.com', 'crypto_data', 'CoinGecko API - Cryptocurrency prices and market data'),
    ('pro-api.coinmarketcap.com', 'crypto_data', 'CoinMarketCap Pro API'),
    ('api.etherscan.io', 'blockchain', 'Etherscan API - Ethereum blockchain data'),
    ('api-etc.etcmainnet.ethereumclassic.org', 'blockchain', 'ETC Mainnet API'),

    -- Official Info Sources
    ('coingecko.com', 'crypto_data', 'CoinGecko website'),
    ('coinmarketcap.com', 'crypto_data', 'CoinMarketCap website'),
    ('etherscan.io', 'blockchain', 'Etherscan block explorer'),
    ('blockscout.com', 'blockchain', 'Blockscout explorer'),
    ('dexscreener.com', 'crypto_data', 'DEX Screener - DEX analytics'),

    -- News & Content (Trusted)
    ('cointelegraph.com', 'news', 'Cointelegraph - Crypto news'),
    ('coindesk.com', 'news', 'CoinDesk - Crypto news'),
    ('theblock.co', 'news', 'The Block - Crypto news'),
    ('decrypt.co', 'news', 'Decrypt - Crypto news'),
    ('cryptonews.com', 'news', 'Crypto News'),

    -- Social (Read-Only)
    ('twitter.com', 'social', 'Twitter/X'),
    ('x.com', 'social', 'X (Twitter)'),
    ('reddit.com', 'social', 'Reddit'),
    ('telegram.org', 'social', 'Telegram'),
    ('t.me', 'social', 'Telegram short links'),

    -- GitHub (Official)
    ('github.com', 'development', 'GitHub repositories'),
    ('raw.githubusercontent.com', 'development', 'GitHub raw content'),

    -- Our Own Infrastructure
    ('shibaclassic.io', 'internal', 'Shiba Classic official website'),
    ('directus.shibaclassic.io', 'internal', 'Directus CMS'),
    ('api.shibaclassic.io', 'internal', 'Shiba Classic API'),

    -- Ethereum Classic
    ('ethereumclassic.org', 'blockchain', 'Ethereum Classic official'),

    -- Audit Providers (Trusted)
    ('certik.com', 'audit', 'CertiK - Security audits'),
    ('hacken.io', 'audit', 'Hacken - Security audits'),
    ('solidproof.io', 'audit', 'SolidProof - Security audits'),
    ('cyberscope.io', 'audit', 'Cyberscope - Security audits');

-- ============================================
-- SYSTEM SETTINGS
-- ============================================
-- Key-value store for system configuration that can be changed at runtime

CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(50) NOT NULL,
    setting_key VARCHAR(100) NOT NULL,
    setting_value JSONB NOT NULL,
    description TEXT,
    is_secret BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(category, setting_key)
);

CREATE INDEX idx_settings_category ON system_settings(category);
CREATE INDEX idx_settings_key ON system_settings(setting_key);

-- Note: Trigger created after function definition below

-- SEED: Default System Settings
INSERT INTO system_settings (category, setting_key, setting_value, description) VALUES
    -- Queue Delays (milliseconds)
    ('queue', 'delay_critical', '0', 'Delay for critical priority tasks (immediate)'),
    ('queue', 'delay_urgent', '5000', 'Delay for urgent priority tasks (5 seconds)'),
    ('queue', 'delay_high', '30000', 'Delay for high priority tasks (30 seconds)'),
    ('queue', 'delay_normal', '120000', 'Delay for normal priority tasks (2 minutes)'),
    ('queue', 'delay_low', '300000', 'Delay for low priority tasks (5 minutes)'),
    ('queue', 'delay_operational', '600000', 'Delay for operational tasks (10 minutes)'),

    -- Agent Loop Intervals (seconds)
    ('agents', 'loop_interval_ceo', '1800', 'CEO loop interval (30 minutes)'),
    ('agents', 'loop_interval_dao', '14400', 'DAO loop interval (4 hours)'),
    ('agents', 'loop_interval_cmo', '7200', 'CMO loop interval (2 hours)'),
    ('agents', 'loop_interval_cto', '3600', 'CTO loop interval (1 hour)'),
    ('agents', 'loop_interval_cfo', '14400', 'CFO loop interval (4 hours)'),
    ('agents', 'loop_interval_coo', '3600', 'COO loop interval (1 hour)'),
    ('agents', 'loop_interval_cco', '43200', 'CCO loop interval (12 hours)'),

    -- LLM Routing
    ('llm', 'routing_strategy', '"claude-only"', 'LLM routing strategy: claude-only, task-type, agent-role, gemini-prefer'),
    ('llm', 'enable_fallback', 'false', 'Enable fallback to alternative LLM if primary fails'),
    ('llm', 'prefer_gemini', 'false', 'Prefer Gemini for cost optimization'),
    ('llm', 'gemini_default_model', '"gemini-2.5-flash"', 'Default Gemini model'),

    -- Feedback Routing
    ('feedback', 'operational_notify_ceo', 'true', 'Notify CEO on operational task completion'),
    ('feedback', 'broadcast_decisions', 'true', 'Broadcast decision results to all agents'),
    ('feedback', 'targeted_feedback', 'true', 'Use targeted feedback instead of broadcast'),

    -- Initiative Settings
    ('initiative', 'cooldown_hours', '4', 'Hours between initiative generation'),
    ('initiative', 'max_per_day', '3', 'Maximum initiatives per agent per day'),
    ('initiative', 'only_on_scheduled', 'true', 'Only generate initiatives during scheduled loops'),

    -- Decision Timeouts (milliseconds)
    ('decisions', 'timeout_minor', '14400000', 'Minor decision timeout - 4 hours (auto-approve)'),
    ('decisions', 'timeout_major', '86400000', 'Major decision timeout - 24 hours (escalate)'),
    ('decisions', 'timeout_critical', '172800000', 'Critical decision timeout - 48 hours (escalate)'),

    -- Escalation Timeouts (seconds)
    ('escalation', 'timeout_critical', '14400', 'Critical escalation timeout - 4 hours'),
    ('escalation', 'timeout_high', '43200', 'High escalation timeout - 12 hours'),
    ('escalation', 'timeout_normal', '86400', 'Normal escalation timeout - 24 hours'),

    -- Task Limits
    ('tasks', 'max_concurrent_per_agent', '2', 'Maximum concurrent in-progress tasks per agent'),

    -- Workspace Settings
    ('workspace', 'auto_commit', 'true', 'Auto-commit on file changes'),
    ('workspace', 'use_pr', 'true', 'Use branch+PR workflow for quality gate'),
    ('workspace', 'auto_merge', 'false', 'Auto-merge PRs after RAG approval'),
    ('workspace', 'skip_pr', 'false', 'Bypass PR workflow - direct push');

-- ============================================
-- FUNCTIONS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_state_updated_at
    BEFORE UPDATE ON agent_state
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Clean up expired cache entries (run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS void AS $$
BEGIN
    DELETE FROM api_cache WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- GRANTS
-- ============================================

-- Grant all privileges to aito user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO aito;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO aito;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO aito;
