import { v4 as uuid } from 'uuid';
import { createLogger } from '../lib/logger.js';
import { eventRepo, decisionRepo, escalationRepo, agentRepo } from '../lib/db.js';
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

const logger = createLogger('events');

// Message handlers registry
type MessageHandler = (message: AgentMessage) => Promise<void>;
const messageHandlers: Map<string, MessageHandler> = new Map();

// Register a message handler for a specific message type
export function registerHandler(
  messageType: string,
  handler: MessageHandler
): void {
  messageHandlers.set(messageType, handler);
  logger.debug({ messageType }, 'Registered message handler');
}

// Process incoming message
async function processMessage(message: AgentMessage): Promise<void> {
  logger.debug({ messageType: message.type, from: message.from, to: message.to }, 'Processing message');

  // Log event
  await eventRepo.log({
    eventType: message.type as EventType,
    sourceAgent: message.from,
    targetAgent: typeof message.to === 'string' ? message.to : undefined,
    payload: message.payload,
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

// Handle decision proposals
registerHandler('decision', async (message) => {
  const payload = message.payload as any;

  // Create decision record
  const decision = await decisionRepo.create({
    title: payload.title,
    description: payload.description,
    proposedBy: message.from,
    decisionType: payload.type as DecisionType || 'major',
    status: 'pending',
    vetoRound: 0,
  });

  logger.info({ decisionId: decision.id, title: decision.title }, 'Decision proposed');

  // Notify HEAD layer (CEO + DAO)
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
      type: decision.decisionType,
      round: 1,
    },
    priority: 'high',
    timestamp: new Date(),
    requiresResponse: true,
    responseDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
  };

  await publish(channels.head, notifyMessage);
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
  }, 'Vote recorded');

  // Check if both HEAD members have voted
  const updatedDecision = await decisionRepo.findById(decision.id);
  if (updatedDecision?.ceoVote && updatedDecision?.daoVote) {
    await processDecisionResult(updatedDecision);
  }
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

// === Decision Processing ===

async function processDecisionResult(decision: Decision): Promise<void> {
  const ceoVote = decision.ceoVote;
  const daoVote = decision.daoVote;

  // Both approve → Approved
  if (ceoVote === 'approve' && daoVote === 'approve') {
    await decisionRepo.updateStatus(decision.id, 'approved', new Date());
    await broadcastDecisionResult(decision, 'approved');
    return;
  }

  // Both veto → Rejected
  if (ceoVote === 'veto' && daoVote === 'veto') {
    await decisionRepo.updateStatus(decision.id, 'vetoed', new Date());
    await broadcastDecisionResult(decision, 'vetoed');
    return;
  }

  // One veto → Proceed to next round
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
  logger.warn({ decisionId: decision.id }, 'Escalating decision to human');

  await decisionRepo.updateStatus(decision.id, 'escalated');

  await triggerEscalation({
    reason: `Decision deadlock after ${numericConfig.maxVetoRounds} rounds: ${decision.title}`,
    decisionId: decision.id,
    channels: ['telegram', 'email', 'dashboard'],
  });
}

async function broadcastDecisionResult(
  decision: Decision,
  result: 'approved' | 'vetoed'
): Promise<void> {
  const message: AgentMessage = {
    id: uuid(),
    type: 'broadcast',
    from: 'orchestrator',
    to: 'all',
    payload: {
      eventType: 'decision_resolved',
      decisionId: decision.id,
      title: decision.title,
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

export async function initialize(): Promise<void> {
  logger.info('Initializing event system');

  // Subscribe to all channels
  await subscribe(channels.broadcast, processMessage);
  await subscribe(channels.head, processMessage);
  await subscribe(channels.clevel, processMessage);

  // Subscribe to orchestrator-specific channel
  await subscribe('channel:orchestrator', processMessage);

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
