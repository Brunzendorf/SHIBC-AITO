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
// DOMAIN WHITELIST - Dynamic from PostgreSQL
// ============================================
// Loaded dynamically from database for easy management
// Use the /whitelist API or dashboard to add/remove domains

import { domainWhitelistRepo, domainApprovalRepo, type DomainWhitelist } from './db.js';
import type { AgentType as AgentTypeFromTypes } from './types.js';

// Cache for whitelist (refreshed periodically)
let cachedWhitelist: string[] = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Load whitelist from database with caching
 */
async function loadWhitelist(): Promise<string[]> {
  const now = Date.now();
  if (cachedWhitelist.length > 0 && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedWhitelist;
  }

  try {
    cachedWhitelist = await domainWhitelistRepo.getAllDomains();
    cacheTimestamp = now;
    logger.info({ count: cachedWhitelist.length }, 'Domain whitelist loaded from DB');
    return cachedWhitelist;
  } catch (error) {
    logger.warn({ error }, 'Failed to load whitelist from DB, using cached');
    return cachedWhitelist;
  }
}

/**
 * Check if a URL's domain is in the whitelist (async - uses DB)
 */
export async function isDomainWhitelistedAsync(url: string): Promise<boolean> {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();
    return domainWhitelistRepo.isDomainWhitelisted(domain);
  } catch {
    return false;
  }
}

/**
 * Check if a URL's domain is in the whitelist (sync - uses cache)
 */
export function isDomainWhitelisted(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase();

    return cachedWhitelist.some(trusted => {
      return domain === trusted || domain.endsWith('.' + trusted);
    });
  } catch {
    return false;
  }
}

/**
 * Get whitelist as formatted string for prompts (async - loads from DB)
 */
export async function getWhitelistForPromptAsync(): Promise<string> {
  try {
    const whitelist = await domainWhitelistRepo.getAll();
    const byCategory: Record<string, string[]> = {};

    for (const entry of whitelist) {
      if (!byCategory[entry.category]) {
        byCategory[entry.category] = [];
      }
      byCategory[entry.category].push(entry.domain);
    }

    let result = '**Trusted Domains for Web Search (from Database):**\n';
    for (const [category, domains] of Object.entries(byCategory)) {
      result += `- ${category}: ${domains.join(', ')}\n`;
    }
    result += '\n⚠️ WICHTIG: Nur diese Domains sind erlaubt! Unbekannte Domains → Eskalation an Human Oversight.';
    result += '\n💡 Neue Domains können über das Dashboard hinzugefügt werden.';
    return result;
  } catch (error) {
    logger.warn({ error }, 'Failed to load whitelist for prompt');
    return '**Domain Whitelist:** Konnte nicht geladen werden - bitte auf bekannte Domains beschränken.';
  }
}

/**
 * Get whitelist as formatted string (sync - uses cache)
 */
export function getWhitelistForPrompt(): string {
  if (cachedWhitelist.length === 0) {
    // Fallback if cache empty
    return '**Domain Whitelist:** Wird geladen... Bitte auf bekannte sichere Domains beschränken.';
  }

  let result = '**Trusted Domains:**\n';
  result += cachedWhitelist.join(', ');
  result += '\n\n⚠️ WICHTIG: Nur diese Domains sind erlaubt! Unbekannte Domains → Eskalation an Human Oversight.';
  return result;
}

/**
 * Initialize whitelist cache on startup
 */
export async function initializeWhitelistCache(): Promise<void> {
  await loadWhitelist();
}

/**
 * Force refresh of whitelist cache
 */
export async function refreshWhitelistCache(): Promise<string[]> {
  cacheTimestamp = 0;
  return loadWhitelist();
}

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

// ============================================
// DOMAIN APPROVAL REQUEST
// ============================================

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Suggest a category for a domain based on URL patterns
 */
function suggestCategory(domain: string, url: string): string {
  const d = domain.toLowerCase();
  const u = url.toLowerCase();

  // API domains
  if (d.startsWith('api.') || d.includes('.api.') || u.includes('/api/')) {
    if (d.includes('coingecko') || d.includes('coinmarketcap') || d.includes('crypto')) {
      return 'crypto_data';
    }
    if (d.includes('etherscan') || d.includes('blockchain') || d.includes('eth')) {
      return 'blockchain';
    }
    return 'api';
  }

  // Social platforms
  if (d.includes('twitter') || d.includes('x.com') || d.includes('reddit') ||
      d.includes('telegram') || d.includes('discord') || d.includes('t.me')) {
    return 'social';
  }

  // News sites
  if (d.includes('news') || d.includes('blog') || d.includes('medium')) {
    return 'news';
  }

  // Blockchain explorers
  if (d.includes('scan') || d.includes('explorer')) {
    return 'blockchain';
  }

  // Documentation
  if (d.includes('docs.') || d.includes('doc.') || u.includes('/docs/')) {
    return 'documentation';
  }

  // GitHub
  if (d.includes('github') || d.includes('gitlab')) {
    return 'development';
  }

  return 'general';
}

