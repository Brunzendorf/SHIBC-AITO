-- ============================================================================
-- CFO STATE MACHINE WORKFLOWS (TASK-109.8)
-- ============================================================================
--
-- Additional workflows for the CFO agent:
-- 1. PAYMENT_PROCESSING - Process payment requests (9 states)
-- 2. BUDGET_ALLOCATION - Allocate budget to departments (6 states)
-- 3. FINANCIAL_AUDIT - Monthly financial audit (6 states)
--
-- Note: TREASURY_REPORT already exists in 010_state_machines.sql
-- ============================================================================

-- CFO: PAYMENT_PROCESSING
-- Trigger: Payment request issue
-- Flow: VERIFY_REQUEST → CHECK_BUDGET → COMPLIANCE_CHECK → PREPARE_TX → AWAIT_APPROVAL → EXECUTE → CONFIRM → NOTIFY → COMPLETE
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'cfo_payment_processing',
    'cfo',
    'Payment Processing',
    'Process payment requests with multi-sig and compliance',
    'VERIFY_REQUEST',
    '[
        {
            "name": "VERIFY_REQUEST",
            "description": "Verify payment request details",
            "agentPrompt": "Verify payment request from issue #{githubIssue}:\n\n1. Extract payment details:\n   - Recipient address (ETH/wallet)\n   - Amount and token type\n   - Purpose/justification\n   - Requestor\n2. Validate recipient address format\n3. Check if recipient is on whitelist\n4. Verify purpose aligns with SHIBC objectives\n5. Flag any suspicious patterns",
            "requiredOutput": ["recipient", "amount", "token", "purpose", "requestor", "isValid", "riskFlags"],
            "onSuccess": "CHECK_BUDGET",
            "onFailure": "VERIFY_REQUEST",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "CHECK_BUDGET",
            "description": "Check budget availability",
            "agentPrompt": "Check if budget is available for payment:\n\nAmount: {amount} {token}\nPurpose: {purpose}\n\n1. Get current treasury balance via etherscan MCP\n2. Check allocated budget for this category\n3. Verify payment doesn''t exceed limits:\n   - Single tx limit: $500\n   - Daily limit: $2000\n   - Category budget remaining\n4. Calculate impact on runway",
            "requiredOutput": ["treasuryBalance", "categoryBudget", "withinLimits", "newRunway"],
            "onSuccess": "COMPLIANCE_CHECK",
            "onFailure": "CHECK_BUDGET",
            "timeout": 120000,
            "maxRetries": 2
        },
        {
            "name": "COMPLIANCE_CHECK",
            "description": "CCO compliance review for large amounts",
            "agentPrompt": "Compliance check for payment:\n\nAmount: {amount} {token}\nRecipient: {recipient}\nRisk Flags: {riskFlags}\n\n1. If amount > $100 or risk flags exist:\n   - Request CCO review\n   - Wait for approval\n2. Check against sanctions lists\n3. Verify tax implications\n4. Document compliance decision\n\nFor amounts <= $100 with no flags, auto-approve.",
            "requiredOutput": ["complianceApproved", "ccoReviewed", "complianceNotes"],
            "onSuccess": "PREPARE_TX",
            "onFailure": "COMPLIANCE_CHECK",
            "timeout": 300000,
            "maxRetries": 2
        },
        {
            "name": "PREPARE_TX",
            "description": "Prepare transaction data",
            "agentPrompt": "Prepare the transaction:\n\nRecipient: {recipient}\nAmount: {amount} {token}\n\n1. Calculate gas estimate\n2. Prepare transaction data\n3. If using Gnosis Safe:\n   - Prepare Safe transaction\n   - Calculate required signatures\n4. Generate transaction summary for approval",
            "requiredOutput": ["txData", "gasEstimate", "safeNonce", "requiredSigners"],
            "onSuccess": "AWAIT_APPROVAL",
            "onFailure": "PREPARE_TX",
            "timeout": 120000,
            "maxRetries": 2
        },
        {
            "name": "AWAIT_APPROVAL",
            "description": "Await multi-sig approval if required",
            "agentPrompt": "Await approval for transaction:\n\nAmount: {amount} {token}\nRequired Signers: {requiredSigners}\n\n1. If amount > $500: Requires CEO approval\n2. If amount > $1000: Requires DAO vote\n3. Post approval request to appropriate channel\n4. Track approval status\n5. Timeout after 24h if no response\n\nFor small amounts with compliance approval, proceed.",
            "requiredOutput": ["approvalStatus", "approvers", "approvalTimestamp"],
            "onSuccess": "EXECUTE",
            "onFailure": "AWAIT_APPROVAL",
            "timeout": 86400000,
            "maxRetries": 1
        },
        {
            "name": "EXECUTE",
            "description": "Execute the transaction",
            "agentPrompt": "Execute the approved transaction:\n\nTx Data: {txData}\nGas: {gasEstimate}\n\n1. Submit transaction to network\n2. If Gnosis Safe: Submit to Safe\n3. Monitor for inclusion\n4. Handle any errors (gas, nonce, etc.)\n\n**CRITICAL: Double-check recipient and amount before executing!**",
            "requiredOutput": ["txHash", "submitted", "submissionTime"],
            "onSuccess": "CONFIRM",
            "onFailure": "EXECUTE",
            "timeout": 300000,
            "maxRetries": 3
        },
        {
            "name": "CONFIRM",
            "description": "Confirm transaction on-chain",
            "agentPrompt": "Confirm transaction completion:\n\nTx Hash: {txHash}\n\n1. Wait for transaction confirmation (2+ blocks)\n2. Verify recipient received funds\n3. Check for any reverts or errors\n4. Record final gas used and cost",
            "requiredOutput": ["confirmed", "blockNumber", "gasUsed", "recipientVerified"],
            "onSuccess": "NOTIFY",
            "onFailure": "EXECUTE",
            "timeout": 600000,
            "maxRetries": 2
        },
        {
            "name": "NOTIFY",
            "description": "Notify stakeholders",
            "agentPrompt": "Notify stakeholders of completed payment:\n\nAmount: {amount} {token}\nRecipient: {recipient}\nTx: {txHash}\n\n1. Update GitHub issue with tx link\n2. Notify requestor\n3. Post to finance channel\n4. Update treasury tracking\n5. Notify CEO for significant amounts",
            "requiredOutput": ["issueUpdated", "stakeholdersNotified"],
            "onSuccess": "COMPLETE",
            "onFailure": "NOTIFY",
            "timeout": 120000,
            "maxRetries": 2
        },
        {
            "name": "COMPLETE",
            "description": "Finalize payment record",
            "agentPrompt": "Finalize payment processing:\n\n1. Close GitHub issue\n2. Update budget tracking\n3. Log transaction for audit trail\n4. Update runway calculations",
            "requiredOutput": ["issueClosed", "budgetUpdated", "auditLogged"],
            "onSuccess": null,
            "onFailure": null,
            "timeout": 60000,
            "maxRetries": 1
        }
    ]'::jsonb,
    'issue_assigned',
    '{"labels": ["payment", "finance", "expense"]}'::jsonb
) ON CONFLICT (type) DO UPDATE SET
    states = EXCLUDED.states,
    updated_at = NOW();

