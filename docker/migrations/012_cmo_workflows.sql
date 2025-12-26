-- ============================================================================
-- CMO STATE MACHINE WORKFLOWS (TASK-109.6)
-- ============================================================================
--
-- Additional workflows for the CMO agent:
-- 1. CONTENT_CREATION - Create and publish content (6 states)
-- 2. SOCIAL_RESPONSE - Respond to community mentions (5 states)
-- 3. MARKET_NEWSJACKING - React to market trends (7 states)
--
-- Note: CAMPAIGN_EXECUTION already exists in 010_state_machines.sql
-- ============================================================================

-- CMO: CONTENT_CREATION
-- Trigger: Content request issue
-- Flow: RESEARCH_TOPIC → WRITE_DRAFT → GENERATE_VISUALS → REVIEW → PUBLISH → COMPLETE
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'cmo_content_creation',
    'cmo',
    'Content Creation',
    'Create and publish content for social media and website',
    'RESEARCH_TOPIC',
    '[
        {
            "name": "RESEARCH_TOPIC",
            "description": "Research the content topic",
            "agentPrompt": "Research content topic for issue #{githubIssue}.\n\n1. Identify the main topic and key messages\n2. Research relevant data, statistics, or news\n3. Check what competitors are posting about this topic\n4. Identify target audience and best platform\n5. Note any compliance considerations (CCO review needed?)\n\nOutput research summary and content strategy.",
            "requiredOutput": ["topic", "keyMessages", "targetAudience", "platform", "needsCompliance"],
            "onSuccess": "WRITE_DRAFT",
            "onFailure": "RESEARCH_TOPIC",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "WRITE_DRAFT",
            "description": "Write content draft",
            "agentPrompt": "Write content draft based on research:\n\nTopic: {topic}\nKey Messages: {keyMessages}\nTarget Audience: {targetAudience}\nPlatform: {platform}\n\nRequirements:\n1. Write in ENGLISH (international project)\n2. Match platform tone (Twitter: punchy, Telegram: detailed)\n3. Include relevant hashtags for Twitter\n4. Include call-to-action if appropriate\n5. Keep within platform limits (Twitter: 280 chars)\n\nProvide multiple versions if needed.",
            "requiredOutput": ["draftContent", "hashtags", "callToAction"],
            "onSuccess": "GENERATE_VISUALS",
            "onFailure": "WRITE_DRAFT",
            "timeout": 240000,
            "maxRetries": 2
        },
        {
            "name": "GENERATE_VISUALS",
            "description": "Generate or select visuals",
            "agentPrompt": "Create visuals for the content:\n\nContent: {draftContent}\nPlatform: {platform}\n\n1. Use spawn_worker with imagen to generate brand-aligned image\n2. Or select from existing brand assets\n3. Ensure visual matches Shiba Classic brand guidelines\n4. Optimize image size for platform\n\nIf no visual needed, set hasVisual=false.",
            "requiredOutput": ["hasVisual", "imagePath", "imageDescription"],
            "onSuccess": "REVIEW",
            "onFailure": "GENERATE_VISUALS",
            "timeout": 300000,
            "maxRetries": 2
        },
        {
            "name": "REVIEW",
            "description": "Review content quality and compliance",
            "agentPrompt": "Review the content before publishing:\n\nDraft: {draftContent}\nVisual: {imagePath}\n\n1. Check for spelling/grammar errors\n2. Verify brand voice consistency\n3. Ensure no sensitive/controversial content\n4. If needsCompliance=true, request CCO review\n5. Make final adjustments\n\nApprove or request changes.",
            "requiredOutput": ["approved", "finalContent", "complianceCleared"],
            "onSuccess": "PUBLISH",
            "onFailure": "WRITE_DRAFT",
            "timeout": 180000,
            "maxRetries": 1
        },
        {
            "name": "PUBLISH",
            "description": "Publish content to platform",
            "agentPrompt": "Publish the approved content:\n\nContent: {finalContent}\nPlatform: {platform}\nImage: {imagePath}\n\n1. Use spawn_worker with telegram or twitter MCP\n2. Post at optimal time (or now if urgent)\n3. Save post ID/URL for tracking\n4. Log publication in workspace",
            "requiredOutput": ["published", "postId", "postUrl", "publishedAt"],
            "onSuccess": "COMPLETE",
            "onFailure": "PUBLISH",
            "timeout": 120000,
            "maxRetries": 3
        },
        {
            "name": "COMPLETE",
            "description": "Finalize content creation",
            "agentPrompt": "Finalize content creation:\n\n1. Update GitHub issue with post link\n2. Log metrics baseline (will track engagement later)\n3. Close issue if one-time content\n4. Schedule follow-up for engagement check",
            "requiredOutput": ["issueUpdated", "metricsLogged"],
            "onSuccess": null,
            "onFailure": null,
            "timeout": 60000,
            "maxRetries": 1
        }
    ]'::jsonb,
    'issue_assigned',
    '{"labels": ["content", "social-media", "post"]}'::jsonb
) ON CONFLICT (type) DO UPDATE SET
    states = EXCLUDED.states,
    updated_at = NOW();

