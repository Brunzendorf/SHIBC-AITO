/**
 * API Registry - External API definitions for MCP Workers
 *
 * SECURITY: Contains NO actual API keys - only env var NAMES!
 * Keys are resolved at runtime from process.env by the fetch MCP server.
 *
 * This registry enables self-learning: workers know which APIs exist,
 * how to call them, and which env var provides authentication.
 */

import { createLogger } from './logger.js';
import type { AgentType } from './types.js';

const logger = createLogger('api-registry');

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface APIParameter {
  name: string;
  required: boolean;
  description: string;
  example?: string;
  type?: 'string' | 'number' | 'boolean';
}

export interface APIEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  description: string;
  parameters: APIParameter[];
  exampleResponse?: string;
  rateLimitNote?: string;
}

export interface APIDefinition {
  name: string;
  description: string;
  baseUrl: string;
  authType: 'header' | 'query' | 'bearer' | 'none';
  authEnvVar?: string;           // Name of env var, NOT the value!
  authHeaderName?: string;       // e.g., "X-API-Key", "x-cg-demo-api-key"
  authQueryParam?: string;       // e.g., "apikey", "api_key"
  domain: APIDomain;
  primaryAgents: AgentType[];    // Agents with direct access
  endpoints: APIEndpoint[];
  rateLimit?: string;            // e.g., "30 req/min"
  docs?: string;                 // Link to official docs
  notes?: string;                // Usage hints
}

export type APIDomain = 'finance' | 'blockchain' | 'content' | 'social' | 'general';

// ============================================
// API DEFINITIONS (NO KEYS!)
// ============================================

