-- Migration: Project Planning System
-- FEATURE: Multi-Project Portfolio Management for AITO Agents
-- PostgreSQL = Point of Truth, Redis = Cache only

-- =============================================================================
-- PROJECTS TABLE - Main project/initiative registry
-- =============================================================================
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,

    -- Status & Priority
    status VARCHAR(20) DEFAULT 'planning'
        CHECK (status IN ('planning', 'active', 'paused', 'completed', 'cancelled')),
    priority VARCHAR(20) DEFAULT 'medium'
        CHECK (priority IN ('critical', 'high', 'medium', 'low')),

    -- Ownership
    owner VARCHAR(20) NOT NULL,  -- Agent type: ceo, cmo, cto, etc.
    collaborators TEXT[] DEFAULT '{}',  -- Array of agent types

    -- Progress (0-100)
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),

    -- Complexity (Story Points) - NOT time-based!
    -- XS=1, S=2, M=3, L=5, XL=8 (Fibonacci-like)
    total_story_points INTEGER DEFAULT 0,
    completed_story_points INTEGER DEFAULT 0,

    -- Token Budget (the REAL resource we track)
    token_budget INTEGER DEFAULT 0,      -- Estimated tokens for project
    tokens_used INTEGER DEFAULT 0,       -- Consumed tokens
    budget_priority INTEGER DEFAULT 5    -- 1-10, for resource allocation
        CHECK (budget_priority >= 1 AND budget_priority <= 10),

    -- External Links
    github_issue_url TEXT,               -- Link to Epic/Issue
    github_issue_number INTEGER,
    initiative_id UUID,                  -- Link from initiatives/events

    -- Metadata
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(50) DEFAULT 'system'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_priority ON projects(priority);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner);
CREATE INDEX IF NOT EXISTS idx_projects_github ON projects(github_issue_number);
CREATE INDEX IF NOT EXISTS idx_projects_tags ON projects USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_projects_story_points ON projects(total_story_points);

-- =============================================================================
-- PROJECT_PHASES TABLE - Phases within a project
-- =============================================================================
CREATE TABLE IF NOT EXISTS project_phases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'completed', 'skipped')),

    -- Timeline
    start_date DATE,
    end_date DATE,

    -- Ordering
    sort_order INTEGER DEFAULT 0,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_phases_project ON project_phases(project_id);
CREATE INDEX IF NOT EXISTS idx_phases_status ON project_phases(status);
CREATE INDEX IF NOT EXISTS idx_phases_order ON project_phases(project_id, sort_order);

-- =============================================================================
-- PROJECT_TASKS TABLE - Tasks within phases
-- =============================================================================
CREATE TABLE IF NOT EXISTS project_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase_id UUID REFERENCES project_phases(id) ON DELETE SET NULL,

    title VARCHAR(255) NOT NULL,
    description TEXT,

    -- Assignment
    assignee VARCHAR(20),  -- Agent type

    -- Status
    status VARCHAR(20) DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'review', 'done', 'blocked')),

    -- Complexity (Story Points) - NOT time-based!
    -- XS=1, S=2, M=3, L=5, XL=8
    story_points INTEGER DEFAULT 2
        CHECK (story_points IN (1, 2, 3, 5, 8)),

    -- Token estimate (calculated from story points)
    -- XS=2K, S=5K, M=15K, L=40K, XL=100K
    token_estimate INTEGER DEFAULT 5000,
    tokens_used INTEGER DEFAULT 0,

    completed_at TIMESTAMP,

    -- Dependencies (task IDs that must complete first)
    dependencies UUID[] DEFAULT '{}',

    -- GitHub link
    github_issue_number INTEGER,
    github_issue_url TEXT,

    -- Ordering
    sort_order INTEGER DEFAULT 0,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_project ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_phase ON project_tasks(phase_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON project_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON project_tasks(assignee);
CREATE INDEX IF NOT EXISTS idx_tasks_story_points ON project_tasks(story_points);
CREATE INDEX IF NOT EXISTS idx_tasks_deps ON project_tasks USING GIN(dependencies);

-- =============================================================================
-- SCHEDULED_EVENTS TABLE - Calendar events (posts, AMAs, releases, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS scheduled_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,

    title VARCHAR(255) NOT NULL,
    description TEXT,

    -- Event Type
    event_type VARCHAR(30) NOT NULL
        CHECK (event_type IN ('post', 'ama', 'release', 'milestone', 'meeting', 'deadline', 'other')),

    -- Timing
    scheduled_at TIMESTAMP NOT NULL,
    duration_minutes INTEGER,
    is_all_day BOOLEAN DEFAULT false,

    -- Recurrence (NULL = one-time event)
    recurrence_rule JSONB,  -- { frequency: 'weekly', interval: 1, daysOfWeek: [1,3,5], until: '2025-12-31' }

    -- Assignment
    agent VARCHAR(20) NOT NULL,  -- Responsible agent

    -- Platform (for social posts)
    platform VARCHAR(20)
        CHECK (platform IN ('twitter', 'telegram', 'discord', 'website', NULL)),

    -- Status
    status VARCHAR(20) DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'published', 'cancelled', 'failed')),

    -- Content (for posts)
    content TEXT,
    media_urls TEXT[] DEFAULT '{}',

    -- Execution tracking
    executed_at TIMESTAMP,
    execution_result JSONB,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(50) DEFAULT 'system'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_project ON scheduled_events(project_id);
