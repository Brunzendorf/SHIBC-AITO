import { v4 as uuid } from 'uuid';
import { createLogger } from '../lib/logger.js';
import { eventRepo, decisionRepo, escalationRepo, agentRepo, historyRepo } from '../lib/db.js';
import {
  subscribe,
  publish,
  channels,
  pushTask,
  pushUrgent,
} from '../lib/redis.js';
import { numericConfig } from '../lib/config.js';
import type {
  AgentMessage,
  EventType,
  Decision,
  DecisionType,
  VoteValue,
  AgentType,
} from '../lib/types.js';
import { APPROVAL_REQUIREMENTS } from '../lib/types.js';

const logger = createLogger('events');

// Message handlers registry
type MessageHandler = (message: AgentMessage) => Promise<void>;
const messageHandlers: Map<string, MessageHandler> = new Map();
// Timeout tracking for decisions
const decisionTimeouts: Map<string, NodeJS.Timeout> = new Map();

// Register a message handler for a specific message type
export function registerHandler(
  messageType: string,
  handler: MessageHandler
): void {
  messageHandlers.set(messageType, handler);
  logger.debug({ messageType }, 'Registered message handler');
}

// UUID regex for validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(str: string): boolean {
  return UUID_REGEX.test(str);
}

// Process incoming message
async function processMessage(message: AgentMessage): Promise<void> {
  logger.debug({ messageType: message.type, from: message.from, to: message.to }, 'Processing message');

  // Log event - only use UUIDs for agent fields, skip non-UUID strings like "orchestrator"
  await eventRepo.log({
    eventType: message.type as EventType,
    sourceAgent: isValidUUID(message.from) ? message.from : undefined,
    targetAgent: typeof message.to === 'string' && isValidUUID(message.to) ? message.to : undefined,
    payload: message.payload,
    correlationId: message.correlationId,
  });

  // Find and execute handler
  const handler = messageHandlers.get(message.type);
  if (handler) {
    await handler(message);
  } else {
    logger.warn({ messageType: message.type }, 'No handler for message type');
  }
}

// === Built-in Handlers ===

// Handle status requests
registerHandler('status_request', async (message) => {
  const agent = await agentRepo.findById(message.to as string);
  if (!agent) return;

  // Agent daemon will handle the actual status collection
  await pushTask(agent.id, {
    type: 'status_request',
    requestId: message.id,
    from: message.from,
    include: (message.payload as any)?.include || ['metrics', 'tasks', 'blockers'],
    deadline: message.responseDeadline,
  });
});

// Handle task assignments
registerHandler('task', async (message) => {
  const payload = message.payload as any;

  // Push to agent's task queue
  await pushTask(message.to as string, {
    type: 'task',
    taskId: payload.task_id || uuid(),
    title: payload.title,
    description: payload.description,
    priority: message.priority,
    deadline: payload.deadline,
    from: message.from,
  });

  if (message.priority === 'urgent') {
    // Also push to urgent queue for immediate processing
    await pushUrgent({
      agentId: message.to,
      taskId: payload.task_id,
      priority: 'urgent',
    });
  }
});