-- CMO: SOCIAL_RESPONSE
-- Trigger: Community mention requiring response
-- Flow: ANALYZE_MENTION → DRAFT_RESPONSE → COMPLIANCE_CHECK → POST → COMPLETE
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'cmo_social_response',
    'cmo',
    'Social Response',
    'Respond to community mentions and questions',
    'ANALYZE_MENTION',
    '[
        {
            "name": "ANALYZE_MENTION",
            "description": "Analyze the community mention",
            "agentPrompt": "Analyze the community mention:\n\nMention: {mentionContent}\nSource: {mentionSource}\nUser: {mentionUser}\n\n1. Determine sentiment (positive/neutral/negative)\n2. Identify the main question or topic\n3. Check if this is a complaint, question, or praise\n4. Assess urgency (high if negative/complaint)\n5. Determine if response is needed\n\nIf no response needed, set needsResponse=false.",
            "requiredOutput": ["sentiment", "topic", "mentionType", "urgency", "needsResponse"],
            "onSuccess": "DRAFT_RESPONSE",
            "onFailure": "ANALYZE_MENTION",
            "timeout": 120000,
            "maxRetries": 2,
            "skipIf": "!context.needsResponse"
        },
        {
            "name": "DRAFT_RESPONSE",
            "description": "Draft appropriate response",
            "agentPrompt": "Draft a response to the mention:\n\nOriginal: {mentionContent}\nSentiment: {sentiment}\nTopic: {topic}\nType: {mentionType}\n\nGuidelines:\n1. Be friendly and professional\n2. Address the specific question/concern\n3. Use Shiba Classic brand voice\n4. Include relevant links if helpful\n5. For complaints: acknowledge, empathize, provide solution\n6. For praise: thank them, encourage community\n\nWrite in ENGLISH.",
            "requiredOutput": ["responseContent", "tone", "includesLinks"],
            "onSuccess": "COMPLIANCE_CHECK",
            "onFailure": "DRAFT_RESPONSE",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "COMPLIANCE_CHECK",
            "description": "Quick compliance review",
            "agentPrompt": "Review response for compliance:\n\nResponse: {responseContent}\nOriginal Mention Type: {mentionType}\n\nCheck for:\n1. No financial advice or price predictions\n2. No promises about token performance\n3. No disclosure of sensitive information\n4. Professional and appropriate tone\n5. Accurate information about $SHIBC\n\nFor high-urgency complaints, flag for CCO review.",
            "requiredOutput": ["complianceOk", "flaggedForReview", "adjustments"],
            "onSuccess": "POST",
            "onFailure": "DRAFT_RESPONSE",
            "timeout": 120000,
            "maxRetries": 1
        },
        {
            "name": "POST",
            "description": "Post the response",
            "agentPrompt": "Post the response to the mention:\n\nResponse: {responseContent}\nPlatform: {mentionSource}\nReply to: {mentionId}\n\n1. Use spawn_worker with appropriate MCP (telegram/twitter)\n2. Post as reply to original mention\n3. Log the interaction",
            "requiredOutput": ["posted", "responseId"],
            "onSuccess": "COMPLETE",
            "onFailure": "POST",
            "timeout": 60000,
            "maxRetries": 3
        },
        {
            "name": "COMPLETE",
            "description": "Log and close",
            "agentPrompt": "Finalize social response:\n\n1. Log interaction in CRM/tracking\n2. Update sentiment tracking\n3. If issue exists, update it\n4. Note any follow-up needed",
            "requiredOutput": ["logged", "followUpNeeded"],
            "onSuccess": null,
            "onFailure": null,
            "timeout": 60000,
            "maxRetries": 1
        }
    ]'::jsonb,
    'event',
    '{"eventType": "social_mention"}'::jsonb
) ON CONFLICT (type) DO UPDATE SET
    states = EXCLUDED.states,
    updated_at = NOW();

