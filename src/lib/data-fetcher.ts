/**
 * Background Data Fetcher
 *
 * Periodically fetches external data (news, market, blockchain) and caches in Redis.
 * This provides agents with fresh context for decision-making and initiative generation.
 */

import { createLogger } from './logger.js';
import { redis } from './redis.js';

const logger = createLogger('data-fetcher');

// Redis cache keys
const CACHE_KEYS = {
  CRYPTO_NEWS: 'cache:news:crypto',
  MARKET_DATA: 'cache:market:shibc',
  MARKET_OVERVIEW: 'cache:market:overview',
  FEAR_GREED: 'cache:market:fear_greed',
  LAST_FETCH: 'cache:last_fetch',
} as const;

// Cache TTLs in seconds
const CACHE_TTL = {
  NEWS: 3600,        // 1 hour
  MARKET: 300,       // 5 minutes
  FEAR_GREED: 1800,  // 30 minutes
} as const;

// ============================================
// NEWS FETCHING
// ============================================

interface NewsArticle {
  title: string;
  description: string;
  source: string;
  url: string;
  publishedAt: string;
}

/**
 * Fetch crypto news from NewsAPI
 */
async function fetchCryptoNews(): Promise<NewsArticle[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    logger.warn('NEWS_API_KEY not set, skipping news fetch');
    return [];
  }

  try {
    const response = await fetch(
      `https://newsapi.org/v2/everything?` +
      `q=cryptocurrency OR bitcoin OR ethereum OR meme coin&` +
      `language=en&` +
      `sortBy=publishedAt&` +
      `pageSize=30`,
      {
        headers: {
          'X-Api-Key': apiKey,
        },
      }
    );

    if (!response.ok) {
      logger.warn({ status: response.status }, 'NewsAPI request failed');
      return [];
    }

    const data = await response.json() as { articles?: Array<{
      title: string;
      description: string;
      source: { name: string };
      url: string;
      publishedAt: string;
    }> };

    const articles: NewsArticle[] = (data.articles || []).map(a => ({
      title: a.title,
      description: a.description || '',
      source: a.source?.name || 'Unknown',
      url: a.url,
      publishedAt: a.publishedAt,
    }));

    logger.info({ count: articles.length }, 'Fetched crypto news');
    return articles;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch crypto news');
    return [];
  }
}

// ============================================
// MARKET DATA FETCHING
// ============================================

interface MarketData {
  symbol: string;
  name: string;
  price_usd: number;
  price_change_24h: number;
  market_cap: number;
  volume_24h: number;
  holders?: number;
  last_updated: string;
}

interface MarketOverview {
  total_market_cap: number;
  total_volume_24h: number;
  btc_dominance: number;
  eth_dominance: number;
  top_gainers: Array<{ symbol: string; change: number }>;
  top_losers: Array<{ symbol: string; change: number }>;
  last_updated: string;
}

/**
 * Fetch SHIBC market data from CoinGecko
 */
async function fetchSHIBCMarketData(): Promise<MarketData | null> {
  const apiKey = process.env.COINGECKO_API_KEY;

  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['x-cg-demo-api-key'] = apiKey;
    }

    const response = await fetch(
      'https://api.coingecko.com/api/v3/coins/shiba-classic-2?' +
      'localization=false&tickers=false&community_data=false&developer_data=false',
      { headers }
    );

    if (!response.ok) {
      logger.warn({ status: response.status }, 'CoinGecko SHIBC request failed');
      return null;
    }

    const data = await response.json() as {
      symbol: string;
      name: string;
      market_data: {
        current_price: { usd: number };
        price_change_percentage_24h: number;
        market_cap: { usd: number };
        total_volume: { usd: number };
      };
    };

    const marketData: MarketData = {
      symbol: data.symbol?.toUpperCase() || 'SHIBC',
      name: data.name || 'Shiba Classic',
      price_usd: data.market_data?.current_price?.usd || 0,
      price_change_24h: data.market_data?.price_change_percentage_24h || 0,
      market_cap: data.market_data?.market_cap?.usd || 0,
      volume_24h: data.market_data?.total_volume?.usd || 0,
      last_updated: new Date().toISOString(),
    };

    logger.info({
      price: marketData.price_usd,
      change: marketData.price_change_24h,
      volume: marketData.volume_24h,
    }, 'Fetched SHIBC market data');

    return marketData;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch SHIBC market data');
    return null;
  }
}

/**
 * Fetch general market overview
 */
