/**
 * Team Status Context Source
 * TASK-037: Live team/agent status from database
 */

import type { ContextSource, AgentType } from '../../types.js';
import { agentRepo } from '../../../db.js';
import { createLogger } from '../../../logger.js';

const logger = createLogger('initiative:context:team');

/**
 * All agent types
 */
const ALL_AGENTS: AgentType[] = ['ceo', 'cmo', 'cto', 'cfo', 'coo', 'cco', 'dao'];

/**
 * Team Status Context Source
 * Fetches current status of all agents from PostgreSQL
 */
export class TeamStatusContextSource implements ContextSource {
  readonly name = 'team-status';
  readonly label = 'Team Status';
  readonly cacheTTL = 60; // 1 minute - status changes frequently

  async fetch(_agentType: AgentType): Promise<string> {
    const status = await this.getTeamStatus();

    if (Object.keys(status).length === 0) {
      return 'No team data available';
    }

    return Object.entries(status)
      .map(([agent, statusStr]) => `- ${agent}: ${statusStr}`)
      .join('\n');
  }

  async isAvailable(): Promise<boolean> {
    try {
      await agentRepo.findByType('ceo');
      return true;
    } catch {
      return false;
    }
  }

  private async getTeamStatus(): Promise<Record<string, string>> {
    const status: Record<string, string> = {};

    for (const agentType of ALL_AGENTS) {
      try {
        // Get agent from DB to get their ID
        const agent = await agentRepo.findByType(agentType);
        if (!agent) continue;

        // Query PostgreSQL for agent state
        const { stateRepo } = await import('../../../db.js');
        const stateData = await stateRepo.getAll(agent.id);

        if (stateData && Object.keys(stateData).length > 0) {
          const loopCount = stateData.loop_count || '?';
          const lastActive = stateData.last_loop_at
            ? new Date(String(stateData.last_loop_at)).toLocaleString()
            : 'unknown';
          const currentStatus = stateData.status || stateData.current_focus || 'active';
          status[agentType.toUpperCase()] = `Loop ${loopCount}, ${currentStatus}, last: ${lastActive}`;
        }
      } catch (error) {
        logger.debug({ agentType, error }, 'Failed to get agent status');
      }
    }

    return status;
  }
}

/**
 * Create team status context source
 */
export function createTeamStatusSource(): ContextSource {
  return new TeamStatusContextSource();
}