-- CFO: BUDGET_ALLOCATION
-- Trigger: Monthly budget planning
-- Flow: ANALYZE_REQUESTS → REVIEW_SPENDING → PRIORITIZE → PROPOSE_ALLOCATION → CEO_APPROVAL → IMPLEMENT
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'cfo_budget_allocation',
    'cfo',
    'Budget Allocation',
    'Allocate monthly budget to departments',
    'ANALYZE_REQUESTS',
    '[
        {
            "name": "ANALYZE_REQUESTS",
            "description": "Analyze budget requests from all departments",
            "agentPrompt": "Analyze budget requests for the upcoming period:\n\n1. Collect budget requests from:\n   - CMO: Marketing budget\n   - CTO: Infrastructure, tools\n   - COO: Operations\n   - CCO: Compliance, legal\n2. Review each request:\n   - Justification\n   - Expected ROI\n   - Priority level\n3. Compare to historical spending\n4. Flag unusual requests",
            "requiredOutput": ["requests", "totalRequested", "byDepartment", "flaggedItems"],
            "onSuccess": "REVIEW_SPENDING",
            "onFailure": "ANALYZE_REQUESTS",
            "timeout": 240000,
            "maxRetries": 2
        },
        {
            "name": "REVIEW_SPENDING",
            "description": "Review previous period spending",
            "agentPrompt": "Review spending from previous period:\n\n1. Analyze actual vs budgeted spending\n2. Identify underspent categories\n3. Identify overspent categories\n4. Calculate efficiency metrics\n5. Note any one-time expenses\n\nUse this to inform allocation decisions.",
            "requiredOutput": ["actualSpending", "variance", "efficiency", "learnings"],
            "onSuccess": "PRIORITIZE",
            "onFailure": "REVIEW_SPENDING",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "PRIORITIZE",
            "description": "Prioritize budget allocation",
            "agentPrompt": "Prioritize budget allocation:\n\nTotal Available: {treasuryBalance}\nRequests: {totalRequested}\n\n1. Apply allocation rules:\n   - Essential operations: 40%\n   - Growth (marketing): 30%\n   - Development: 20%\n   - Reserve: 10%\n2. Rank requests by strategic value\n3. Cut lower-priority items if over budget\n4. Propose reallocation for underspent areas",
            "requiredOutput": ["proposedAllocation", "cuts", "priorityRanking"],
            "onSuccess": "PROPOSE_ALLOCATION",
            "onFailure": "PRIORITIZE",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "PROPOSE_ALLOCATION",
            "description": "Create formal budget proposal",
            "agentPrompt": "Create formal budget proposal:\n\nProposed Allocation: {proposedAllocation}\n\n1. Format proposal document:\n   - Executive summary\n   - Allocation by department\n   - Comparison to requests\n   - Rationale for cuts\n   - Risk assessment\n2. Save to workspace\n3. Submit to CEO for approval",
            "requiredOutput": ["proposalPath", "proposalSummary", "ceoNotified"],
            "onSuccess": "CEO_APPROVAL",
            "onFailure": "PROPOSE_ALLOCATION",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "CEO_APPROVAL",
            "description": "Await CEO approval",
            "agentPrompt": "Await CEO approval for budget:\n\nProposal: {proposalSummary}\n\n1. Track CEO response\n2. Address any questions\n3. Revise if requested\n4. For major changes, may need DAO vote\n\nTimeout after 48h - escalate if no response.",
            "requiredOutput": ["ceoApproved", "feedback", "revisions"],
            "onSuccess": "IMPLEMENT",
            "onFailure": "PROPOSE_ALLOCATION",
            "timeout": 172800000,
            "maxRetries": 1
        },
        {
            "name": "IMPLEMENT",
            "description": "Implement approved budget",
            "agentPrompt": "Implement the approved budget:\n\nApproved Allocation: {proposedAllocation}\n\n1. Update budget tracking system\n2. Notify each department of their allocation\n3. Set up spending alerts\n4. Create budget monitoring dashboard\n5. Schedule mid-period review",
            "requiredOutput": ["budgetImplemented", "departmentsNotified", "alertsConfigured"],
            "onSuccess": null,
            "onFailure": "IMPLEMENT",
            "timeout": 120000,
            "maxRetries": 2
        }
    ]'::jsonb,
    'scheduled',
    '{"cron": "0 9 1 * *", "timezone": "Europe/Berlin"}'::jsonb
) ON CONFLICT (type) DO UPDATE SET
    states = EXCLUDED.states,
    trigger_config = EXCLUDED.trigger_config,
    updated_at = NOW();