async function fetchMarketOverview(): Promise<MarketOverview | null> {
  const apiKey = process.env.COINGECKO_API_KEY;

  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['x-cg-demo-api-key'] = apiKey;
    }

    // Fetch global data
    const globalResponse = await fetch(
      'https://api.coingecko.com/api/v3/global',
      { headers }
    );

    if (!globalResponse.ok) {
      return null;
    }

    const globalData = await globalResponse.json() as {
      data: {
        total_market_cap: { usd: number };
        total_volume: { usd: number };
        market_cap_percentage: { btc: number; eth: number };
      };
    };

    // Fetch top gainers/losers
    const marketsResponse = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?' +
      'vs_currency=usd&order=market_cap_desc&per_page=100&sparkline=false&' +
      'price_change_percentage=24h',
      { headers }
    );

    let topGainers: Array<{ symbol: string; change: number }> = [];
    let topLosers: Array<{ symbol: string; change: number }> = [];

    if (marketsResponse.ok) {
      const marketsData = await marketsResponse.json() as Array<{
        symbol: string;
        price_change_percentage_24h: number;
      }>;

      const sorted = [...marketsData].sort(
        (a, b) => (b.price_change_percentage_24h || 0) - (a.price_change_percentage_24h || 0)
      );

      topGainers = sorted.slice(0, 5).map(c => ({
        symbol: c.symbol.toUpperCase(),
        change: c.price_change_percentage_24h || 0,
      }));

      topLosers = sorted.slice(-5).reverse().map(c => ({
        symbol: c.symbol.toUpperCase(),
        change: c.price_change_percentage_24h || 0,
      }));
    }

    const overview: MarketOverview = {
      total_market_cap: globalData.data?.total_market_cap?.usd || 0,
      total_volume_24h: globalData.data?.total_volume?.usd || 0,
      btc_dominance: globalData.data?.market_cap_percentage?.btc || 0,
      eth_dominance: globalData.data?.market_cap_percentage?.eth || 0,
      top_gainers: topGainers,
      top_losers: topLosers,
      last_updated: new Date().toISOString(),
    };

    logger.info({
      totalMarketCap: (overview.total_market_cap / 1e12).toFixed(2) + 'T',
      btcDominance: overview.btc_dominance.toFixed(1) + '%',
    }, 'Fetched market overview');

    return overview;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch market overview');
    return null;
  }
}

// ============================================
// FEAR & GREED INDEX
// ============================================

interface FearGreedData {
  value: number;
  classification: string;
  timestamp: string;
  previous_value?: number;
  previous_classification?: string;
}

/**
 * Fetch Fear & Greed Index from alternative.me
 */
async function fetchFearGreedIndex(): Promise<FearGreedData | null> {
  try {
    const response = await fetch(
      'https://api.alternative.me/fng/?limit=2'
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      data: Array<{
        value: string;
        value_classification: string;
        timestamp: string;
      }>;
    };

    if (!data.data || data.data.length === 0) {
      return null;
    }

    const current = data.data[0];
    const previous = data.data[1];

    const fearGreed: FearGreedData = {
      value: parseInt(current.value, 10),
      classification: current.value_classification,
      timestamp: new Date(parseInt(current.timestamp, 10) * 1000).toISOString(),
      previous_value: previous ? parseInt(previous.value, 10) : undefined,
      previous_classification: previous?.value_classification,
    };

    logger.info({
      value: fearGreed.value,
      classification: fearGreed.classification,
    }, 'Fetched Fear & Greed Index');

    return fearGreed;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch Fear & Greed Index');
    return null;
  }
}

// ============================================
// CACHE MANAGEMENT
// ============================================

/**
 * Cache data in Redis with TTL
 */
async function cacheData(key: string, data: unknown, ttl: number): Promise<void> {
  try {
    await redis.setex(key, ttl, JSON.stringify(data));
    logger.debug({ key, ttl }, 'Cached data');
  } catch (error) {
    logger.error({ error, key }, 'Failed to cache data');
  }
}

/**
 * Get cached data from Redis
 */
export async function getCachedData<T>(key: string): Promise<T | null> {
  try {
    const data = await redis.get(key);
    if (data) {
      return JSON.parse(data) as T;
    }
    return null;
  } catch (error) {
    logger.error({ error, key }, 'Failed to get cached data');
    return null;
  }
}

// ============================================
// MAIN FETCH FUNCTIONS
// ============================================

/**
 * Run all data fetches and cache results
 */
