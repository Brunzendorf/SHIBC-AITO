-- ============================================================================
-- CTO STATE MACHINE WORKFLOWS (TASK-109.7)
-- ============================================================================
--
-- Additional workflows for the CTO agent:
-- 1. INFRASTRUCTURE_CHECK - Monitor system health (5 states)
-- 2. SECURITY_INCIDENT - Handle security threats (9 states)
--
-- Note: BUILD_PROJECT and FIX_BUG already exist in 010_state_machines.sql
-- ============================================================================

-- CTO: INFRASTRUCTURE_CHECK
-- Trigger: Scheduled (every 6 hours)
-- Flow: CHECK_UPTIME → CHECK_CERTS → CHECK_CONTAINERS → CHECK_RESOURCES → GENERATE_REPORT
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'cto_infrastructure_check',
    'cto',
    'Infrastructure Check',
    'Monitor system health and infrastructure status',
    'CHECK_UPTIME',
    '[
        {
            "name": "CHECK_UPTIME",
            "description": "Check service uptime and availability",
            "agentPrompt": "Check uptime for all AITO services:\n\n1. Use spawn_worker with fetch to check endpoints:\n   - Dashboard: http://aito-dashboard:3000/health\n   - Status Service: http://aito-status:3002/health\n   - Orchestrator: Internal health check\n2. Check Redis connectivity\n3. Check PostgreSQL connectivity\n4. Record response times and status codes\n\nReport any services that are down or slow (>500ms).",
            "requiredOutput": ["servicesChecked", "allHealthy", "downServices", "slowServices"],
            "onSuccess": "CHECK_CERTS",
            "onFailure": "CHECK_UPTIME",
            "timeout": 120000,
            "maxRetries": 2
        },
        {
            "name": "CHECK_CERTS",
            "description": "Check SSL certificate expiration",
            "agentPrompt": "Check SSL certificates for all public endpoints:\n\n1. Check shibaclassic.com certificate expiry\n2. Check any API endpoints with SSL\n3. Alert if any cert expires within 30 days\n4. Critical alert if expires within 7 days\n\nUse spawn_worker with fetch to check cert info.",
            "requiredOutput": ["certsChecked", "expiringCerts", "criticalCerts"],
            "onSuccess": "CHECK_CONTAINERS",
            "onFailure": "CHECK_CERTS",
            "timeout": 120000,
            "maxRetries": 2
        },
        {
            "name": "CHECK_CONTAINERS",
            "description": "Check Docker container health",
            "agentPrompt": "Check Docker container status:\n\n1. List all running containers (docker ps)\n2. Check for containers in unhealthy/restarting state\n3. Check container resource usage (CPU, memory)\n4. Identify containers that have restarted recently\n5. Check for orphaned/stopped containers that should be running\n\nUse filesystem MCP to read docker logs if issues found.",
            "requiredOutput": ["containersRunning", "unhealthyContainers", "restartedContainers", "resourceAlerts"],
            "onSuccess": "CHECK_RESOURCES",
            "onFailure": "CHECK_CONTAINERS",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "CHECK_RESOURCES",
            "description": "Check system resources",
            "agentPrompt": "Check system resource utilization:\n\n1. Disk usage - alert if >80%\n2. Memory usage - alert if >85%\n3. CPU load average\n4. Database size and growth rate\n5. Redis memory usage\n6. Log file sizes\n\nFlag any resources approaching limits.",
            "requiredOutput": ["diskUsage", "memoryUsage", "cpuLoad", "resourceAlerts"],
            "onSuccess": "GENERATE_REPORT",
            "onFailure": "CHECK_RESOURCES",
            "timeout": 120000,
            "maxRetries": 2
        },
        {
            "name": "GENERATE_REPORT",
            "description": "Generate infrastructure report",
            "agentPrompt": "Generate infrastructure health report:\n\nUptime: {allHealthy}\nDown Services: {downServices}\nCerts: {expiringCerts}\nContainers: {unhealthyContainers}\nResources: {resourceAlerts}\n\n1. Create summary report in markdown\n2. Save to workspace/SHIBC-CTO-001/reports/infra/\n3. If critical issues found, alert CEO immediately\n4. Post to status service\n5. Log metrics for trending",
            "requiredOutput": ["reportPath", "criticalAlerts", "statusUpdated"],
            "onSuccess": null,
            "onFailure": "GENERATE_REPORT",
            "timeout": 120000,
            "maxRetries": 2
        }
    ]'::jsonb,
    'scheduled',
    '{"cron": "0 */6 * * *", "timezone": "UTC"}'::jsonb
) ON CONFLICT (type) DO UPDATE SET
    states = EXCLUDED.states,
    trigger_config = EXCLUDED.trigger_config,
    updated_at = NOW();

