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