-- CFO: FINANCIAL_AUDIT
-- Trigger: Monthly schedule
-- Flow: GATHER_TRANSACTIONS → CATEGORIZE → RECONCILE → FLAG_ANOMALIES → REPORT → COMPLETE
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'cfo_financial_audit',
    'cfo',
    'Financial Audit',
    'Monthly financial audit and reconciliation',
    'GATHER_TRANSACTIONS',
    '[
        {
            "name": "GATHER_TRANSACTIONS",
            "description": "Gather all transactions for the period",
            "agentPrompt": "Gather all financial transactions for audit:\n\nPeriod: Last 30 days\n\n1. Fetch on-chain transactions from tracked wallets\n2. Fetch Gnosis Safe transactions\n3. Collect internal transfer records\n4. Gather payment processing logs\n5. Export to structured format",
            "requiredOutput": ["transactions", "transactionCount", "totalVolume", "walletsCovered"],
            "onSuccess": "CATEGORIZE",
            "onFailure": "GATHER_TRANSACTIONS",
            "timeout": 300000,
            "maxRetries": 3
        },
        {
            "name": "CATEGORIZE",
            "description": "Categorize all transactions",
            "agentPrompt": "Categorize transactions:\n\nTransactions: {transactionCount}\n\nCategories:\n- Operations (infra, tools, services)\n- Marketing (campaigns, influencers)\n- Development (bounties, contractors)\n- Legal/Compliance\n- Treasury management\n- Unknown/Uncategorized\n\nFlag any that don''t match expected patterns.",
            "requiredOutput": ["categorized", "byCategory", "uncategorized", "flagged"],
            "onSuccess": "RECONCILE",
            "onFailure": "CATEGORIZE",
            "timeout": 240000,
            "maxRetries": 2
        },
        {
            "name": "RECONCILE",
            "description": "Reconcile with budget and records",
            "agentPrompt": "Reconcile transactions with records:\n\nCategorized: {byCategory}\n\n1. Compare to approved budget\n2. Match with payment requests/issues\n3. Verify all outflows have documentation\n4. Calculate variance per category\n5. Identify any missing records",
            "requiredOutput": ["reconciled", "variance", "unmatchedTx", "missingDocs"],
            "onSuccess": "FLAG_ANOMALIES",
            "onFailure": "RECONCILE",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "FLAG_ANOMALIES",
            "description": "Flag suspicious or anomalous transactions",
            "agentPrompt": "Flag anomalies and suspicious activity:\n\nUnmatched: {unmatchedTx}\nVariance: {variance}\n\n1. Flag transactions without proper approval\n2. Flag unusual amounts or patterns\n3. Flag transactions to unknown addresses\n4. Check for potential fraud indicators\n5. Rate severity: Low/Medium/High/Critical",
            "requiredOutput": ["anomalies", "severityBreakdown", "investigationNeeded"],
            "onSuccess": "REPORT",
            "onFailure": "FLAG_ANOMALIES",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "REPORT",
            "description": "Generate audit report",
            "agentPrompt": "Generate monthly audit report:\n\nVolume: {totalVolume}\nCategories: {byCategory}\nAnomalies: {anomalies}\n\nReport sections:\n1. Executive Summary\n2. Transaction Summary\n3. Budget Variance Analysis\n4. Anomaly Report\n5. Recommendations\n6. Action Items\n\nSave to workspace and notify CEO/CCO.",
            "requiredOutput": ["reportPath", "executiveSummary", "actionItems"],
            "onSuccess": "COMPLETE",
            "onFailure": "REPORT",
            "timeout": 240000,
            "maxRetries": 2
        },
        {
            "name": "COMPLETE",
            "description": "Finalize audit",
            "agentPrompt": "Finalize the audit:\n\n1. Archive audit data\n2. Create action items for anomalies\n3. Update audit trail\n4. Schedule follow-up for open items\n5. Notify stakeholders of completion",
            "requiredOutput": ["archived", "actionItemsCreated", "nextAuditScheduled"],
            "onSuccess": null,
            "onFailure": null,
            "timeout": 120000,
            "maxRetries": 1
        }
    ]'::jsonb,
    'scheduled',
    '{"cron": "0 8 5 * *", "timezone": "Europe/Berlin"}'::jsonb
) ON CONFLICT (type) DO UPDATE SET
    states = EXCLUDED.states,
    trigger_config = EXCLUDED.trigger_config,
    updated_at = NOW();

-- Create scheduled workflow entries
INSERT INTO scheduled_workflows (definition_id, definition_type, cron_expression, timezone, is_active)
SELECT id, type, '0 9 1 * *', 'Europe/Berlin', true
FROM state_machine_definitions
WHERE type = 'cfo_budget_allocation'
ON CONFLICT DO NOTHING;

INSERT INTO scheduled_workflows (definition_id, definition_type, cron_expression, timezone, is_active)
SELECT id, type, '0 8 5 * *', 'Europe/Berlin', true
FROM state_machine_definitions
WHERE type = 'cfo_financial_audit'
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
    WHERE agent_type = 'cfo';

    RAISE NOTICE 'CFO workflows total: %', workflow_count;
END $$;