-- CTO: SECURITY_INCIDENT
-- Trigger: Security alert event
-- Flow: DETECT_THREAT → ASSESS_SEVERITY → ISOLATE → NOTIFY → INVESTIGATE → PATCH → VERIFY → POST_MORTEM → COMPLETE
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'cto_security_incident',
    'cto',
    'Security Incident',
    'Handle security threats and incidents',
    'DETECT_THREAT',
    '[
        {
            "name": "DETECT_THREAT",
            "description": "Analyze the security alert",
            "agentPrompt": "Analyze security alert:\n\nAlert: {alertDescription}\nSource: {alertSource}\nTimestamp: {alertTimestamp}\n\n1. Identify the type of threat (unauthorized access, vulnerability, malware, etc.)\n2. Determine affected systems/services\n3. Check for indicators of compromise (IOCs)\n4. Gather initial evidence\n5. Determine if threat is active or historical",
            "requiredOutput": ["threatType", "affectedSystems", "isActive", "initialEvidence"],
            "onSuccess": "ASSESS_SEVERITY",
            "onFailure": "DETECT_THREAT",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "ASSESS_SEVERITY",
            "description": "Assess threat severity",
            "agentPrompt": "Assess severity of the threat:\n\nThreat: {threatType}\nAffected: {affectedSystems}\nActive: {isActive}\n\nSeverity Levels:\n- CRITICAL: Active compromise, data at risk, immediate action needed\n- HIGH: Vulnerability being exploited, significant risk\n- MEDIUM: Potential vulnerability, not actively exploited\n- LOW: Minor issue, no immediate risk\n\nConsider:\n1. Data sensitivity involved\n2. System criticality\n3. Blast radius (what else could be affected)\n4. Reputation impact",
            "requiredOutput": ["severity", "riskScore", "impactAssessment", "recommendedActions"],
            "onSuccess": "ISOLATE",
            "onFailure": "ASSESS_SEVERITY",
            "timeout": 120000,
            "maxRetries": 1
        },
        {
            "name": "ISOLATE",
            "description": "Isolate affected systems",
            "agentPrompt": "Isolate affected systems to contain threat:\n\nAffected: {affectedSystems}\nSeverity: {severity}\n\nFor CRITICAL/HIGH severity:\n1. Stop affected containers/services\n2. Block suspicious IPs if identified\n3. Revoke compromised credentials\n4. Disable affected API keys\n5. Take affected services offline if necessary\n\nFor MEDIUM/LOW:\n1. Increase monitoring\n2. Prepare isolation plan\n3. Document current state\n\nPrioritize: Contain first, investigate second.",
            "requiredOutput": ["isolationActions", "servicesAffected", "containmentComplete"],
            "onSuccess": "NOTIFY",
            "onFailure": "ISOLATE",
            "timeout": 300000,
            "maxRetries": 2
        },
        {
            "name": "NOTIFY",
            "description": "Notify stakeholders",
            "agentPrompt": "Notify stakeholders about the incident:\n\nSeverity: {severity}\nThreat: {threatType}\nContainment: {containmentComplete}\n\n1. Alert CEO immediately for CRITICAL/HIGH\n2. Notify COO for operational impact\n3. Alert CCO for compliance implications\n4. For CRITICAL: Consider public disclosure timeline\n5. Create incident ticket/issue\n\nUse spawn_worker with telegram for urgent notifications.",
            "requiredOutput": ["notificationsSent", "incidentId", "escalationLevel"],
            "onSuccess": "INVESTIGATE",
            "onFailure": "NOTIFY",
            "timeout": 120000,
            "maxRetries": 2
        },
        {
            "name": "INVESTIGATE",
            "description": "Investigate root cause",
            "agentPrompt": "Investigate the security incident:\n\nThreat: {threatType}\nEvidence: {initialEvidence}\n\n1. Analyze logs for attack timeline\n2. Identify entry point/attack vector\n3. Determine scope of compromise\n4. Identify what data/systems were accessed\n5. Find root cause (misconfiguration, vulnerability, stolen creds, etc.)\n6. Document findings thoroughly",
            "requiredOutput": ["rootCause", "attackTimeline", "compromiseScope", "findings"],
            "onSuccess": "PATCH",
            "onFailure": "INVESTIGATE",
            "timeout": 600000,
            "maxRetries": 3
        },
        {
            "name": "PATCH",
            "description": "Apply security patches",
            "agentPrompt": "Apply fixes to address the vulnerability:\n\nRoot Cause: {rootCause}\nAffected: {affectedSystems}\n\n1. Develop fix for the vulnerability\n2. Update affected dependencies\n3. Rotate compromised credentials\n4. Apply security patches\n5. Harden configurations\n6. Test fixes in isolated environment first",
            "requiredOutput": ["patchesApplied", "credentialsRotated", "hardeningApplied"],
            "onSuccess": "VERIFY",
            "onFailure": "PATCH",
            "timeout": 600000,
            "maxRetries": 3
        },
        {
            "name": "VERIFY",
            "description": "Verify fixes and restore services",
            "agentPrompt": "Verify security fixes and restore normal operations:\n\nPatches: {patchesApplied}\nIsolated Services: {servicesAffected}\n\n1. Test that vulnerability is patched\n2. Run security scan on fixed systems\n3. Gradually restore isolated services\n4. Monitor for any recurring issues\n5. Verify all systems are operational",
            "requiredOutput": ["vulnerabilityFixed", "servicesRestored", "monitoringEnhanced"],
            "onSuccess": "POST_MORTEM",
            "onFailure": "PATCH",
            "timeout": 300000,
            "maxRetries": 2
        },
        {
            "name": "POST_MORTEM",
            "description": "Create post-mortem report",
            "agentPrompt": "Create post-mortem report:\n\nIncident ID: {incidentId}\nTimeline: {attackTimeline}\nRoot Cause: {rootCause}\nPatches: {patchesApplied}\n\nPost-Mortem Format:\n1. Executive Summary\n2. Timeline of events\n3. Root cause analysis\n4. Impact assessment\n5. Response actions taken\n6. Lessons learned\n7. Preventive measures for future\n\nSave to workspace and share with C-Level.",
            "requiredOutput": ["postMortemPath", "lessonsLearned", "preventiveMeasures"],
            "onSuccess": "COMPLETE",
            "onFailure": "POST_MORTEM",
            "timeout": 300000,
            "maxRetries": 2
        },
        {
            "name": "COMPLETE",
            "description": "Close security incident",
            "agentPrompt": "Finalize security incident:\n\n1. Close incident ticket with resolution\n2. Update security documentation\n3. Schedule follow-up review\n4. Archive evidence and logs\n5. Notify stakeholders of resolution",
            "requiredOutput": ["incidentClosed", "documentationUpdated", "followUpScheduled"],
            "onSuccess": null,
            "onFailure": null,
            "timeout": 120000,
            "maxRetries": 1
        }
    ]'::jsonb,
    'event',
    '{"eventType": "security_alert"}'::jsonb
) ON CONFLICT (type) DO UPDATE SET
    states = EXCLUDED.states,
    trigger_config = EXCLUDED.trigger_config,
    updated_at = NOW();

