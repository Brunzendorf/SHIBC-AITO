import { describe, it, expect } from 'vitest';
import type {
  Agent,
  AgentType,
  AgentStatus,
  AgentState,
  AgentHistory,
  Decision,
  DecisionType,
  DecisionStatus,
  VoteValue,
  Task,
  TaskStatus,
  TaskPriority,
  Event,
  EventType,
  AgentMessage,
  MessageType,
  MessagePriority,
  Escalation,
  EscalationStatus,
  EscalationChannel,
  ContainerConfig,
  HealthStatus,
  ApiResponse,
  ScheduledJob,
  Metric,
} from './types.js';

describe('Types', () => {
  describe('AgentType', () => {
    it('should accept valid agent types', () => {
      const types: AgentType[] = ['ceo', 'dao', 'cmo', 'cto', 'cfo', 'coo', 'cco'];
      expect(types).toHaveLength(7);
    });
  });

  describe('AgentStatus', () => {
    it('should accept valid statuses', () => {
      const statuses: AgentStatus[] = ['inactive', 'starting', 'active', 'stopping', 'error'];
      expect(statuses).toHaveLength(5);
    });
  });

  describe('Agent', () => {
    it('should create valid agent object', () => {
      const agent: Agent = {
        id: 'test-id',
        type: 'ceo',
        name: 'CEO Agent',
        profilePath: '/profiles/ceo.md',
        loopInterval: 3600,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(agent.type).toBe('ceo');
      expect(agent.loopInterval).toBe(3600);
    });

    it('should allow optional fields', () => {
      const agent: Agent = {
        id: 'test-id',
        type: 'cmo',
        name: 'CMO Agent',
        profilePath: '/profiles/cmo.md',
        loopInterval: 14400,
        gitRepo: 'og-shibaclassic',
        gitFilter: 'content/*',
        status: 'inactive',
        containerId: 'container-123',
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(agent.gitRepo).toBe('og-shibaclassic');
      expect(agent.containerId).toBe('container-123');
    });
  });

  describe('AgentState', () => {
    it('should create valid state object', () => {
      const state: AgentState = {
        id: 'state-id',
        agentId: 'agent-id',
        stateKey: 'last_analysis',
        stateValue: { result: 'positive' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(state.stateKey).toBe('last_analysis');
    });
  });

  describe('AgentHistory', () => {
    it('should create valid history entry', () => {
      const history: AgentHistory = {
        id: 'history-id',
        agentId: 'agent-id',
        actionType: 'decision',
        summary: 'Made strategic decision',
        details: { decision: 'approve' },
        embedding: [0.1, 0.2, 0.3],
        createdAt: new Date(),
      };
      expect(history.actionType).toBe('decision');
      expect(history.embedding).toHaveLength(3);
    });
  });

  describe('Decision', () => {
    it('should create valid decision object', () => {
      const decision: Decision = {
        id: 'decision-id',
        title: 'Marketing Campaign',
        description: 'Launch new campaign',
        proposedBy: 'cmo-agent-id',
        decisionType: 'major',
        status: 'pending',
        vetoRound: 0,
        createdAt: new Date(),
      };
      expect(decision.decisionType).toBe('major');
      expect(decision.status).toBe('pending');
    });

    it('should handle votes', () => {
      const decision: Decision = {
        id: 'decision-id',
        title: 'Budget Allocation',
        proposedBy: 'cfo-agent-id',
        decisionType: 'critical',
        status: 'escalated',
        vetoRound: 2,
        ceoVote: 'approve',
        daoVote: 'veto',
        cLevelVotes: { cmo: 'approve', cto: 'abstain', cfo: 'approve' },
        humanDecision: 'approve',
        resolvedAt: new Date(),
        createdAt: new Date(),
      };
      expect(decision.ceoVote).toBe('approve');
      expect(decision.daoVote).toBe('veto');
      expect(decision.humanDecision).toBe('approve');
    });
  });

  describe('Task', () => {
    it('should create valid task object', () => {
      const task: Task = {
        id: 'task-id',
        title: 'Write blog post',
        description: 'Create content about tokenomics',
        assignedTo: 'cmo-agent-id',
        createdBy: 'ceo-agent-id',
        status: 'pending',
        priority: 2,
        dueDate: new Date(),
        createdAt: new Date(),
      };
      expect(task.priority).toBe(2);
      expect(task.status).toBe('pending');
    });

    it('should handle completed tasks', () => {
      const task: Task = {
        id: 'task-id',
        title: 'Completed task',
        assignedTo: 'cto-agent-id',
        createdBy: 'ceo-agent-id',
        status: 'completed',
        priority: 3,
        completedAt: new Date(),
        result: { success: true, output: 'Done' },
        createdAt: new Date(),
      };
      expect(task.status).toBe('completed');
      expect(task.result).toEqual({ success: true, output: 'Done' });
    });
  });

  describe('Event', () => {
    it('should create valid event object', () => {
      const event: Event = {
        id: 'event-id',
        eventType: 'agent_started',
        sourceAgent: 'ceo-agent-id',
        payload: { containerId: 'container-123' },
        createdAt: new Date(),
      };
      expect(event.eventType).toBe('agent_started');
    });

    it('should handle all event types', () => {
      const eventTypes: EventType[] = [
        'agent_started',
        'agent_stopped',
        'agent_error',
        'task_created',
        'task_completed',
        'decision_proposed',
        'decision_voted',
        'decision_resolved',
        'escalation_created',
        'escalation_resolved',
        'status_request',
        'status_response',
        'broadcast',
      ];
      expect(eventTypes).toHaveLength(13);
    });
  });

  describe('AgentMessage', () => {
    it('should create valid message object', () => {
      const message: AgentMessage = {
        id: 'msg-id',
        type: 'task',
        from: 'ceo',
        to: 'cmo',
        payload: { title: 'New task' },
        priority: 'high',
        timestamp: new Date(),
        requiresResponse: true,
        responseDeadline: new Date(),
      };
      expect(message.type).toBe('task');
      expect(message.priority).toBe('high');
    });

    it('should handle broadcast messages', () => {
      const message: AgentMessage = {
        id: 'msg-id',
        type: 'broadcast',
        from: 'orchestrator',
        to: 'all',
        payload: { announcement: 'System update' },
        priority: 'normal',
        timestamp: new Date(),
        requiresResponse: false,
      };
      expect(message.to).toBe('all');
    });
  });

  describe('Escalation', () => {
    it('should create valid escalation object', () => {
      const escalation: Escalation = {
        id: 'escalation-id',
        decisionId: 'decision-id',
        reason: 'Deadlock after 3 rounds',
        channelsNotified: ['telegram', 'email'],
        status: 'pending',
        createdAt: new Date(),
      };
      expect(escalation.channelsNotified).toContain('telegram');
    });

    it('should handle responded escalation', () => {
      const escalation: Escalation = {
        id: 'escalation-id',
        decisionId: 'decision-id',
        reason: 'Urgent decision needed',
        channelsNotified: ['telegram', 'email', 'dashboard'],
        humanResponse: 'Approved with conditions',
        respondedAt: new Date(),
        status: 'responded',
        createdAt: new Date(),
      };
      expect(escalation.status).toBe('responded');
      expect(escalation.humanResponse).toBeDefined();
    });
  });

  describe('ContainerConfig', () => {
    it('should create valid container config', () => {
      const config: ContainerConfig = {
        image: 'aito-agent:latest',
        name: 'aito-ceo',
        environment: {
          AGENT_TYPE: 'ceo',
          LOOP_INTERVAL: '3600',
        },
        volumes: ['/profiles:/profiles:ro'],
        ports: ['3000:3000'],
        memory: '512m',
        cpus: '1',
        restart: 'unless-stopped',
      };
      expect(config.image).toBe('aito-agent:latest');
      expect(config.restart).toBe('unless-stopped');
    });
  });

  describe('HealthStatus', () => {
    it('should create valid health status', () => {
      const status: HealthStatus = {
        agentId: 'agent-id',
        status: 'healthy',
        lastCheck: new Date(),
        containerId: 'container-123',
        containerStatus: 'running',
        memoryUsage: 256000000,
        cpuUsage: 15.5,
      };
      expect(status.status).toBe('healthy');
      expect(status.cpuUsage).toBe(15.5);
    });

    it('should handle unhealthy status', () => {
      const status: HealthStatus = {
        agentId: 'agent-id',
        status: 'unhealthy',
        lastCheck: new Date(),
        errorMessage: 'Container crashed',
      };
      expect(status.status).toBe('unhealthy');
      expect(status.errorMessage).toBeDefined();
    });
  });

  describe('ApiResponse', () => {
    it('should create success response', () => {
      const response: ApiResponse<{ agents: string[] }> = {
        success: true,
        data: { agents: ['ceo', 'dao'] },
        timestamp: new Date(),
      };
      expect(response.success).toBe(true);
      expect(response.data?.agents).toHaveLength(2);
    });

    it('should create error response', () => {
      const response: ApiResponse = {
        success: false,
        error: 'Agent not found',
        timestamp: new Date(),
      };
      expect(response.success).toBe(false);
      expect(response.error).toBe('Agent not found');
    });
  });

  describe('ScheduledJob', () => {
    it('should create valid scheduled job', () => {
      const job: ScheduledJob = {
        id: 'job-id',
        agentId: 'agent-id',
        cronExpression: '0 * * * *',
        lastRun: new Date(),
        nextRun: new Date(),
        enabled: true,
      };
      expect(job.cronExpression).toBe('0 * * * *');
      expect(job.enabled).toBe(true);
    });
  });

  describe('Metric', () => {
    it('should create valid metric', () => {
      const metric: Metric = {
        name: 'agent_health',
        value: 1,
        labels: { type: 'ceo', status: 'healthy' },
        timestamp: new Date(),
      };
      expect(metric.name).toBe('agent_health');
      expect(metric.labels.type).toBe('ceo');
    });
  });
});