// Handle decision proposals - with tiered approval system
registerHandler('decision', async (message) => {
  const payload = message.payload as any;
  const tier = (payload.type as DecisionType) || 'major';
  const requirements = APPROVAL_REQUIREMENTS[tier];

  logger.info({ tier, title: payload.title, from: message.from }, 'Decision proposal received');

  // === OPERATIONAL TIER: Auto-execute, no decision record ===
  if (tier === 'operational') {
    logger.info({ title: payload.title, from: message.from }, 'Operational task - auto-executing');

    // Log to agent history
    const agent = await agentRepo.findByType(message.from as AgentType);
    if (agent) {
      await historyRepo.add({
        agentId: agent.id,
        actionType: 'decision',
        summary: `[OPERATIONAL] ${payload.title}`,
        details: { tier, description: payload.description, autoApproved: true },
      });
    }

    // TARGETED: Only notify CEO (oversight) - NOT broadcast to all agents
    // This prevents cascade loops where all agents react to every operational task
    const ceoAgent = await agentRepo.findByType('ceo');
    if (ceoAgent && message.from !== ceoAgent.id) {
      await publish(channels.agent(ceoAgent.id), {
        id: uuid(),
        type: 'status_response', // Not decision - just FYI
        from: 'orchestrator',
        to: ceoAgent.id,
        payload: {
          eventType: 'operational_completed',
          title: payload.title,
          executedBy: message.from,
          tier: 'operational',
        },
        priority: 'low',
        timestamp: new Date(),
        requiresResponse: false, // CEO doesn't need to respond
      } as AgentMessage);
    }

    return;
  }

  // === MINOR/MAJOR/CRITICAL: Create decision record ===
  const decision = await decisionRepo.create({
    title: payload.title,
    description: payload.description,
    proposedBy: message.from,
    decisionType: tier,
    status: 'pending',
    vetoRound: 0,
  });

  logger.info({ decisionId: decision.id, title: decision.title, tier }, 'Decision created');

  // === MINOR TIER: Notify CEO only, auto-approve after timeout ===
  if (tier === 'minor') {
    const notifyMessage: AgentMessage = {
      id: uuid(),
      type: 'vote',
      from: 'orchestrator',
      to: 'ceo', // CEO only for minor decisions
      payload: {
        decisionId: decision.id,
        title: decision.title,
        description: decision.description,
        proposedBy: message.from,
        type: tier,
        round: 1,
        action: 'veto_or_ignore', // CEO can veto or let it auto-approve
      },
      priority: 'normal',
      timestamp: new Date(),
      requiresResponse: false, // Not required - will auto-approve
      responseDeadline: new Date(Date.now() + requirements.timeoutMs),
    };

    await publish(channels.head, notifyMessage);

    // Schedule auto-approve timeout
    scheduleDecisionTimeout(decision.id, tier, requirements.timeoutMs);
    return;
  }

  // === MAJOR/CRITICAL TIER: Notify HEAD layer (CEO + DAO) ===
  const notifyMessage: AgentMessage = {
    id: uuid(),
    type: 'vote',
    from: 'orchestrator',
    to: 'head',
    payload: {
      decisionId: decision.id,
      title: decision.title,
      description: decision.description,
      proposedBy: message.from,
      type: tier,
      round: 1,
      humanRequired: requirements.humanRequired, // Flag for critical
    },
    priority: 'high',
    timestamp: new Date(),
    requiresResponse: true,
    responseDeadline: new Date(Date.now() + requirements.timeoutMs),
  };

  await publish(channels.head, notifyMessage);

  // Schedule escalation timeout (major/critical escalate to human on timeout)
  scheduleDecisionTimeout(decision.id, tier, requirements.timeoutMs);
});

// Handle votes
registerHandler('vote', async (message) => {
  const payload = message.payload as any;
  const decision = await decisionRepo.findById(payload.decisionId);

  if (!decision) {
    logger.warn({ decisionId: payload.decisionId }, 'Decision not found for vote');
    return;
  }

  const voterType = payload.voterType as 'ceo' | 'dao';
  const vote = payload.vote as VoteValue;

  // Record vote
  await decisionRepo.updateVote(decision.id, voterType, vote);

  logger.info({
    decisionId: decision.id,
    voter: voterType,
    vote,
    tier: decision.decisionType,
  }, 'Vote recorded');

  // Clear any pending timeout since we got a vote
  const timeout = decisionTimeouts.get(decision.id);
  if (timeout) {
    clearTimeout(timeout);
    decisionTimeouts.delete(decision.id);
  }

  // Process based on tier
  const updatedDecision = await decisionRepo.findById(decision.id);
  if (!updatedDecision) return;

  await processDecisionResult(updatedDecision);
});

// Handle alerts
registerHandler('alert', async (message) => {
  const payload = message.payload as any;

  logger.warn({
    from: message.from,
    alertType: payload.type,
    severity: payload.severity,
  }, 'Alert received');

  // Forward urgent alerts to human escalation
  if (payload.severity === 'critical') {
    await triggerEscalation({
      reason: `Critical alert from ${message.from}: ${payload.message}`,
      decisionId: payload.relatedDecisionId,
      channels: ['telegram', 'email'],
    });
  }
});

