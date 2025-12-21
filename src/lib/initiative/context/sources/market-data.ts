/**
 * Market Data Context Source
 * TASK-037: Live market data, news, fear & greed index
 */

import type { ContextSource, AgentType } from '../../types.js';
import { buildDataContext } from '../../../data-fetcher.js';
import { createLogger } from '../../../logger.js';

const logger = createLogger('initiative:context:market');

/**
 * Market Data Context Source
 * Fetches live market conditions using data-fetcher
 */
export class MarketDataContextSource implements ContextSource {
  readonly name = 'market-data';
  readonly label = 'Market Data';
  readonly cacheTTL = 900; // 15 minutes - market data doesn't change that fast

  async fetch(_agentType: AgentType): Promise<string> {
    try {
      const context = await buildDataContext();
      return context || 'Market data unavailable';
    } catch (error) {
      logger.warn({ error }, 'Failed to fetch market data');
      return 'Market data unavailable';
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const context = await buildDataContext();
      return !!context;
    } catch {
      return false;
    }
  }
}

/**
 * Create market data context source
 */
export function createMarketDataSource(): ContextSource {
  return new MarketDataContextSource();
}