CREATE INDEX IF NOT EXISTS idx_events_scheduled ON scheduled_events(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON scheduled_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_agent ON scheduled_events(agent);
CREATE INDEX IF NOT EXISTS idx_events_status ON scheduled_events(status);
CREATE INDEX IF NOT EXISTS idx_events_platform ON scheduled_events(platform);
CREATE INDEX IF NOT EXISTS idx_events_upcoming ON scheduled_events(scheduled_at)
    WHERE status = 'scheduled';

-- =============================================================================
-- RESOURCE_ALLOCATIONS TABLE - Daily token budget distribution
-- =============================================================================
CREATE TABLE IF NOT EXISTS resource_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Date for this allocation
    allocation_date DATE NOT NULL,

    -- Total budget for the day
    total_budget INTEGER NOT NULL,

    -- Per-project allocations
    allocations JSONB NOT NULL DEFAULT '[]',
    -- Format: [{ projectId, projectTitle, priority, allocatedTokens, usedTokens }]

    -- Agent workload snapshot
    agent_workload JSONB NOT NULL DEFAULT '[]',
    -- Format: [{ agent, tasksCount, utilizationPercent, projects: [] }]

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Unique constraint: one allocation per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_allocations_date
    ON resource_allocations(allocation_date);

-- =============================================================================
-- VIEWS - Convenient aggregations
-- =============================================================================

-- Active projects with progress stats
CREATE OR REPLACE VIEW v_projects_dashboard AS
SELECT
    p.id,
    p.title,
    p.status,
    p.priority,
    p.owner,
    p.collaborators,
    p.progress,
    -- Story Points (Complexity-based, NOT time-based!)
    p.total_story_points,
    p.completed_story_points,
    -- Token Budget (the REAL resource)
    p.token_budget,
    p.tokens_used,
    CASE WHEN p.token_budget > 0
         THEN ROUND((p.tokens_used::NUMERIC / p.token_budget::NUMERIC) * 100)
         ELSE 0
    END as token_usage_percent,
    p.tags,
    p.github_issue_url,
    -- Task counts
    (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id) as total_tasks,
    (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id AND t.status = 'done') as completed_tasks,
    (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id AND t.status = 'blocked') as blocked_tasks,
    -- Story Points aggregation
    (SELECT COALESCE(SUM(story_points), 0) FROM project_tasks t WHERE t.project_id = p.id) as tasks_total_sp,
    (SELECT COALESCE(SUM(story_points), 0) FROM project_tasks t WHERE t.project_id = p.id AND t.status = 'done') as tasks_completed_sp,
    -- Token aggregation
    (SELECT COALESCE(SUM(token_estimate), 0) FROM project_tasks t WHERE t.project_id = p.id) as tasks_token_estimate,
    (SELECT COALESCE(SUM(tokens_used), 0) FROM project_tasks t WHERE t.project_id = p.id) as tasks_tokens_used,
    -- Upcoming events
    (SELECT COUNT(*) FROM scheduled_events e
     WHERE e.project_id = p.id AND e.status = 'scheduled' AND e.scheduled_at > NOW()) as upcoming_events,
    p.created_at,
    p.updated_at
FROM projects p
WHERE p.status NOT IN ('cancelled')
ORDER BY
    CASE p.priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
    END,
    p.total_story_points DESC;

-- Upcoming events (next 14 days)
CREATE OR REPLACE VIEW v_events_upcoming AS
SELECT
    e.*,
    p.title as project_title,
    p.status as project_status
FROM scheduled_events e
LEFT JOIN projects p ON e.project_id = p.id
WHERE e.status = 'scheduled'
  AND e.scheduled_at BETWEEN NOW() AND NOW() + INTERVAL '14 days'
ORDER BY e.scheduled_at;

-- Agent workload summary
CREATE OR REPLACE VIEW v_agent_workload AS
SELECT
    t.assignee as agent,
    COUNT(*) as total_tasks,
    SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
    SUM(CASE WHEN t.status = 'todo' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) as blocked,
    ARRAY_AGG(DISTINCT p.id) as project_ids,
    ARRAY_AGG(DISTINCT p.title) as project_titles
FROM project_tasks t
JOIN projects p ON t.project_id = p.id
WHERE t.assignee IS NOT NULL
  AND t.status NOT IN ('done')
  AND p.status = 'active'
GROUP BY t.assignee;

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Auto-update updated_at
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_projects_updated_at') THEN
        CREATE TRIGGER update_projects_updated_at
            BEFORE UPDATE ON projects
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_phases_updated_at') THEN
        CREATE TRIGGER update_phases_updated_at
            BEFORE UPDATE ON project_phases
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_tasks_updated_at') THEN
        CREATE TRIGGER update_tasks_updated_at
            BEFORE UPDATE ON project_tasks
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_events_updated_at') THEN
        CREATE TRIGGER update_events_updated_at
            BEFORE UPDATE ON scheduled_events
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Auto-calculate project progress based on tasks
CREATE OR REPLACE FUNCTION calculate_project_progress()
RETURNS TRIGGER AS $$
DECLARE
    total_count INTEGER;
    done_count INTEGER;
    new_progress INTEGER;
BEGIN
    -- Get task counts for the project
    SELECT COUNT(*), SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)
    INTO total_count, done_count
    FROM project_tasks
    WHERE project_id = COALESCE(NEW.project_id, OLD.project_id);

    -- Calculate progress
    IF total_count > 0 THEN
        new_progress := ROUND((done_count::NUMERIC / total_count::NUMERIC) * 100);
    ELSE
        new_progress := 0;
    END IF;

    -- Update project
    UPDATE projects
    SET progress = new_progress, updated_at = NOW()
    WHERE id = COALESCE(NEW.project_id, OLD.project_id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_update_project_progress
    AFTER INSERT OR UPDATE OF status OR DELETE ON project_tasks
    FOR EACH ROW EXECUTE FUNCTION calculate_project_progress();

-- =============================================================================
-- GRANTS
-- =============================================================================
GRANT ALL PRIVILEGES ON projects TO aito;
GRANT ALL PRIVILEGES ON project_phases TO aito;
GRANT ALL PRIVILEGES ON project_tasks TO aito;
GRANT ALL PRIVILEGES ON scheduled_events TO aito;
GRANT ALL PRIVILEGES ON resource_allocations TO aito;
GRANT SELECT ON v_projects_dashboard TO aito;
GRANT SELECT ON v_events_upcoming TO aito;
GRANT SELECT ON v_agent_workload TO aito;

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON TABLE projects IS 'Multi-project portfolio management for AITO agents';
COMMENT ON TABLE project_phases IS 'Phases/milestones within projects';
COMMENT ON TABLE project_tasks IS 'Individual tasks assigned to agents';
COMMENT ON TABLE scheduled_events IS 'Calendar events: posts, AMAs, releases, deadlines';
COMMENT ON TABLE resource_allocations IS 'Daily token budget distribution across projects';
COMMENT ON VIEW v_projects_dashboard IS 'Aggregated project view for dashboard';
COMMENT ON VIEW v_events_upcoming IS 'Next 14 days of scheduled events';
COMMENT ON VIEW v_agent_workload IS 'Current task load per agent';
