-- Migration: 010_state_machines.sql
-- Description: Deterministic State Machines for Agent Workflows (TASK-109)
-- Created: 2025-12-26

-- ============================================================================
-- STATE MACHINE DEFINITIONS (Templates)
-- ============================================================================
-- Stores workflow templates that can be instantiated for each agent

CREATE TABLE IF NOT EXISTS state_machine_definitions (
    id SERIAL PRIMARY KEY,

    -- Identification
    type VARCHAR(50) UNIQUE NOT NULL,           -- e.g., 'cto_build_project', 'cmo_campaign'
    agent_type VARCHAR(10) NOT NULL,            -- 'ceo', 'cmo', 'cto', 'cfo', 'coo', 'cco', 'dao'
    name VARCHAR(100) NOT NULL,                 -- Human-readable name
    description TEXT,

    -- Workflow Definition
    initial_state VARCHAR(50) NOT NULL,         -- Starting state
    states JSONB NOT NULL,                      -- Array of StateDefinition objects
    /*
        states: [{
            name: "WRITE_CODE",
            description: "Implement the feature",
            agentPrompt: "Create the code for...",
            requiredOutput: ["filesCreated", "buildSuccess"],
            onSuccess: "RUN_TESTS",
            onFailure: "WRITE_CODE",  -- retry
            timeout: 300000,
            maxRetries: 3
        }, ...]
    */

    -- Triggers
    trigger_type VARCHAR(30) NOT NULL DEFAULT 'manual',  -- 'manual', 'issue_assigned', 'scheduled', 'event'
    trigger_config JSONB,                       -- Trigger-specific config (cron, issue labels, etc.)

    -- Metadata
    version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- STATE MACHINE INSTANCES (Running Workflows)
-- ============================================================================
-- Each instance is a running workflow for a specific task

CREATE TABLE IF NOT EXISTS state_machines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Reference to definition
    definition_id INTEGER REFERENCES state_machine_definitions(id),
    definition_type VARCHAR(50) NOT NULL,       -- Denormalized for quick access

    -- Target agent
    agent_type VARCHAR(10) NOT NULL,
    agent_id UUID,                              -- Optional: specific agent instance

    -- Current state
    current_state VARCHAR(50) NOT NULL,
    previous_state VARCHAR(50),

    -- Context (persisted across states)
    context JSONB NOT NULL DEFAULT '{}',
    /*
        context: {
            projectName: "sla-api",
            projectPath: "/app/projects/sla-api",
            githubIssue: 726,
            specPath: "...",
            retryCount: 0,
            maxRetries: 3,
            ...custom fields
        }
    */

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'running',  -- 'pending', 'running', 'paused', 'completed', 'failed', 'cancelled'

    -- Timing
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,

    -- Timeout tracking
    state_entered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    state_timeout_at TIMESTAMP WITH TIME ZONE,

    -- External references
    github_issue INTEGER,
    github_repo VARCHAR(100),

    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    -- Priority for queue ordering
    priority INTEGER DEFAULT 50                  -- 0=highest, 100=lowest
);

-- ============================================================================
-- STATE TRANSITIONS (Audit Trail)
-- ============================================================================
-- Complete history of all state changes

CREATE TABLE IF NOT EXISTS state_transitions (
    id SERIAL PRIMARY KEY,

    -- Reference
    machine_id UUID NOT NULL REFERENCES state_machines(id) ON DELETE CASCADE,

    -- Transition details
    from_state VARCHAR(50),                     -- NULL for initial state
    to_state VARCHAR(50) NOT NULL,

    -- Outcome
    success BOOLEAN NOT NULL,

    -- Agent response
    agent_output JSONB,                         -- What the agent returned
    /*
        agent_output: {
            filesCreated: ["src/index.ts"],
            buildSuccess: true,
            tokensUsed: 15000,
            ...
        }
    */

    -- Error details (if failed)
    error_message TEXT,
    error_code VARCHAR(50),

    -- Timing
    duration_ms INTEGER,                        -- How long the state took
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Retry tracking
    attempt_number INTEGER DEFAULT 1
);

