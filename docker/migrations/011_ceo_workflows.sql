-- ============================================================================
-- CEO STATE MACHINE WORKFLOWS (TASK-109.5)
-- ============================================================================
--
-- Three workflows for the CEO agent:
-- 1. STRATEGIC_DECISION - Major decision making process (7 states)
-- 2. INITIATIVE_LAUNCH - Launch and monitor new initiatives (6 states)
-- 3. WEEKLY_REPORT - Weekly status report (5 states)
-- ============================================================================

-- CEO: STRATEGIC_DECISION
-- Trigger: Strategic issue, major decision needed
-- Flow: GATHER_CONTEXT → ANALYZE_OPTIONS → CONSULT_C_LEVEL → MAKE_DECISION → COMMUNICATE → DOCUMENT → COMPLETE
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'ceo_strategic_decision',
    'ceo',
    'Strategic Decision',
    'Major decision-making workflow with C-Level consultation',
    'GATHER_CONTEXT',
    '[
        {
            "name": "GATHER_CONTEXT",
            "description": "Gather all relevant information for the decision",
            "agentPrompt": "You are making a strategic decision for issue #{githubIssue}. Gather context:\n1. Read the issue details and any linked documents\n2. Check current market conditions (price, sentiment)\n3. Review relevant agent reports from the past week\n4. Identify stakeholders affected by this decision\n\nOutput a comprehensive context summary.",
            "requiredOutput": ["contextSummary", "stakeholders", "marketContext", "urgency"],
            "onSuccess": "ANALYZE_OPTIONS",
            "onFailure": "GATHER_CONTEXT",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "ANALYZE_OPTIONS",
            "description": "Analyze possible options with pros and cons",
            "agentPrompt": "Based on the context:\n{contextSummary}\n\nAnalyze at least 3 strategic options:\n1. List each option clearly\n2. Identify pros and cons for each\n3. Estimate impact on $SHIBC (price, community, development)\n4. Assess risk level (low/medium/high)\n5. Recommend your preliminary preference with rationale",
            "requiredOutput": ["options", "recommendation", "riskAssessment"],
            "onSuccess": "CONSULT_C_LEVEL",
            "onFailure": "ANALYZE_OPTIONS",
            "timeout": 240000,
            "maxRetries": 2
        },
        {
            "name": "CONSULT_C_LEVEL",
            "description": "Request input from relevant C-Level agents",
            "agentPrompt": "Request input from C-Level agents on this decision:\n\nOptions under consideration:\n{options}\n\nYour recommendation: {recommendation}\n\nSend consultation requests to:\n- CTO: Technical feasibility\n- CFO: Financial impact\n- CMO: Community perception\n- CCO: Compliance concerns\n\nUse spawn_worker with telegram to notify them, or send direct messages.",
            "requiredOutput": ["consultationsSent", "agentsConsulted"],
            "onSuccess": "AWAIT_RESPONSES",
            "onFailure": "CONSULT_C_LEVEL",
            "timeout": 120000,
            "maxRetries": 2
        },
        {
            "name": "AWAIT_RESPONSES",
            "description": "Wait for and collect C-Level responses",
            "agentPrompt": "Check for responses from C-Level agents regarding the strategic decision.\n\nExpected responses from: {agentsConsulted}\n\nIf responses are available, summarize their input.\nIf waiting >1h with no responses, proceed with available input.\n\nNote: This state may be re-triggered multiple times while waiting.",
            "requiredOutput": ["responsesReceived", "clevelInput", "consensusLevel"],
            "onSuccess": "MAKE_DECISION",
            "onFailure": "AWAIT_RESPONSES",
            "timeout": 3600000,
            "maxRetries": 3
        },
        {
            "name": "MAKE_DECISION",
            "description": "Make the final decision with rationale",
            "agentPrompt": "Make the final strategic decision.\n\nContext: {contextSummary}\nOptions: {options}\nC-Level Input: {clevelInput}\n\n1. State your final decision clearly\n2. Explain the rationale\n3. Address any dissenting opinions\n4. Define success metrics\n5. Set review timeline",
            "requiredOutput": ["decision", "rationale", "successMetrics", "reviewDate"],
            "onSuccess": "COMMUNICATE",
            "onFailure": "MAKE_DECISION",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "COMMUNICATE",
            "description": "Communicate decision to all stakeholders",
            "agentPrompt": "Communicate the strategic decision:\n\nDecision: {decision}\nRationale: {rationale}\n\n1. Broadcast to all C-Level agents\n2. Post announcement to Telegram (if public decision)\n3. Update GitHub issue with decision\n4. Assign follow-up tasks if needed",
            "requiredOutput": ["broadcastSent", "issueUpdated", "followUpTasks"],
            "onSuccess": "COMPLETE",
            "onFailure": "COMMUNICATE",
            "timeout": 120000,
            "maxRetries": 2
        },
        {
            "name": "COMPLETE",
            "description": "Finalize and document the decision",
            "agentPrompt": "Finalize the strategic decision process:\n\n1. Update the decision record in the database\n2. Close or update the GitHub issue\n3. Log the decision for future reference\n4. Set reminder for review date: {reviewDate}",
            "requiredOutput": ["documented", "issueStatus"],
            "onSuccess": null,
            "onFailure": null,
            "timeout": 60000,
            "maxRetries": 1
        }
    ]'::jsonb,
    'issue_assigned',
    '{"labels": ["strategic", "decision", "major"]}'::jsonb
) ON CONFLICT (type) DO UPDATE SET
    states = EXCLUDED.states,
    updated_at = NOW();