// Handle workspace updates from agents - trigger RAG indexing
registerHandler('workspace_update', async (message) => {
  const payload = message.payload as any;

  logger.info({
    agentType: payload.agentType,
    commitHash: payload.commitHash,
    filesChanged: payload.filesChanged?.length || 0,
  }, 'Workspace update received, indexing for RAG');

  // Index agent output for RAG
  try {
    const { indexAgentOutput } = await import('../lib/rag.js');
    await indexAgentOutput(
      message.from as string,
      payload.agentType,
      payload.summary || 'Agent workspace update'
    );
    logger.info({ agentType: payload.agentType }, 'RAG indexing completed');
  } catch (error) {
    logger.error({ error }, 'Failed to index workspace update for RAG');
  }
});

// Handle PR review requests - RAG quality gate for agent content
registerHandler('pr_review_requested', async (message) => {
  const payload = message.payload as any;

  logger.info({
    agentType: payload.agentType,
    prNumber: payload.prNumber,
    filesChanged: payload.filesChanged?.length || 0,
  }, 'PR review requested, running RAG quality check');

  try {
    const { reviewPRContent } = await import('../lib/rag.js');

    // Run RAG quality check on PR content
    const reviewResult = await reviewPRContent(
      payload.agentType,
      payload.summary || '',
      payload.filesChanged || []
    );

    if (reviewResult.approved) {
      logger.info({
        prNumber: payload.prNumber,
        score: reviewResult.score,
        category: payload.category || 'content',
      }, 'PR passed RAG quality check');

      const category = payload.category || 'content'; // status | content | strategic
      const { mergePullRequest } = await import('../agents/workspace.js');

      if (category === 'status') {
        // Status updates: auto-merge, NO RAG indexing
        await mergePullRequest(payload.prNumber);
        logger.info({ prNumber: payload.prNumber }, 'Status PR auto-merged (no RAG index)');
      } else if (category === 'strategic') {
        // Strategic: CEO must review
        await publish(channels.head, {
          id: uuid(),
          type: 'pr_approved_by_rag',
          from: 'orchestrator',
          to: 'ceo',
          payload: {
            prNumber: payload.prNumber,
            prUrl: payload.prUrl,
            agentType: payload.agentType,
            summary: payload.summary,
            category,
            ragScore: reviewResult.score,
            ragFeedback: reviewResult.feedback,
          },
          priority: 'high',
          timestamp: new Date(),
          requiresResponse: true,
        });
        logger.info({ prNumber: payload.prNumber }, 'Strategic PR sent to CEO for review');
      } else {
        // Content: broadcast to clevel, first to claim reviews
        await publish(channels.clevel, {
          id: uuid(),
          type: 'pr_approved_by_rag',
          from: 'orchestrator',
          to: 'clevel',
          payload: {
            prNumber: payload.prNumber,
            prUrl: payload.prUrl,
            agentType: payload.agentType,
            summary: payload.summary,
            category,
            ragScore: reviewResult.score,
            ragFeedback: reviewResult.feedback,
            claimable: true, // First to claim reviews it
          },
          priority: 'normal',
          timestamp: new Date(),
          requiresResponse: false,
        });
        logger.info({ prNumber: payload.prNumber }, 'Content PR broadcast to clevel for review');
      }

      // NOTE: RAG indexing happens in pr_merged handler, NOT here!
    } else {
      logger.warn({
        prNumber: payload.prNumber,
        score: reviewResult.score,
        issues: reviewResult.issues,
      }, 'PR failed RAG quality check');

      // Close PR with feedback
      const { closePullRequest } = await import('../agents/workspace.js');
      const feedbackMessage = `Quality score: ${reviewResult.score}/100\n\nIssues found:\n${reviewResult.issues.map((i: string) => `- ${i}`).join('\n')}\n\nSuggestions:\n${reviewResult.feedback}`;
      await closePullRequest(payload.prNumber, feedbackMessage);

      // Notify agent about rejection
      await publish(channels.agent(message.from as string), {
        id: uuid(),
        type: 'pr_rejected',
        from: 'orchestrator',
        to: message.from,
        payload: {
          prNumber: payload.prNumber,
          score: reviewResult.score,
          issues: reviewResult.issues,
          feedback: reviewResult.feedback,
        },
        priority: 'normal',
        timestamp: new Date(),
        requiresResponse: false,
      });
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errMsg, prNumber: payload.prNumber }, 'Failed to review PR content');
  }
});