-- CMO: MARKET_NEWSJACKING
-- Trigger: Market trend or news event
-- Flow: DETECT_TREND → ASSESS_RELEVANCE → CREATE_ANGLE → RAPID_CONTENT → COMPLIANCE_CHECK → POST → MONITOR
INSERT INTO state_machine_definitions (type, agent_type, name, description, initial_state, states, trigger_type, trigger_config)
VALUES (
    'cmo_market_newsjacking',
    'cmo',
    'Market Newsjacking',
    'React quickly to market trends with relevant content',
    'DETECT_TREND',
    '[
        {
            "name": "DETECT_TREND",
            "description": "Detect and analyze the market trend",
            "agentPrompt": "Analyze the market trend/news:\n\nTrend: {trendDescription}\nSource: {trendSource}\nFear & Greed Index: {fearGreedIndex}\n\n1. Identify what is happening in the market\n2. Determine magnitude and likely duration\n3. Check if other crypto projects are reacting\n4. Assess timing (is this still relevant?)\n5. Identify the narrative angle",
            "requiredOutput": ["trendSummary", "magnitude", "narrativeOpportunity", "timeWindow"],
            "onSuccess": "ASSESS_RELEVANCE",
            "onFailure": "DETECT_TREND",
            "timeout": 120000,
            "maxRetries": 2
        },
        {
            "name": "ASSESS_RELEVANCE",
            "description": "Assess relevance to Shiba Classic",
            "agentPrompt": "Assess if this trend is relevant for $SHIBC:\n\nTrend: {trendSummary}\nNarrative: {narrativeOpportunity}\n\n1. Can we authentically connect to this trend?\n2. Is it appropriate for our brand?\n3. Will our community find it relevant?\n4. Risk assessment: could this backfire?\n5. Expected engagement potential\n\nIf not relevant, set isRelevant=false to skip.",
            "requiredOutput": ["isRelevant", "connectionAngle", "riskLevel", "engagementPotential"],
            "onSuccess": "CREATE_ANGLE",
            "onFailure": "ASSESS_RELEVANCE",
            "timeout": 120000,
            "maxRetries": 1,
            "skipIf": "!context.isRelevant"
        },
        {
            "name": "CREATE_ANGLE",
            "description": "Create our unique angle",
            "agentPrompt": "Create Shiba Classic''s angle on this trend:\n\nTrend: {trendSummary}\nConnection: {connectionAngle}\n\n1. What''s our unique take?\n2. How does this relate to $SHIBC mission/values?\n3. What''s the hook that will grab attention?\n4. What''s the call to action?\n\nMake it authentic - don''t force a connection.",
            "requiredOutput": ["ourAngle", "hook", "messageFramework"],
            "onSuccess": "RAPID_CONTENT",
            "onFailure": "CREATE_ANGLE",
            "timeout": 180000,
            "maxRetries": 2
        },
        {
            "name": "RAPID_CONTENT",
            "description": "Rapidly create content",
            "agentPrompt": "Create content FAST - newsjacking requires speed:\n\nAngle: {ourAngle}\nHook: {hook}\nTime Window: {timeWindow}\n\n1. Write punchy Twitter post (under 280 chars)\n2. Include relevant trending hashtags\n3. Create Telegram version if appropriate\n4. Skip visuals unless quick to generate\n\nPrioritize SPEED over perfection - this is time-sensitive!",
            "requiredOutput": ["twitterContent", "telegramContent", "hashtags"],
            "onSuccess": "COMPLIANCE_CHECK",
            "onFailure": "RAPID_CONTENT",
            "timeout": 120000,
            "maxRetries": 1
        },
        {
            "name": "COMPLIANCE_CHECK",
            "description": "Quick compliance check",
            "agentPrompt": "FAST compliance check:\n\nContent: {twitterContent}\nRisk Level: {riskLevel}\n\n1. No financial advice\n2. No false claims\n3. Nothing offensive\n4. Brand appropriate\n\nFor low/medium risk, self-approve.\nFor high risk, flag for CCO (but may miss window).",
            "requiredOutput": ["approved", "complianceNotes"],
            "onSuccess": "POST",
            "onFailure": "RAPID_CONTENT",
            "timeout": 60000,
            "maxRetries": 1
        },
        {
            "name": "POST",
            "description": "Post immediately",
            "agentPrompt": "POST NOW - time is critical:\n\nTwitter: {twitterContent}\nTelegram: {telegramContent}\n\n1. Post to Twitter first (where trends happen)\n2. Post to Telegram\n3. Log timing relative to trend start",
            "requiredOutput": ["twitterPosted", "telegramPosted", "postTiming"],
            "onSuccess": "MONITOR",
            "onFailure": "POST",
            "timeout": 60000,
            "maxRetries": 2
        },
        {
            "name": "MONITOR",
            "description": "Monitor engagement",
            "agentPrompt": "Monitor newsjacking results:\n\nTwitter Post: {twitterPostId}\nTelegram Post: {telegramPostId}\n\n1. Track engagement after 1h, 4h, 24h\n2. Compare to baseline engagement\n3. Note if we caught the trend wave\n4. Document learnings for future\n\nThis state may be re-triggered for tracking.",
            "requiredOutput": ["engagement", "trendCaptured", "learnings"],
            "onSuccess": null,
            "onFailure": null,
            "timeout": 180000,
            "maxRetries": 3
        }
    ]'::jsonb,
    'event',
    '{"eventType": "market_trend", "fearGreedThreshold": 25}'::jsonb
) ON CONFLICT (type) DO UPDATE SET
    states = EXCLUDED.states,
    trigger_config = EXCLUDED.trigger_config,
    updated_at = NOW();

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
    workflow_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO workflow_count
    FROM state_machine_definitions
    WHERE agent_type = 'cmo';

    RAISE NOTICE 'CMO workflows total: %', workflow_count;
END $$;