export const API_REGISTRY: APIDefinition[] = [
  // =========== FINANCE DOMAIN ===========
  {
    name: 'coingecko',
    description: 'Cryptocurrency prices, market data, and token info',
    baseUrl: 'https://api.coingecko.com/api/v3',
    authType: 'header',
    authEnvVar: 'COINGECKO_API_KEY',
    authHeaderName: 'x-cg-demo-api-key',
    domain: 'finance',
    primaryAgents: ['cfo', 'dao'],
    rateLimit: '30 req/min (free tier)',
    docs: 'https://docs.coingecko.com/reference/introduction',
    endpoints: [
      {
        path: '/simple/price',
        method: 'GET',
        description: 'Get current price of tokens in specified currencies',
        parameters: [
          { name: 'ids', required: true, description: 'Token IDs (comma-separated)', example: 'ethereum,bitcoin,shiba-classic-2' },
          { name: 'vs_currencies', required: true, description: 'Target currencies', example: 'usd,eur' },
          { name: 'include_24hr_change', required: false, description: 'Include 24h price change', example: 'true' },
        ],
        exampleResponse: '{"ethereum":{"usd":3500,"usd_24h_change":2.5}}',
      },
      {
        path: '/coins/{id}',
        method: 'GET',
        description: 'Get detailed token information including description, links, market data',
        parameters: [
          { name: 'id', required: true, description: 'Token ID from /coins/list', example: 'shiba-classic-2' },
          { name: 'localization', required: false, description: 'Include localized content', example: 'false' },
        ],
        exampleResponse: '{"id":"shiba-classic-2","symbol":"shibc","name":"Shiba Classic","market_data":{...}}',
      },
      {
        path: '/coins/{id}/market_chart',
        method: 'GET',
        description: 'Get historical market data (price, market cap, volume)',
        parameters: [
          { name: 'id', required: true, description: 'Token ID', example: 'ethereum' },
          { name: 'vs_currency', required: true, description: 'Target currency', example: 'usd' },
          { name: 'days', required: true, description: 'Data range in days', example: '7' },
        ],
        exampleResponse: '{"prices":[[timestamp,price],...]}',
      },
    ],
  },

  {
    name: 'coinmarketcap',
    description: 'Crypto market rankings, quotes, and metadata',
    baseUrl: 'https://pro-api.coinmarketcap.com/v1',
    authType: 'header',
    authEnvVar: 'COINMARKETCAP_API_KEY',
    authHeaderName: 'X-CMC_PRO_API_KEY',
    domain: 'finance',
    primaryAgents: ['cfo'],
    rateLimit: '333 req/day (free tier)',
    docs: 'https://coinmarketcap.com/api/documentation/v1/',
    endpoints: [
      {
        path: '/cryptocurrency/quotes/latest',
        method: 'GET',
        description: 'Get latest market quote for cryptocurrencies',
        parameters: [
          { name: 'symbol', required: false, description: 'Token symbols (comma-separated)', example: 'BTC,ETH' },
          { name: 'slug', required: false, description: 'Token slugs', example: 'bitcoin,ethereum' },
          { name: 'convert', required: false, description: 'Convert to currency', example: 'USD' },
        ],
        exampleResponse: '{"data":{"BTC":{"quote":{"USD":{"price":45000}}}}}',
      },
      {
        path: '/cryptocurrency/listings/latest',
        method: 'GET',
        description: 'Get ranked list of all cryptocurrencies',
        parameters: [
          { name: 'limit', required: false, description: 'Number of results', example: '100' },
          { name: 'sort', required: false, description: 'Sort field', example: 'market_cap' },
        ],
        exampleResponse: '{"data":[{"name":"Bitcoin","symbol":"BTC","cmc_rank":1,...}]}',
      },
    ],
  },

  // =========== BLOCKCHAIN DOMAIN ===========
  {
    name: 'etherscan',
    description: 'Ethereum blockchain data - transactions, balances, contracts',
    baseUrl: 'https://api.etherscan.io/api',
    authType: 'query',
    authEnvVar: 'ETHERSCAN_API_KEY',
    authQueryParam: 'apikey',
    domain: 'blockchain',
    primaryAgents: ['cfo', 'dao', 'cto'],
    rateLimit: '5 req/sec',
    docs: 'https://docs.etherscan.io/',
    notes: 'All requests use query params. Add &apikey=${ETHERSCAN_API_KEY} to all calls.',
    endpoints: [
      {
        path: '/',
        method: 'GET',
        description: 'Get ETH balance for address',
        parameters: [
          { name: 'module', required: true, description: 'API module', example: 'account' },
          { name: 'action', required: true, description: 'API action', example: 'balance' },
          { name: 'address', required: true, description: 'Ethereum address', example: '0x...' },
          { name: 'tag', required: false, description: 'Block tag', example: 'latest' },
        ],
        exampleResponse: '{"status":"1","result":"1000000000000000000"}',
      },
      {
        path: '/',
        method: 'GET',
        description: 'Get ERC-20 token balance',
        parameters: [
          { name: 'module', required: true, description: 'API module', example: 'account' },
          { name: 'action', required: true, description: 'API action', example: 'tokenbalance' },
          { name: 'contractaddress', required: true, description: 'Token contract', example: '0x...' },
          { name: 'address', required: true, description: 'Wallet address', example: '0x...' },
        ],
        exampleResponse: '{"status":"1","result":"50000000000000000000"}',
      },
      {
        path: '/',
        method: 'GET',
        description: 'Get transaction list for address',
        parameters: [
          { name: 'module', required: true, description: 'API module', example: 'account' },
          { name: 'action', required: true, description: 'API action', example: 'txlist' },
          { name: 'address', required: true, description: 'Ethereum address', example: '0x...' },
          { name: 'startblock', required: false, description: 'Start block', example: '0' },
          { name: 'endblock', required: false, description: 'End block', example: '99999999' },
          { name: 'sort', required: false, description: 'Sort order', example: 'desc' },
        ],
        exampleResponse: '{"status":"1","result":[{"hash":"0x...","from":"0x...","to":"0x...","value":"..."}]}',
      },
    ],
  },

  // =========== CONTENT DOMAIN ===========
  {
    name: 'newsapi',
    description: 'News articles from worldwide sources',
    baseUrl: 'https://newsapi.org/v2',
    authType: 'header',
    authEnvVar: 'NEWS_API_KEY',
    authHeaderName: 'X-Api-Key',
    domain: 'content',
    primaryAgents: ['cmo', 'coo'],
    rateLimit: '100 req/day (free tier)',
    docs: 'https://newsapi.org/docs',
    endpoints: [
      {
        path: '/everything',
        method: 'GET',
        description: 'Search all articles',
        parameters: [
          { name: 'q', required: true, description: 'Search query', example: 'cryptocurrency OR blockchain' },
          { name: 'language', required: false, description: 'Article language', example: 'en' },
          { name: 'sortBy', required: false, description: 'Sort order', example: 'publishedAt' },
          { name: 'pageSize', required: false, description: 'Results per page', example: '10' },
        ],
        exampleResponse: '{"articles":[{"title":"...","description":"...","url":"..."}]}',
      },
      {
        path: '/top-headlines',
        method: 'GET',
        description: 'Get top headlines',
        parameters: [
          { name: 'category', required: false, description: 'News category', example: 'technology' },
          { name: 'country', required: false, description: 'Country code', example: 'us' },
          { name: 'q', required: false, description: 'Search keyword', example: 'crypto' },
        ],
        exampleResponse: '{"articles":[{"title":"...","source":{"name":"..."},"url":"..."}]}',
      },
    ],
  },

  // =========== SOCIAL DOMAIN ===========
  {
    name: 'reddit',
    description: 'Reddit posts and comments for community sentiment',
    baseUrl: 'https://oauth.reddit.com',
    authType: 'bearer',
    authEnvVar: 'REDDIT_ACCESS_TOKEN',
    domain: 'social',
    primaryAgents: ['cmo', 'coo'],
    rateLimit: '60 req/min',
    docs: 'https://www.reddit.com/dev/api/',
    notes: 'Requires OAuth token. Use REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET to obtain token first.',
    endpoints: [
      {
        path: '/r/{subreddit}/hot',
        method: 'GET',
        description: 'Get hot posts from subreddit',
        parameters: [
          { name: 'subreddit', required: true, description: 'Subreddit name', example: 'cryptocurrency' },
          { name: 'limit', required: false, description: 'Number of posts', example: '25' },
        ],
        exampleResponse: '{"data":{"children":[{"data":{"title":"...","score":123}}]}}',
      },
      {
        path: '/search',
        method: 'GET',
        description: 'Search Reddit posts',
        parameters: [
          { name: 'q', required: true, description: 'Search query', example: 'shiba classic' },
          { name: 'sort', required: false, description: 'Sort order', example: 'relevance' },
          { name: 'limit', required: false, description: 'Number of results', example: '10' },
        ],
        exampleResponse: '{"data":{"children":[{"data":{"title":"...","subreddit":"..."}}]}}',
      },
    ],
  },
];