// Handle PR merged events - RAG indexing happens here (NOT on approval)
registerHandler('pr_merged', async (message) => {
  const payload = message.payload as any;
  const category = payload.category || 'content';
  const prNumber = payload.prNumber;
  const agentType = payload.agentType;
  const summary = payload.summary;

  logger.info({
    prNumber,
    category,
    agentType,
    mergedBy: payload.mergedBy,
  }, 'PR merged event received');

  // Status updates: NO RAG indexing
  if (category === 'status') {
    logger.info({ prNumber }, 'Status PR merged - skipping RAG indexing');
    return;
  }

  // Content and Strategic PRs: Index to RAG
  try {
    const { indexAgentOutput } = await import('../lib/rag.js');
    await indexAgentOutput(
      message.from as string,
      agentType,
      summary || `PR #${prNumber} merged`
    );
    logger.info({ prNumber, category, agentType }, 'PR content indexed to RAG after merge');
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errMsg, prNumber }, 'Failed to index merged PR to RAG');
  }

  // Broadcast merge completion
  await publish(channels.broadcast, {
    id: uuid(),
    type: 'broadcast',
    from: 'orchestrator',
    to: 'all',
    payload: {
      eventType: 'pr_merged',
      prNumber,
      agentType,
      category,
      summary,
      mergedBy: payload.mergedBy,
    },
    priority: 'low',
    timestamp: new Date(),
    requiresResponse: false,
  });
});

// Handle PR claim requests from C-Level agents
registerHandler('claim_pr', async (message) => {
  const payload = message.payload as any;
  const prNumber = payload.prNumber;
  const claimedBy = message.from;

  logger.info({
    prNumber,
    claimedBy,
  }, 'PR claim request received');

  // Check if PR is still claimable (not already claimed)
  // This is a simple first-come-first-served implementation
  // In production, you might want to use Redis locks for atomicity
  const claimKey = `pr:claim:${prNumber}`;
  const existingClaim = await import('../lib/redis.js').then(r => r.redis.get(claimKey));

  if (existingClaim) {
    logger.info({ prNumber, alreadyClaimedBy: existingClaim }, 'PR already claimed');
    // Notify the claimant that they were too late
    await publish(channels.agent(claimedBy as string), {
      id: uuid(),
      type: 'pr_claim_rejected',
      from: 'orchestrator',
      to: claimedBy,
      payload: {
        prNumber,
        reason: `PR #${prNumber} already claimed by ${existingClaim}`,
      },
      priority: 'normal',
      timestamp: new Date(),
      requiresResponse: false,
    });
    return;
  }

  // Claim the PR (expires after 1 hour)
  await import('../lib/redis.js').then(r => r.redis.setex(claimKey, 3600, claimedBy as string));

  logger.info({ prNumber, claimedBy }, 'PR claimed successfully');

  // Send the full PR details to the claiming agent for review
  await publish(channels.agent(claimedBy as string), {
    id: uuid(),
    type: 'pr_review_assigned',
    from: 'orchestrator',
    to: claimedBy,
    payload: {
      prNumber,
      prUrl: payload.prUrl,
      agentType: payload.agentType,
      summary: payload.summary,
      category: payload.category,
      ragScore: payload.ragScore,
      ragFeedback: payload.ragFeedback,
      claimedAt: new Date().toISOString(),
    },
    priority: 'high',
    timestamp: new Date(),
    requiresResponse: true,
  });
});

// === Decision Timeout Scheduling ===

function scheduleDecisionTimeout(decisionId: string, tier: DecisionType, timeoutMs: number): void {
  if (timeoutMs <= 0) return;

  const requirements = APPROVAL_REQUIREMENTS[tier];

  logger.debug({ decisionId, tier, timeoutMs }, 'Scheduling decision timeout');

  const timeout = setTimeout(async () => {
    decisionTimeouts.delete(decisionId);

    const decision = await decisionRepo.findById(decisionId);
    if (!decision || decision.status !== 'pending') {
      logger.debug({ decisionId }, 'Decision already resolved, skipping timeout');
      return;
    }

    logger.info({ decisionId, tier }, 'Decision timeout reached');

    if (requirements.autoApproveOnTimeout) {
      // Minor tier: auto-approve
      logger.info({ decisionId }, 'Auto-approving decision after timeout');
      await decisionRepo.updateStatus(decisionId, 'approved', new Date());
      await broadcastDecisionResult(decision, 'approved');
    } else {
      // Major/Critical tier: escalate to human
      logger.warn({ decisionId }, 'Escalating decision to human after timeout');
      await escalateToHuman(decision);
    }
  }, timeoutMs);

  decisionTimeouts.set(decisionId, timeout);
}