-- ============================================================================
-- STATE MACHINE QUEUE (Pending Tasks)
-- ============================================================================
-- Tasks waiting to be sent to agents

CREATE TABLE IF NOT EXISTS state_machine_queue (
    id SERIAL PRIMARY KEY,

    machine_id UUID NOT NULL REFERENCES state_machines(id) ON DELETE CASCADE,

    -- Target
    agent_type VARCHAR(10) NOT NULL,

    -- Task payload (what to send to agent)
    task_payload JSONB NOT NULL,
    /*
        task_payload: {
            type: "state_task",
            machineId: "...",
            state: "WRITE_CODE",
            context: {...},
            prompt: "...",
            requiredOutput: [...],
            timeout: 300000
        }
    */

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'sent', 'acknowledged', 'timeout'

    -- Timing
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sent_at TIMESTAMP WITH TIME ZONE,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    timeout_at TIMESTAMP WITH TIME ZONE,

    -- Retry
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3
);

-- ============================================================================
-- SCHEDULED WORKFLOWS
-- ============================================================================
-- For periodic workflows (daily reports, health checks, etc.)

CREATE TABLE IF NOT EXISTS scheduled_workflows (
    id SERIAL PRIMARY KEY,

    -- Reference to definition
    definition_id INTEGER NOT NULL REFERENCES state_machine_definitions(id),
    definition_type VARCHAR(50) NOT NULL,

    -- Schedule (cron format)
    cron_expression VARCHAR(50) NOT NULL,       -- e.g., '0 9 * * *' for daily 9am
    timezone VARCHAR(50) DEFAULT 'UTC',

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Last execution
    last_run_at TIMESTAMP WITH TIME ZONE,
    last_machine_id UUID REFERENCES state_machines(id),
    last_status VARCHAR(20),

    -- Next execution
    next_run_at TIMESTAMP WITH TIME ZONE,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- State machines
CREATE INDEX IF NOT EXISTS idx_state_machines_agent ON state_machines(agent_type, status);
CREATE INDEX IF NOT EXISTS idx_state_machines_status ON state_machines(status, priority);
CREATE INDEX IF NOT EXISTS idx_state_machines_github ON state_machines(github_issue) WHERE github_issue IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_state_machines_timeout ON state_machines(state_timeout_at) WHERE status = 'running';

-- Transitions
CREATE INDEX IF NOT EXISTS idx_transitions_machine ON state_transitions(machine_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transitions_state ON state_transitions(to_state, created_at DESC);

-- Queue
CREATE INDEX IF NOT EXISTS idx_queue_pending ON state_machine_queue(agent_type, status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_queue_timeout ON state_machine_queue(timeout_at) WHERE status = 'sent';

-- Scheduled
CREATE INDEX IF NOT EXISTS idx_scheduled_next ON scheduled_workflows(next_run_at) WHERE is_active = true;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_state_machine_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-update timestamps
DROP TRIGGER IF EXISTS trigger_state_machines_updated ON state_machines;
CREATE TRIGGER trigger_state_machines_updated
    BEFORE UPDATE ON state_machines
    FOR EACH ROW
    EXECUTE FUNCTION update_state_machine_timestamp();

DROP TRIGGER IF EXISTS trigger_definitions_updated ON state_machine_definitions;
CREATE TRIGGER trigger_definitions_updated
    BEFORE UPDATE ON state_machine_definitions
    FOR EACH ROW
    EXECUTE FUNCTION update_state_machine_timestamp();

-- ============================================================================
-- INITIAL WORKFLOW DEFINITIONS
-- ============================================================================

-- CTO: BUILD_PROJECT
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'cto_build_project',
    'cto',
    'Build Project',
    'Complete workflow from issue to deployed project',
    'ANALYZE_ISSUE',
    '[
        {"name": "ANALYZE_ISSUE", "description": "Read and understand the issue", "agentPrompt": "Analyze GitHub issue #{issue}. Determine scope, complexity, and whether a spec is needed. Output: needsSpec (boolean), complexity (low/medium/high), summary.", "requiredOutput": ["needsSpec", "complexity", "summary"], "onSuccess": "WRITE_SPEC", "onFailure": "ANALYZE_ISSUE", "timeout": 120000, "maxRetries": 2},
        {"name": "WRITE_SPEC", "description": "Write technical specification (optional)", "agentPrompt": "Write a technical spec for: {summary}. Save to workspace/SHIBC-CTO-001/specs/. Skip if needsSpec=false.", "requiredOutput": ["specPath"], "onSuccess": "CREATE_PROJECT", "onFailure": "WRITE_SPEC", "timeout": 300000, "maxRetries": 2, "skipIf": "!context.needsSpec"},
        {"name": "CREATE_PROJECT", "description": "Initialize project structure", "agentPrompt": "Create project at /app/projects/{projectName}/. Run: mkdir, npm init, git init, install dependencies.", "requiredOutput": ["projectPath", "initialized"], "onSuccess": "WRITE_CODE", "onFailure": "CREATE_PROJECT", "timeout": 180000, "maxRetries": 2},
        {"name": "WRITE_CODE", "description": "Implement the feature", "agentPrompt": "Implement the feature in {projectPath} according to spec. Create source files, write tests.", "requiredOutput": ["filesCreated", "buildSuccess"], "onSuccess": "RUN_TESTS", "onFailure": "WRITE_CODE", "timeout": 600000, "maxRetries": 3},
        {"name": "RUN_TESTS", "description": "Run test suite", "agentPrompt": "Run npm test in {projectPath}. All tests must pass.", "requiredOutput": ["testsPassed", "coverage"], "onSuccess": "COMMIT_PUSH", "onFailure": "WRITE_CODE", "timeout": 180000, "maxRetries": 1},
        {"name": "COMMIT_PUSH", "description": "Commit and push to GitHub", "agentPrompt": "Git add, commit with descriptive message, push to origin.", "requiredOutput": ["commitHash", "pushed"], "onSuccess": "DEPLOY_STAGING", "onFailure": "COMMIT_PUSH", "timeout": 60000, "maxRetries": 2},
        {"name": "DEPLOY_STAGING", "description": "Deploy to staging environment", "agentPrompt": "Deploy {projectName} to staging using Portainer or Woodpecker.", "requiredOutput": ["stagingUrl", "deployed"], "onSuccess": "VERIFY_STAGING", "onFailure": "DEPLOY_STAGING", "timeout": 300000, "maxRetries": 2},
        {"name": "VERIFY_STAGING", "description": "Verify staging deployment", "agentPrompt": "Test staging deployment at {stagingUrl}. Use Playwright to verify functionality.", "requiredOutput": ["verified", "testResults"], "onSuccess": "DEPLOY_PROD", "onFailure": "WRITE_CODE", "timeout": 180000, "maxRetries": 1},
        {"name": "DEPLOY_PROD", "description": "Deploy to production", "agentPrompt": "Deploy {projectName} to production. Verify deployment succeeded.", "requiredOutput": ["prodUrl", "deployed"], "onSuccess": "COMPLETE", "onFailure": "DEPLOY_PROD", "timeout": 300000, "maxRetries": 2},
        {"name": "COMPLETE", "description": "Mark issue as done", "agentPrompt": "Close GitHub issue #{issue}. Notify CEO of completion.", "requiredOutput": ["issueClosed", "notified"], "onSuccess": null, "onFailure": null, "timeout": 60000, "maxRetries": 1}
    ]'::jsonb,
    'issue_assigned',
    '{"labels": ["technical", "feature", "enhancement"]}'::jsonb
) ON CONFLICT (type) DO NOTHING;

-- CTO: FIX_BUG
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'cto_fix_bug',
    'cto',
    'Fix Bug',
    'Bug fix workflow from report to deployment',
    'ANALYZE_BUG',
    '[
        {"name": "ANALYZE_BUG", "description": "Understand the bug", "agentPrompt": "Analyze bug report #{issue}. Identify symptoms, potential causes.", "requiredOutput": ["symptoms", "potentialCauses"], "onSuccess": "LOCATE_CODE", "onFailure": "ANALYZE_BUG", "timeout": 120000, "maxRetries": 2},
        {"name": "LOCATE_CODE", "description": "Find buggy code", "agentPrompt": "Locate the code causing the bug. Use grep, read files.", "requiredOutput": ["filePath", "lineNumbers"], "onSuccess": "WRITE_FIX", "onFailure": "ANALYZE_BUG", "timeout": 180000, "maxRetries": 2},
        {"name": "WRITE_FIX", "description": "Implement fix", "agentPrompt": "Fix the bug in {filePath}. Add regression test.", "requiredOutput": ["fixApplied", "testAdded"], "onSuccess": "RUN_TESTS", "onFailure": "WRITE_FIX", "timeout": 300000, "maxRetries": 3},
        {"name": "RUN_TESTS", "description": "Verify fix", "agentPrompt": "Run tests to verify fix and check for regressions.", "requiredOutput": ["testsPassed"], "onSuccess": "COMMIT_PUSH", "onFailure": "WRITE_FIX", "timeout": 180000, "maxRetries": 1},
        {"name": "COMMIT_PUSH", "description": "Commit fix", "agentPrompt": "Commit with message: fix: {bugSummary} (#{issue})", "requiredOutput": ["commitHash"], "onSuccess": "DEPLOY", "onFailure": "COMMIT_PUSH", "timeout": 60000, "maxRetries": 2},
        {"name": "DEPLOY", "description": "Deploy fix", "agentPrompt": "Deploy fix to production.", "requiredOutput": ["deployed"], "onSuccess": "COMPLETE", "onFailure": "DEPLOY", "timeout": 300000, "maxRetries": 2},
        {"name": "COMPLETE", "description": "Close bug", "agentPrompt": "Close issue, notify reporter.", "requiredOutput": ["closed"], "onSuccess": null, "onFailure": null, "timeout": 60000, "maxRetries": 1}
    ]'::jsonb,
    'issue_assigned',
    '{"labels": ["bug"]}'::jsonb
) ON CONFLICT (type) DO NOTHING;