-- CEO: INITIATIVE_LAUNCH
-- Trigger: New initiative proposal
-- Flow: DEFINE_SCOPE → ASSIGN_AGENTS → CREATE_ISSUES → KICKOFF → MONITOR_PROGRESS → COMPLETE
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'ceo_initiative_launch',
    'ceo',
    'Initiative Launch',
    'Launch and coordinate a new strategic initiative',
    'DEFINE_SCOPE',
    '[
        {
            "name": "DEFINE_SCOPE",
            "description": "Define initiative scope and success criteria",
            "agentPrompt": "Define the scope for initiative: {initiativeTitle}\n\nFrom issue #{githubIssue}:\n\n1. Clearly state the initiative goals\n2. Define specific, measurable success metrics\n3. Identify required resources (agents, tools, budget)\n4. Set milestones and timeline\n5. Identify dependencies and risks",
            "requiredOutput": ["goals", "successMetrics", "resources", "milestones", "timeline"],
            "onSuccess": "ASSIGN_AGENTS",
            "onFailure": "DEFINE_SCOPE",
            "timeout": 240000,
            "maxRetries": 2
        },
        {
            "name": "ASSIGN_AGENTS",
            "description": "Assign C-Level agents to initiative tasks",
            "agentPrompt": "Assign agents to the initiative:\n\nGoals: {goals}\nMilestones: {milestones}\n\nFor each milestone:\n1. Determine which agent(s) should lead\n2. Define their specific deliverables\n3. Set deadlines\n\nConsider agent strengths:\n- CTO: Technical implementation\n- CMO: Marketing, community engagement\n- CFO: Budget, financial tracking\n- COO: Operations, coordination\n- CCO: Compliance, risk management",
            "requiredOutput": ["assignments", "deliverables", "deadlines"],
            "onSuccess": "CREATE_ISSUES",
            "onFailure": "ASSIGN_AGENTS",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "CREATE_ISSUES",
            "description": "Create GitHub issues for each task",
            "agentPrompt": "Create GitHub issues for initiative tasks:\n\nAssignments: {assignments}\n\nFor each assignment:\n1. Create a GitHub issue with clear description\n2. Add appropriate labels (agent type, priority)\n3. Set milestone to link to initiative\n4. Assign to the designated agent\n\nUse spawn_worker with github-mcp to create issues.",
            "requiredOutput": ["issuesCreated", "issueNumbers"],
            "onSuccess": "KICKOFF",
            "onFailure": "CREATE_ISSUES",
            "timeout": 300000,
            "maxRetries": 3
        },
        {
            "name": "KICKOFF",
            "description": "Announce initiative kickoff",
            "agentPrompt": "Announce the initiative kickoff:\n\n1. Send message to all assigned agents with their tasks\n2. Post initiative announcement (if public)\n3. Update master issue with links to all sub-issues\n4. Set up tracking in workspace",
            "requiredOutput": ["announced", "trackingSetup"],
            "onSuccess": "MONITOR_PROGRESS",
            "onFailure": "KICKOFF",
            "timeout": 120000,
            "maxRetries": 2
        },
        {
            "name": "MONITOR_PROGRESS",
            "description": "Monitor initiative progress",
            "agentPrompt": "Check initiative progress:\n\nIssues: {issueNumbers}\nDeadlines: {deadlines}\n\n1. Check status of all sub-issues\n2. Identify any blockers or delays\n3. Send reminders to agents behind schedule\n4. Update progress in master issue\n\nIf all tasks complete, proceed to completion.\nIf still in progress, this state will be re-triggered daily.",
            "requiredOutput": ["progressSummary", "blockers", "completionPercentage"],
            "onSuccess": "COMPLETE",
            "onFailure": "MONITOR_PROGRESS",
            "timeout": 180000,
            "maxRetries": 5,
            "skipIf": "context.completionPercentage < 100"
        },
        {
            "name": "COMPLETE",
            "description": "Complete the initiative",
            "agentPrompt": "Finalize the initiative:\n\n1. Verify all success metrics are met\n2. Create final report summarizing outcomes\n3. Close the master issue\n4. Announce completion\n5. Document lessons learned",
            "requiredOutput": ["metricsVerified", "reportPath", "lessonsLearned"],
            "onSuccess": null,
            "onFailure": null,
            "timeout": 180000,
            "maxRetries": 2
        }
    ]'::jsonb,
    'issue_assigned',
    '{"labels": ["initiative", "project"]}'::jsonb
) ON CONFLICT (type) DO UPDATE SET
    states = EXCLUDED.states,
    updated_at = NOW();