// === Decision Processing ===

async function processDecisionResult(decision: Decision): Promise<void> {
  const ceoVote = decision.ceoVote;
  const daoVote = decision.daoVote;
  const tier = decision.decisionType;
  const requirements = APPROVAL_REQUIREMENTS[tier];

  logger.debug({ decisionId: decision.id, tier, ceoVote, daoVote }, 'Processing decision result');

  // === MINOR TIER: Only CEO vote matters ===
  if (tier === 'minor') {
    if (ceoVote === 'veto') {
      await decisionRepo.updateStatus(decision.id, 'vetoed', new Date());
      await broadcastDecisionResult(decision, 'vetoed');
      return;
    }
    if (ceoVote === 'approve') {
      await decisionRepo.updateStatus(decision.id, 'approved', new Date());
      await broadcastDecisionResult(decision, 'approved');
      return;
    }
    // If CEO hasn't voted yet, timeout will handle auto-approve
    return;
  }

  // === MAJOR/CRITICAL TIER: Need both CEO and DAO votes ===
  if (!ceoVote || !daoVote) {
    // Wait for both votes
    return;
  }

  // Both approve
  if (ceoVote === 'approve' && daoVote === 'approve') {
    // Critical tier needs human confirmation even after CEO+DAO approve
    if (requirements.humanRequired) {
      logger.info({ decisionId: decision.id }, 'Critical decision approved by CEO+DAO, requiring human confirmation');
      await escalateToHuman(decision);
      return;
    }
    await decisionRepo.updateStatus(decision.id, 'approved', new Date());
    await broadcastDecisionResult(decision, 'approved');
    return;
  }

  // Both veto
  if (ceoVote === 'veto' && daoVote === 'veto') {
    await decisionRepo.updateStatus(decision.id, 'vetoed', new Date());
    await broadcastDecisionResult(decision, 'vetoed');
    return;
  }

  // One veto, one approve → Proceed to next round
  const currentRound = decision.vetoRound || 0;

  if (currentRound >= numericConfig.maxVetoRounds) {
    // Max rounds reached → Escalate to human
    await escalateToHuman(decision);
    return;
  }

  // Start next round with C-Level input
  await decisionRepo.incrementVetoRound(decision.id);
  await startCLevelRound(decision);
}

async function startCLevelRound(decision: Decision): Promise<void> {
  logger.info({ decisionId: decision.id, round: (decision.vetoRound || 0) + 1 }, 'Starting C-Level round');

  // Notify all C-Level agents
  const message: AgentMessage = {
    id: uuid(),
    type: 'vote',
    from: 'orchestrator',
    to: 'clevel',
    payload: {
      decisionId: decision.id,
      title: decision.title,
      description: decision.description,
      ceoVote: decision.ceoVote,
      daoVote: decision.daoVote,
      round: (decision.vetoRound || 0) + 1,
      action: 'provide_analysis',
    },
    priority: 'high',
    timestamp: new Date(),
    requiresResponse: true,
    responseDeadline: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12h
  };

  await publish(channels.clevel, message);
}

async function escalateToHuman(decision: Decision): Promise<void> {
  logger.warn({ decisionId: decision.id, tier: decision.decisionType }, 'Escalating decision to human');

  await decisionRepo.updateStatus(decision.id, 'escalated');

  const reason = decision.decisionType === 'critical'
    ? `Critical decision requires human confirmation: ${decision.title}`
    : `Decision deadlock after ${numericConfig.maxVetoRounds} rounds: ${decision.title}`;

  await triggerEscalation({
    reason,
    decisionId: decision.id,
    channels: ['telegram', 'email', 'dashboard'],
  });
}

