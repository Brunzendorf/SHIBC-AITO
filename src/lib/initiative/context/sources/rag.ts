/**
 * RAG Context Source
 * TASK-037: Retrieval-Augmented Generation context
 */

import type { ContextSource, AgentType } from '../../types.js';
import { search } from '../../../rag.js';
import { createLogger } from '../../../logger.js';

const logger = createLogger('initiative:context:rag');

/**
 * Agent-specific scan topics
 */
const AGENT_SCAN_TOPICS: Record<AgentType, string[]> = {
  ceo: ['roadmap', 'team status', 'blockers', 'strategy'],
  cmo: ['crypto trends', 'meme marketing', 'community growth'],
  cfo: ['defi yields', 'grants', 'treasury management'],
  cto: ['smart contracts', 'security', 'infrastructure'],
  coo: ['operations', 'partnerships', 'efficiency'],
  cco: ['crypto regulations', 'compliance', 'legal'],
  dao: ['governance', 'voting', 'dao management'],
};

/**
 * RAG Context Source
 * Scans RAG knowledge base for relevant context
 */
export class RAGContextSource implements ContextSource {
  readonly name = 'rag';
  readonly label = 'RAG Knowledge';
  readonly cacheTTL = 300; // 5 minutes

  private topicsOverride?: string[];

  constructor(topics?: string[]) {
    this.topicsOverride = topics;
  }

  async fetch(agentType: AgentType): Promise<string> {
    const topics = this.topicsOverride || AGENT_SCAN_TOPICS[agentType] || [];
    const results = await this.scanRAG(topics);

    if (results.length === 0) {
      return 'No relevant knowledge found.';
    }

    return results.slice(0, 5).join('\n');
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Quick check if RAG is responsive
      await search('test', 1);
      return true;
    } catch {
      return false;
    }
  }

  private async scanRAG(topics: string[]): Promise<string[]> {
    const results: string[] = [];

    for (const topic of topics) {
      try {
        const hits = await search(topic, 3);
        for (const hit of hits) {
          results.push(`[${hit.source}] ${hit.text.slice(0, 200)}`);
        }
      } catch (error) {
        logger.debug({ topic, error }, 'RAG scan failed for topic');
      }
    }

    return results;
  }
}

/**
 * Create RAG context source with optional custom topics
 */
export function createRAGSource(topics?: string[]): ContextSource {
  return new RAGContextSource(topics);
}

/**
 * Get scan topics for an agent type
 */
export function getScanTopics(agentType: AgentType): string[] {
  return AGENT_SCAN_TOPICS[agentType] || [];
}