/**
 * Calculate a basic security score for a domain (0-100)
 * Higher scores = more likely safe
 */
function calculateSecurityScore(domain: string, url: string): number {
  let score = 50; // Base score

  const d = domain.toLowerCase();

  // Positive indicators
  if (d.endsWith('.com') || d.endsWith('.org') || d.endsWith('.io')) score += 10;
  if (d.includes('api.')) score += 10; // API subdomain
  if (d.includes('docs.')) score += 10; // Documentation
  if (d.startsWith('www.')) score += 5; // Standard www prefix

  // Well-known domains get bonus
  const knownPatterns = [
    'coingecko', 'coinmarketcap', 'etherscan', 'github', 'telegram',
    'twitter', 'reddit', 'google', 'amazon', 'cloudflare', 'microsoft',
    'cointelegraph', 'coindesk', 'decrypt', 'ethereum', 'bitcoin'
  ];
  if (knownPatterns.some(p => d.includes(p))) score += 20;

  // Negative indicators
  if (d.length > 30) score -= 10; // Very long domain
  if (d.split('.').length > 4) score -= 10; // Too many subdomains
  if (/\d{4,}/.test(d)) score -= 15; // Has 4+ consecutive digits
  if (d.includes('free') || d.includes('bonus') || d.includes('win')) score -= 20; // Spammy words

  // HTTPS check (from URL)
  if (url.startsWith('https://')) score += 5;
  if (url.startsWith('http://') && !url.startsWith('https://')) score -= 10;

  return Math.max(0, Math.min(100, score));
}

/**
 * Create a domain approval request for a non-whitelisted URL
 * Returns the request ID if created, or null if already pending
 */
export async function createDomainApprovalRequest(
  url: string,
  requestedBy: AgentTypeFromTypes,
  taskContext: string,
  reason?: string
): Promise<{ created: boolean; requestId?: string; alreadyPending?: boolean; domain: string } | null> {
  const domain = extractDomain(url);
  if (!domain) {
    logger.warn({ url }, 'Invalid URL for domain approval request');
    return null;
  }

  // Check if already whitelisted (race condition safety)
  const isWhitelisted = await isDomainWhitelistedAsync(url);
  if (isWhitelisted) {
    logger.debug({ domain }, 'Domain already whitelisted, no approval needed');
    return { created: false, domain, alreadyPending: false };
  }

  // Check if there's already a pending request for this domain
  const hasPending = await domainApprovalRepo.hasPendingRequest(domain);
  if (hasPending) {
    logger.info({ domain }, 'Pending approval request already exists for domain');
    return { created: false, domain, alreadyPending: true };
  }

  // Calculate suggestions
  const suggestedCategory = suggestCategory(domain, url);
  const securityScore = calculateSecurityScore(domain, url);

  // Create the request
  const request = await domainApprovalRepo.create({
    domain,
    url,
    requestedBy,
    taskContext: taskContext.slice(0, 500), // Limit context length
    reason,
    suggestedCategory,
    securityScore,
  });

  logger.info({
    requestId: request.id,
    domain,
    requestedBy,
    suggestedCategory,
    securityScore,
  }, 'Domain approval request created');

  return { created: true, requestId: request.id, domain };
}

/**
 * Check multiple URLs and return non-whitelisted domains
 */
export async function checkUrlsForApproval(urls: string[]): Promise<{ url: string; domain: string }[]> {
  const nonWhitelisted: { url: string; domain: string }[] = [];

  for (const url of urls) {
    const domain = extractDomain(url);
    if (!domain) continue;

    const isWhitelisted = await isDomainWhitelistedAsync(url);
    if (!isWhitelisted) {
      nonWhitelisted.push({ url, domain });
    }
  }

  return nonWhitelisted;
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
  extractDomain,
  createDomainApprovalRequest,
  checkUrlsForApproval,
  API_REGISTRY,
  DOMAIN_AGENTS,
};