-- CEO: WEEKLY_REPORT
-- Trigger: Scheduled (Sundays)
-- Flow: COLLECT_REPORTS → ANALYZE_METRICS → WRITE_REPORT → PUBLISH → COMPLETE
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'ceo_weekly_report',
    'ceo',
    'Weekly Report',
    'Compile weekly status report from all agents',
    'COLLECT_REPORTS',
    '[
        {
            "name": "COLLECT_REPORTS",
            "description": "Collect status reports from all C-Level agents",
            "agentPrompt": "Collect weekly status from all C-Level agents:\n\n1. Request status updates from: CTO, CMO, CFO, COO, CCO\n2. Check GitHub for completed issues this week\n3. Review agent loop summaries from the past 7 days\n4. Gather key metrics from each department",
            "requiredOutput": ["agentReports", "completedIssues", "weeklyHighlights"],
            "onSuccess": "ANALYZE_METRICS",
            "onFailure": "COLLECT_REPORTS",
            "timeout": 300000,
            "maxRetries": 3
        },
        {
            "name": "ANALYZE_METRICS",
            "description": "Analyze key performance metrics",
            "agentPrompt": "Analyze weekly performance:\n\nAgent Reports: {agentReports}\nCompleted Issues: {completedIssues}\n\n1. Calculate productivity metrics (issues closed, PRs merged)\n2. Track $SHIBC price and market cap changes\n3. Community growth (Telegram members, Twitter followers)\n4. Development velocity\n5. Compare to previous week",
            "requiredOutput": ["metrics", "weekOverWeekChange", "topAchievements", "concerns"],
            "onSuccess": "WRITE_REPORT",
            "onFailure": "ANALYZE_METRICS",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "WRITE_REPORT",
            "description": "Write the weekly report",
            "agentPrompt": "Write the CEO Weekly Report:\n\nMetrics: {metrics}\nHighlights: {weeklyHighlights}\nTop Achievements: {topAchievements}\nConcerns: {concerns}\n\nFormat:\n# CEO Weekly Report - Week of [DATE]\n\n## Executive Summary\n[2-3 sentence overview]\n\n## Key Achievements\n[Bullet points]\n\n## Metrics Dashboard\n[Table with week-over-week comparison]\n\n## Departmental Updates\n[Summary from each C-Level]\n\n## Concerns & Action Items\n[Issues to address]\n\n## Next Week Focus\n[Priorities]",
            "requiredOutput": ["reportContent", "reportPath"],
            "onSuccess": "PUBLISH",
            "onFailure": "WRITE_REPORT",
            "timeout": 240000,
            "maxRetries": 2
        },
        {
            "name": "PUBLISH",
            "description": "Publish and distribute the report",
            "agentPrompt": "Publish the weekly report:\n\nReport: {reportPath}\n\n1. Save to workspace/SHIBC-CEO-001/reports/weekly/\n2. Post summary to Telegram announcement channel\n3. Update status service with metrics\n4. Send full report to DAO/governance channel",
            "requiredOutput": ["savedPath", "telegramPosted", "statusUpdated"],
            "onSuccess": "COMPLETE",
            "onFailure": "PUBLISH",
            "timeout": 120000,
            "maxRetries": 2
        },
        {
            "name": "COMPLETE",
            "description": "Finalize weekly report process",
            "agentPrompt": "Finalize weekly report:\n\n1. Log report completion\n2. Archive any temporary data\n3. Set reminder for next week''s report",
            "requiredOutput": ["logged", "nextReportScheduled"],
            "onSuccess": null,
            "onFailure": null,
            "timeout": 60000,
            "maxRetries": 1
        }
    ]'::jsonb,
    'scheduled',
    '{"cron": "0 18 * * 0", "timezone": "Europe/Berlin"}'::jsonb
) ON CONFLICT (type) DO UPDATE SET
    states = EXCLUDED.states,
    trigger_config = EXCLUDED.trigger_config,
    updated_at = NOW();

-- Create scheduled workflow entry for WEEKLY_REPORT
INSERT INTO scheduled_workflows (definition_id, definition_type, cron_expression, timezone, is_active)
SELECT id, type, '0 18 * * 0', 'Europe/Berlin', true
FROM state_machine_definitions
WHERE type = 'ceo_weekly_report'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Show created CEO workflows
DO $$
DECLARE
    workflow_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO workflow_count
    FROM state_machine_definitions
    WHERE agent_type = 'ceo';

    RAISE NOTICE 'CEO workflows created/updated: %', workflow_count;
END $$;