-- CMO: CAMPAIGN_EXECUTION
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'cmo_campaign',
    'cmo',
    'Campaign Execution',
    'Execute marketing campaign from brief to report',
    'ANALYZE_BRIEF',
    '[
        {"name": "ANALYZE_BRIEF", "description": "Understand campaign goals", "agentPrompt": "Analyze campaign brief #{issue}. Identify target audience, key messages, channels.", "requiredOutput": ["audience", "messages", "channels"], "onSuccess": "CREATE_CONTENT", "onFailure": "ANALYZE_BRIEF", "timeout": 120000, "maxRetries": 2},
        {"name": "CREATE_CONTENT", "description": "Create campaign content", "agentPrompt": "Create content for {channels}. Write copy, generate images with Imagen.", "requiredOutput": ["copyDrafts", "images"], "onSuccess": "REVIEW_COMPLIANCE", "onFailure": "CREATE_CONTENT", "timeout": 600000, "maxRetries": 3},
        {"name": "REVIEW_COMPLIANCE", "description": "CCO compliance check", "agentPrompt": "Request CCO review for campaign content. Wait for approval.", "requiredOutput": ["approved", "feedback"], "onSuccess": "SCHEDULE_POSTS", "onFailure": "CREATE_CONTENT", "timeout": 300000, "maxRetries": 1},
        {"name": "SCHEDULE_POSTS", "description": "Schedule for optimal times", "agentPrompt": "Schedule posts for optimal engagement times on {channels}.", "requiredOutput": ["scheduled", "times"], "onSuccess": "EXECUTE", "onFailure": "SCHEDULE_POSTS", "timeout": 120000, "maxRetries": 2},
        {"name": "EXECUTE", "description": "Post content", "agentPrompt": "Execute scheduled posts to Telegram/Twitter.", "requiredOutput": ["posted", "postIds"], "onSuccess": "MONITOR", "onFailure": "EXECUTE", "timeout": 180000, "maxRetries": 2},
        {"name": "MONITOR", "description": "Monitor engagement", "agentPrompt": "Monitor engagement for 24h. Track impressions, clicks, reactions.", "requiredOutput": ["metrics"], "onSuccess": "REPORT", "onFailure": "MONITOR", "timeout": 86400000, "maxRetries": 1},
        {"name": "REPORT", "description": "Generate report", "agentPrompt": "Create campaign report with metrics and learnings.", "requiredOutput": ["reportPath"], "onSuccess": "COMPLETE", "onFailure": "REPORT", "timeout": 180000, "maxRetries": 2},
        {"name": "COMPLETE", "description": "Close campaign", "agentPrompt": "Close issue, notify CEO.", "requiredOutput": ["closed"], "onSuccess": null, "onFailure": null, "timeout": 60000, "maxRetries": 1}
    ]'::jsonb,
    'issue_assigned',
    '{"labels": ["campaign", "marketing"]}'::jsonb
) ON CONFLICT (type) DO NOTHING;