-- Create scheduled workflow entry for INFRASTRUCTURE_CHECK
INSERT INTO scheduled_workflows (definition_id, definition_type, cron_expression, timezone, is_active)
SELECT id, type, '0 */6 * * *', 'UTC', true
FROM state_machine_definitions
WHERE type = 'cto_infrastructure_check'
ON CONFLICT DO NOTHING;

-- CTO: EXTEND_PROJECT
-- Trigger: Scheduled or manual review of existing projects
-- Flow: ANALYZE_PROJECT → IDENTIFY_IMPROVEMENTS → EVALUATE_FEASIBILITY → PRIORITIZE → CREATE_ISSUES → IMPLEMENT_QUICK_WINS → COMPLETE
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'cto_extend_project',
    'cto',
    'Extend Project',
    'Analyze existing projects and identify enhancement opportunities',
    'ANALYZE_PROJECT',
    '[
        {
            "name": "ANALYZE_PROJECT",
            "description": "Analyze the existing project thoroughly",
            "agentPrompt": "Analyze existing project for enhancement opportunities:\n\nProject: {projectName}\nPath: {projectPath}\n\n1. Read the project README and documentation\n2. Analyze the codebase structure and architecture\n3. Check test coverage and identify gaps\n4. Review existing issues and user feedback\n5. Analyze dependencies - are any outdated?\n6. Check for technical debt indicators\n7. Review performance metrics if available\n\nCreate a comprehensive project health assessment.",
            "requiredOutput": ["projectSummary", "techStack", "testCoverage", "dependencies", "technicalDebt", "healthScore"],
            "onSuccess": "IDENTIFY_IMPROVEMENTS",
            "onFailure": "ANALYZE_PROJECT",
            "timeout": 300000,
            "maxRetries": 2
        },
        {
            "name": "IDENTIFY_IMPROVEMENTS",
            "description": "Identify potential improvements and new features",
            "agentPrompt": "Identify improvement opportunities:\n\nProject: {projectName}\nHealth Score: {healthScore}\nTech Debt: {technicalDebt}\n\nCategories to explore:\n\n1. **New Features**\n   - What features would users benefit from?\n   - What''s missing compared to similar projects?\n   - What would make this more useful for SHIBC?\n\n2. **Performance Improvements**\n   - Caching opportunities\n   - Query optimization\n   - Bundle size reduction\n\n3. **Code Quality**\n   - Refactoring opportunities\n   - Better error handling\n   - Improved logging/monitoring\n\n4. **Security Enhancements**\n   - Input validation\n   - Authentication/authorization\n   - Dependency vulnerabilities\n\n5. **Developer Experience**\n   - Better documentation\n   - Easier setup\n   - More tests\n\nList at least 5-10 concrete improvement ideas.",
            "requiredOutput": ["newFeatures", "performanceImprovements", "codeQualityImprovements", "securityEnhancements", "dxImprovements"],
            "onSuccess": "EVALUATE_FEASIBILITY",
            "onFailure": "IDENTIFY_IMPROVEMENTS",
            "timeout": 300000,
            "maxRetries": 2
        },
        {
            "name": "EVALUATE_FEASIBILITY",
            "description": "Evaluate feasibility and effort for each improvement",
            "agentPrompt": "Evaluate each improvement opportunity:\n\nImprovements identified:\n- Features: {newFeatures}\n- Performance: {performanceImprovements}\n- Quality: {codeQualityImprovements}\n- Security: {securityEnhancements}\n- DX: {dxImprovements}\n\nFor each improvement, assess:\n1. **Effort**: Low (< 2h), Medium (2-8h), High (> 8h)\n2. **Impact**: Low, Medium, High\n3. **Risk**: Breaking changes? Dependencies?\n4. **Prerequisites**: What needs to be done first?\n\nCalculate priority score = Impact / Effort\nIdentify quick wins (High impact, Low effort).",
            "requiredOutput": ["evaluatedImprovements", "quickWins", "majorEnhancements", "technicalPrerequisites"],
            "onSuccess": "PRIORITIZE",
            "onFailure": "EVALUATE_FEASIBILITY",
            "timeout": 240000,
            "maxRetries": 2
        },
        {
            "name": "PRIORITIZE",
            "description": "Prioritize improvements and create roadmap",
            "agentPrompt": "Create prioritized improvement roadmap:\n\nQuick Wins: {quickWins}\nMajor Enhancements: {majorEnhancements}\n\n1. Rank all improvements by priority score\n2. Group into phases:\n   - Phase 1: Quick wins (do immediately)\n   - Phase 2: High-value improvements\n   - Phase 3: Nice-to-haves\n3. Consider dependencies between improvements\n4. Estimate total effort per phase\n5. Get CEO input for major changes if needed",
            "requiredOutput": ["prioritizedList", "phase1Items", "phase2Items", "phase3Items", "totalEffortEstimate"],
            "onSuccess": "CREATE_ISSUES",
            "onFailure": "PRIORITIZE",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "CREATE_ISSUES",
            "description": "Create GitHub issues for improvements",
            "agentPrompt": "Create GitHub issues for prioritized improvements:\n\nPhase 1: {phase1Items}\nPhase 2: {phase2Items}\nPhase 3: {phase3Items}\n\nFor each improvement:\n1. Create detailed GitHub issue with:\n   - Clear title: [PROJECT] Enhancement: <description>\n   - Description with context and acceptance criteria\n   - Labels: enhancement, project:<name>, priority:<level>\n   - Effort estimate in description\n2. Link related issues together\n3. Create milestone for project improvements\n\nUse spawn_worker with github-mcp.",
            "requiredOutput": ["issuesCreated", "issueNumbers", "milestoneCreated"],
            "onSuccess": "IMPLEMENT_QUICK_WINS",
            "onFailure": "CREATE_ISSUES",
            "timeout": 300000,
            "maxRetries": 3
        },
        {
            "name": "IMPLEMENT_QUICK_WINS",
            "description": "Implement quick wins immediately",
            "agentPrompt": "Implement Phase 1 quick wins now:\n\nQuick Wins: {phase1Items}\nProject Path: {projectPath}\n\nFor each quick win:\n1. Implement the change\n2. Write/update tests\n3. Update documentation if needed\n4. Commit with descriptive message\n\nIf any quick win takes longer than expected, skip and leave for separate PR.\n\nThis is autonomous improvement - no PR needed for small fixes.",
            "requiredOutput": ["implementedItems", "skippedItems", "commitHashes"],
            "onSuccess": "COMPLETE",
            "onFailure": "IMPLEMENT_QUICK_WINS",
            "timeout": 600000,
            "maxRetries": 2
        },
        {
            "name": "COMPLETE",
            "description": "Finalize project extension review",
            "agentPrompt": "Complete project extension review:\n\n1. Update project README with improvements made\n2. Close quick-win issues that were implemented\n3. Create summary report of:\n   - Improvements identified: X\n   - Issues created: Y\n   - Quick wins implemented: Z\n4. Schedule next review (monthly?)\n5. Notify CEO of significant findings",
            "requiredOutput": ["summaryReport", "nextReviewDate", "ceoNotified"],
            "onSuccess": null,
            "onFailure": null,
            "timeout": 120000,
            "maxRetries": 1
        }
    ]'::jsonb,
    'scheduled',
    '{"cron": "0 10 1 * *", "timezone": "Europe/Berlin"}'::jsonb
) ON CONFLICT (type) DO UPDATE SET
    states = EXCLUDED.states,
    trigger_config = EXCLUDED.trigger_config,
    updated_at = NOW();

-- Create scheduled workflow entry for EXTEND_PROJECT (monthly)
INSERT INTO scheduled_workflows (definition_id, definition_type, cron_expression, timezone, is_active)
SELECT id, type, '0 10 1 * *', 'Europe/Berlin', true
FROM state_machine_definitions
WHERE type = 'cto_extend_project'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
    workflow_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO workflow_count
    FROM state_machine_definitions
    WHERE agent_type = 'cto';

    RAISE NOTICE 'CTO workflows total: %', workflow_count;
END $$;