export async function runDataFetch(): Promise<void> {
  logger.info('Starting data fetch cycle...');

  const results = {
    news: false,
    market: false,
    overview: false,
    fearGreed: false,
  };

  // Fetch news (1 hour TTL)
  const news = await fetchCryptoNews();
  if (news.length > 0) {
    await cacheData(CACHE_KEYS.CRYPTO_NEWS, news, CACHE_TTL.NEWS);
    results.news = true;
  }

  // Fetch SHIBC market data (5 min TTL)
  const marketData = await fetchSHIBCMarketData();
  if (marketData) {
    await cacheData(CACHE_KEYS.MARKET_DATA, marketData, CACHE_TTL.MARKET);
    results.market = true;
  }

  // Fetch market overview (5 min TTL)
  const overview = await fetchMarketOverview();
  if (overview) {
    await cacheData(CACHE_KEYS.MARKET_OVERVIEW, overview, CACHE_TTL.MARKET);
    results.overview = true;
  }

  // Fetch Fear & Greed (30 min TTL)
  const fearGreed = await fetchFearGreedIndex();
  if (fearGreed) {
    await cacheData(CACHE_KEYS.FEAR_GREED, fearGreed, CACHE_TTL.FEAR_GREED);
    results.fearGreed = true;
  }

  // Update last fetch timestamp
  await cacheData(CACHE_KEYS.LAST_FETCH, {
    timestamp: new Date().toISOString(),
    results,
  }, 86400);

  logger.info({ results }, 'Data fetch cycle complete');
}

// ============================================
// CONTEXT BUILDER FOR AGENTS
// ============================================

/**
 * Build context string with all cached data for agent prompts
 */
export async function buildDataContext(): Promise<string> {
  const parts: string[] = [];

  // SHIBC Market Data
  const marketData = await getCachedData<MarketData>(CACHE_KEYS.MARKET_DATA);
  if (marketData) {
    parts.push(`## SHIBC Market Data (${marketData.last_updated})`);
    parts.push(`- Price: $${marketData.price_usd.toExponential(2)}`);
    parts.push(`- 24h Change: ${marketData.price_change_24h.toFixed(2)}%`);
    parts.push(`- Market Cap: $${(marketData.market_cap / 1000).toFixed(0)}K`);
    parts.push(`- 24h Volume: $${marketData.volume_24h.toFixed(0)}`);
    parts.push('');
  }

  // Market Overview
  const overview = await getCachedData<MarketOverview>(CACHE_KEYS.MARKET_OVERVIEW);
  if (overview) {
    parts.push(`## Crypto Market Overview`);
    parts.push(`- Total Market Cap: $${(overview.total_market_cap / 1e12).toFixed(2)}T`);
    parts.push(`- 24h Volume: $${(overview.total_volume_24h / 1e9).toFixed(0)}B`);
    parts.push(`- BTC Dominance: ${overview.btc_dominance.toFixed(1)}%`);
    if (overview.top_gainers.length > 0) {
      parts.push(`- Top Gainers: ${overview.top_gainers.map(g => `${g.symbol}(+${g.change.toFixed(0)}%)`).join(', ')}`);
    }
    if (overview.top_losers.length > 0) {
      parts.push(`- Top Losers: ${overview.top_losers.map(l => `${l.symbol}(${l.change.toFixed(0)}%)`).join(', ')}`);
    }
    parts.push('');
  }

  // Fear & Greed Index
  const fearGreed = await getCachedData<FearGreedData>(CACHE_KEYS.FEAR_GREED);
  if (fearGreed) {
    parts.push(`## Fear & Greed Index`);
    parts.push(`- Current: ${fearGreed.value} (${fearGreed.classification})`);
    if (fearGreed.previous_value !== undefined) {
      parts.push(`- Previous: ${fearGreed.previous_value} (${fearGreed.previous_classification})`);
    }
    if (fearGreed.value <= 25) {
      parts.push(`- ⚠️ EXTREME FEAR - Good time for contrarian messaging!`);
    } else if (fearGreed.value >= 75) {
      parts.push(`- ⚠️ EXTREME GREED - Risk of correction`);
    }
    parts.push('');
  }

  // Recent News Headlines
  const news = await getCachedData<NewsArticle[]>(CACHE_KEYS.CRYPTO_NEWS);
  if (news && news.length > 0) {
    parts.push(`## Recent Crypto News (${news.length} articles)`);
    news.slice(0, 10).forEach((article, i) => {
      parts.push(`${i + 1}. ${article.title} (${article.source})`);
    });
    parts.push('');
  }

  if (parts.length === 0) {
    return '## External Data\nNo cached data available. Data fetch may be pending.';
  }

  return parts.join('\n');
}

/**
 * Get specific cached data types
 */
export const dataCache = {
  getNews: () => getCachedData<NewsArticle[]>(CACHE_KEYS.CRYPTO_NEWS),
  getMarketData: () => getCachedData<MarketData>(CACHE_KEYS.MARKET_DATA),
  getMarketOverview: () => getCachedData<MarketOverview>(CACHE_KEYS.MARKET_OVERVIEW),
  getFearGreed: () => getCachedData<FearGreedData>(CACHE_KEYS.FEAR_GREED),
  getLastFetch: () => getCachedData<{ timestamp: string; results: Record<string, boolean> }>(CACHE_KEYS.LAST_FETCH),
};

export { CACHE_KEYS };