-- CFO: TREASURY_REPORT
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'cfo_treasury_report',
    'cfo',
    'Treasury Report',
    'Daily treasury status report',
    'FETCH_BALANCES',
    '[
        {"name": "FETCH_BALANCES", "description": "Get wallet balances", "agentPrompt": "Fetch balances from Gnosis Safe and tracked wallets via Etherscan.", "requiredOutput": ["balances"], "onSuccess": "FETCH_PRICES", "onFailure": "FETCH_BALANCES", "timeout": 120000, "maxRetries": 3},
        {"name": "FETCH_PRICES", "description": "Get token prices", "agentPrompt": "Fetch current token prices from CoinGecko.", "requiredOutput": ["prices"], "onSuccess": "CALCULATE_METRICS", "onFailure": "FETCH_PRICES", "timeout": 60000, "maxRetries": 3},
        {"name": "CALCULATE_METRICS", "description": "Calculate treasury metrics", "agentPrompt": "Calculate: total value, runway, burn rate, allocation.", "requiredOutput": ["totalValue", "runway", "burnRate"], "onSuccess": "GENERATE_REPORT", "onFailure": "CALCULATE_METRICS", "timeout": 60000, "maxRetries": 2},
        {"name": "GENERATE_REPORT", "description": "Create report", "agentPrompt": "Generate treasury report markdown.", "requiredOutput": ["reportPath"], "onSuccess": "PUBLISH", "onFailure": "GENERATE_REPORT", "timeout": 120000, "maxRetries": 2},
        {"name": "PUBLISH", "description": "Publish report", "agentPrompt": "Save to workspace, post to status service, notify CEO.", "requiredOutput": ["published"], "onSuccess": "COMPLETE", "onFailure": "PUBLISH", "timeout": 60000, "maxRetries": 2},
        {"name": "COMPLETE", "description": "Done", "agentPrompt": "Mark complete.", "requiredOutput": [], "onSuccess": null, "onFailure": null, "timeout": 10000, "maxRetries": 1}
    ]'::jsonb,
    'scheduled',
    '{"cron": "0 9 * * *", "timezone": "UTC"}'::jsonb
) ON CONFLICT (type) DO NOTHING;