// ============================================
// DOMAIN → AGENT MAPPING
// ============================================

export const DOMAIN_AGENTS: Record<APIDomain, AgentType[]> = {
  finance: ['cfo', 'dao'],
  blockchain: ['cfo', 'dao', 'cto'],
  content: ['cmo', 'coo'],
  social: ['cmo', 'coo'],
  general: ['ceo', 'cfo', 'cmo', 'cto', 'coo', 'cco', 'dao'],
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get all APIs accessible to a specific agent
 */
export function getAPIsForAgent(agentType: AgentType): APIDefinition[] {
  return API_REGISTRY.filter(api =>
    api.primaryAgents.includes(agentType) ||
    DOMAIN_AGENTS[api.domain]?.includes(agentType)
  );
}

/**
 * Get API by name
 */
export function getAPIByName(name: string): APIDefinition | undefined {
  return API_REGISTRY.find(api => api.name.toLowerCase() === name.toLowerCase());
}

/**
 * Match APIs relevant to a task description
 * Uses keyword matching to find relevant APIs
 */
export function getAPIsForTask(taskDescription: string, agentType: AgentType): APIDefinition[] {
  const task = taskDescription.toLowerCase();
  const accessibleAPIs = getAPIsForAgent(agentType);

  // Keyword → API mapping
  const keywordMap: Record<string, string[]> = {
    price: ['coingecko', 'coinmarketcap'],
    token: ['coingecko', 'coinmarketcap', 'etherscan'],
    market: ['coingecko', 'coinmarketcap'],
    balance: ['etherscan'],
    transaction: ['etherscan'],
    wallet: ['etherscan'],
    blockchain: ['etherscan'],
    ethereum: ['etherscan'],
    eth: ['etherscan', 'coingecko'],
    news: ['newsapi'],
    article: ['newsapi'],
    headline: ['newsapi'],
    reddit: ['reddit'],
    community: ['reddit'],
    sentiment: ['reddit', 'newsapi'],
    crypto: ['coingecko', 'coinmarketcap', 'newsapi'],
    shibc: ['coingecko', 'etherscan'],
    'shiba classic': ['coingecko', 'etherscan'],
  };

  const matchedAPIs = new Set<string>();

  for (const [keyword, apis] of Object.entries(keywordMap)) {
    if (task.includes(keyword)) {
      apis.forEach(api => matchedAPIs.add(api));
    }
  }

  // Filter to only APIs this agent can access
  return accessibleAPIs.filter(api => matchedAPIs.has(api.name));
}

/**
 * Generate API documentation string for worker prompt injection
 * IMPORTANT: References env var NAMES, not values!
 */
export function generateAPIPrompt(apis: APIDefinition[]): string {
  if (apis.length === 0) return '';

  const parts: string[] = [
    '## Available APIs for this task',
    '',
    'Use the fetch MCP tool to call these APIs. Authentication is handled via environment variables.',
    ''
  ];

  for (const api of apis) {
    parts.push(`### ${api.name} - ${api.description}`);
    parts.push(`Base URL: ${api.baseUrl}`);

    // Auth instructions (NO actual keys!)
    if (api.authType === 'header' && api.authHeaderName) {
      parts.push(`Auth: Add header "${api.authHeaderName}" with value from env var $\{${api.authEnvVar}\}`);
    } else if (api.authType === 'query' && api.authQueryParam) {
      parts.push(`Auth: Add query param "${api.authQueryParam}" with value from env var $\{${api.authEnvVar}\}`);
    } else if (api.authType === 'bearer') {
      parts.push(`Auth: Bearer token from env var $\{${api.authEnvVar}\}`);
    }

    if (api.rateLimit) {
      parts.push(`Rate limit: ${api.rateLimit}`);
    }

    parts.push('');
    parts.push('Endpoints:');

    for (const endpoint of api.endpoints.slice(0, 3)) { // Limit to 3 endpoints
      const params = endpoint.parameters
        .filter(p => p.required)
        .map(p => `${p.name}=${p.example || '...'}`)
        .join('&');

      parts.push(`- ${endpoint.method} ${endpoint.path}${params ? '?' + params : ''}`);
      parts.push(`  ${endpoint.description}`);
      if (endpoint.exampleResponse) {
        parts.push(`  Example: ${endpoint.exampleResponse.slice(0, 100)}...`);
      }
    }

    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Check if an agent can use a specific API
 */
export function canAgentUseAPI(agentType: AgentType, apiName: string): boolean {
  const api = getAPIByName(apiName);
  if (!api) return false;

  return api.primaryAgents.includes(agentType) ||
         DOMAIN_AGENTS[api.domain]?.includes(agentType);
}

/**
 * Get suggestion for cross-domain request
 * Returns which agent to ask if current agent can't access the API
 */
export function getSuggestedAgent(apiName: string): AgentType | null {
  const api = getAPIByName(apiName);
  if (!api) return null;
  return api.primaryAgents[0] || null;
}

// Log registry on load
logger.info({
  apiCount: API_REGISTRY.length,
  domains: [...new Set(API_REGISTRY.map(a => a.domain))],
}, 'API Registry loaded');

export default {
  getAPIsForAgent,
  getAPIByName,
  getAPIsForTask,
  generateAPIPrompt,
  canAgentUseAPI,
  getSuggestedAgent,
  API_REGISTRY,
  DOMAIN_AGENTS,
};