async function broadcastDecisionResult(
  decision: Decision,
  result: 'approved' | 'vetoed'
): Promise<void> {
  // Clear any pending timeout
  const timeout = decisionTimeouts.get(decision.id);
  if (timeout) {
    clearTimeout(timeout);
    decisionTimeouts.delete(decision.id);
  }

  const message: AgentMessage = {
    id: uuid(),
    type: 'broadcast',
    from: 'orchestrator',
    to: 'all',
    payload: {
      eventType: 'decision_resolved',
      decisionId: decision.id,
      title: decision.title,
      tier: decision.decisionType,
      result,
      ceoVote: decision.ceoVote,
      daoVote: decision.daoVote,
    },
    priority: 'normal',
    timestamp: new Date(),
    requiresResponse: false,
  };

  await publish(channels.broadcast, message);
}

// === Human Escalation ===

interface EscalationRequest {
  reason: string;
  decisionId?: string;
  channels: ('telegram' | 'email' | 'dashboard')[];
}

export async function triggerEscalation(request: EscalationRequest): Promise<string> {
  logger.info({ reason: request.reason, channels: request.channels }, 'Triggering human escalation');

  const escalation = await escalationRepo.create({
    decisionId: request.decisionId || '',
    reason: request.reason,
    channelsNotified: request.channels,
    status: 'pending',
  });

  // TODO: Actually send notifications via telegram, email, etc.
  // This will be implemented in the notification module

  return escalation.id;
}

// === Subscription Setup ===

// Restore timeouts for pending decisions on startup
async function restoreDecisionTimeouts(): Promise<void> {
  const pendingDecisions = await decisionRepo.findPending();

  for (const decision of pendingDecisions) {
    // Skip escalated decisions - they're waiting for human
    if (decision.status === 'escalated') continue;
    // Skip operational tier - no timeouts
    if (decision.decisionType === 'operational') continue;

    const requirements = APPROVAL_REQUIREMENTS[decision.decisionType];
    if (!requirements || requirements.timeoutMs <= 0) continue;

    // Calculate remaining time
    const elapsed = Date.now() - new Date(decision.createdAt).getTime();
    const remaining = requirements.timeoutMs - elapsed;

    if (remaining <= 0) {
      // Already expired - process immediately
      logger.info({ decisionId: decision.id, tier: decision.decisionType }, 'Decision timeout already expired, processing now');
      if (requirements.autoApproveOnTimeout) {
        await decisionRepo.updateStatus(decision.id, 'approved', new Date());
        await broadcastDecisionResult(decision, 'approved');
      } else {
        await escalateToHuman(decision);
      }
    } else {
      // Schedule remaining timeout
      logger.info({ decisionId: decision.id, tier: decision.decisionType, remainingMs: remaining }, 'Restoring decision timeout');
      scheduleDecisionTimeout(decision.id, decision.decisionType, remaining);
    }
  }
}

export async function initialize(): Promise<void> {
  logger.info('Initializing event system');

  // Subscribe to all channels
  await subscribe(channels.broadcast, processMessage);
  await subscribe(channels.head, processMessage);
  await subscribe(channels.clevel, processMessage);

  // Subscribe to orchestrator-specific channel
  await subscribe('channel:orchestrator', processMessage);

  // Restore timeouts for any pending decisions from DB
  await restoreDecisionTimeouts();

  logger.info('Event system initialized');
}

// === Utility Functions ===

export async function sendToAgent(
  agentId: string,
  messageType: string,
  payload: unknown,
  options: {
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    requiresResponse?: boolean;
    responseDeadline?: Date;
  } = {}
): Promise<string> {
  const message: AgentMessage = {
    id: uuid(),
    type: messageType as any,
    from: 'orchestrator',
    to: agentId,
    payload,
    priority: options.priority || 'normal',
    timestamp: new Date(),
    requiresResponse: options.requiresResponse || false,
    responseDeadline: options.responseDeadline,
  };

  await publish(channels.agent(agentId), message);
  return message.id;
}

export async function broadcast(
  messageType: string,
  payload: unknown,
  target: 'all' | 'head' | 'clevel' = 'all'
): Promise<string> {
  const message: AgentMessage = {
    id: uuid(),
    type: messageType as any,
    from: 'orchestrator',
    to: target,
    payload,
    priority: 'normal',
    timestamp: new Date(),
    requiresResponse: false,
  };

  const channel =
    target === 'all' ? channels.broadcast :
    target === 'head' ? channels.head :
    channels.clevel;

  await publish(channel, message);
  return message.id;
}

// Export for testing
export { decisionTimeouts };