-- COO: AGENT_HEALTH_CHECK
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'coo_health_check',
    'coo',
    'Agent Health Check',
    'Hourly check of all agent health',
    'CHECK_HEARTBEATS',
    '[
        {"name": "CHECK_HEARTBEATS", "description": "Check agent heartbeats", "agentPrompt": "Query agent_heartbeat table. Identify agents not seen in last 10 minutes.", "requiredOutput": ["healthyAgents", "staleAgents"], "onSuccess": "CHECK_LOOP_COUNTS", "onFailure": "CHECK_HEARTBEATS", "timeout": 60000, "maxRetries": 2},
        {"name": "CHECK_LOOP_COUNTS", "description": "Verify loop progress", "agentPrompt": "Check loop counts from agent_status. Flag agents with no progress.", "requiredOutput": ["loopCounts", "stuckAgents"], "onSuccess": "CHECK_ERROR_RATES", "onFailure": "CHECK_LOOP_COUNTS", "timeout": 60000, "maxRetries": 2},
        {"name": "CHECK_ERROR_RATES", "description": "Check error rates", "agentPrompt": "Analyze recent errors from logs. Calculate error rate per agent.", "requiredOutput": ["errorRates"], "onSuccess": "RESTART_IF_NEEDED", "onFailure": "CHECK_ERROR_RATES", "timeout": 60000, "maxRetries": 2},
        {"name": "RESTART_IF_NEEDED", "description": "Restart unhealthy agents", "agentPrompt": "If staleAgents or stuckAgents found, trigger restart via Portainer.", "requiredOutput": ["restarted"], "onSuccess": "REPORT", "onFailure": "REPORT", "timeout": 180000, "maxRetries": 1},
        {"name": "REPORT", "description": "Log health status", "agentPrompt": "Post health check results to status service.", "requiredOutput": ["reported"], "onSuccess": "COMPLETE", "onFailure": "REPORT", "timeout": 60000, "maxRetries": 2},
        {"name": "COMPLETE", "description": "Done", "agentPrompt": "Mark complete.", "requiredOutput": [], "onSuccess": null, "onFailure": null, "timeout": 10000, "maxRetries": 1}
    ]'::jsonb,
    'scheduled',
    '{"cron": "0 * * * *", "timezone": "UTC"}'::jsonb
) ON CONFLICT (type) DO NOTHING;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Active state machines per agent
CREATE OR REPLACE VIEW v_active_state_machines AS
SELECT
    sm.id,
    sm.definition_type,
    smd.name as workflow_name,
    sm.agent_type,
    sm.current_state,
    sm.status,
    sm.context,
    sm.github_issue,
    sm.started_at,
    sm.updated_at,
    EXTRACT(EPOCH FROM (NOW() - sm.state_entered_at)) * 1000 as state_duration_ms,
    sm.retry_count
FROM state_machines sm
JOIN state_machine_definitions smd ON sm.definition_id = smd.id
WHERE sm.status IN ('pending', 'running', 'paused')
ORDER BY sm.priority, sm.started_at;

-- Recent transitions
CREATE OR REPLACE VIEW v_recent_transitions AS
SELECT
    st.id,
    sm.definition_type,
    sm.agent_type,
    st.from_state,
    st.to_state,
    st.success,
    st.duration_ms,
    st.created_at,
    st.error_message
FROM state_transitions st
JOIN state_machines sm ON st.machine_id = sm.id
ORDER BY st.created_at DESC
LIMIT 100;

-- ============================================================================
-- GRANTS (for aito user)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON state_machine_definitions TO aito;
GRANT SELECT, INSERT, UPDATE, DELETE ON state_machines TO aito;
GRANT SELECT, INSERT, UPDATE, DELETE ON state_transitions TO aito;
GRANT SELECT, INSERT, UPDATE, DELETE ON state_machine_queue TO aito;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_workflows TO aito;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aito;
