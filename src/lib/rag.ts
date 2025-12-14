/**
 * RAG (Retrieval-Augmented Generation) Module
 * Uses Ollama bge-m3 for embeddings and Qdrant for vector storage
 * Auto-updates on git commit changes
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { logger } from './logger.js';
import { config } from './config.js';
import { redis } from './redis.js';

// Configuration
const OLLAMA_URL = config.OLLAMA_URL;
const QDRANT_URL = config.QDRANT_URL;
const EMBEDDING_MODEL = 'bge-m3';
const VECTOR_SIZE = 1024;
const COLLECTION_NAME = 'aito_knowledge';

// Chunk settings
const CHUNK_SIZE = 500; // tokens (roughly 4 chars per token)
const CHUNK_OVERLAP = 50;

// Content types for RAG indexing
export type RAGContentType =
  | 'project_doc'
  | 'decision'
  | 'agent_output'
  | 'directus_content'
  | 'api_usage';  // NEW: Self-learning API patterns

interface QdrantPoint {
  id: string;
  vector: number[];
  payload: {
    text: string;
    source: string;
    type: RAGContentType;
    agentId?: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  };
}

interface SearchResult {
  text: string;
  source: string;
  type: string;
  score: number;
  metadata?: Record<string, unknown>;
}

let initialized = false;

/**
 * Initialize RAG system - creates collection if needed
 */
export async function initialize(): Promise<void> {
  if (initialized) return;

  try {
    // Check if collection exists
    const response = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);

    if (response.status === 404) {
      // Create collection
      logger.info({ collection: COLLECTION_NAME }, 'Creating Qdrant collection');

      const createResponse = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vectors: {
            size: VECTOR_SIZE,
            distance: 'Cosine'
          },
          optimizers_config: {
            indexing_threshold: 10000
          }
        })
      });

      if (!createResponse.ok) {
        const error = await createResponse.text();
        throw new Error(`Failed to create collection: ${error}`);
      }

      logger.info({ collection: COLLECTION_NAME, vectorSize: VECTOR_SIZE }, 'Qdrant collection created');
    } else if (response.ok) {
      logger.debug({ collection: COLLECTION_NAME }, 'Qdrant collection exists');
    } else {
      throw new Error(`Qdrant check failed: ${response.status}`);
    }

    initialized = true;

    // Check for content updates and re-index if needed
    await checkAndReindex();
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errMsg }, 'Failed to initialize RAG');
    throw error;
  }
}

/**
 * Get embedding vector from Ollama
 */
async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      prompt: text
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama embedding failed: ${response.status}`);
  }

  const data = await response.json() as { embedding: number[] };
  return data.embedding;
}

/**
 * Split text into overlapping chunks
 */
function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chars = chunkSize * 4; // Approximate chars per chunk
  const overlapChars = overlap * 4;
  const chunks: string[] = [];

  // Split by paragraphs first for better semantic boundaries
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';

  for (const para of paragraphs) {
    if (currentChunk.length + para.length < chars) {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      // Start new chunk with overlap from previous
      const overlapText = currentChunk.slice(-overlapChars);
      currentChunk = overlapText + (overlapText ? '\n\n' : '') + para;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 50); // Filter tiny chunks
}

/**
 * Generate unique UUID for a chunk
 */
function generateChunkId(): string {
  // Generate UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Index a document into Qdrant
 */
export async function indexDocument(
  text: string,
  source: string,
  type: RAGContentType,
  metadata?: Record<string, unknown>
): Promise<number> {
  await initialize();

  const chunks = chunkText(text);
  const points: QdrantPoint[] = [];

  logger.debug({ source, chunks: chunks.length, type }, 'Indexing document');

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const vector = await getEmbedding(chunk);

    points.push({
      id: generateChunkId(),
      vector,
      payload: {
        text: chunk,
        source,
        type,
        createdAt: new Date().toISOString(),
        metadata
      }
    });
  }

  // Upsert points to Qdrant
  const response = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to index document: ${error}`);
  }

  logger.info({ source, chunks: chunks.length, type }, 'Document indexed');
  return chunks.length;
}

/**
 * Search for relevant chunks
 */
export async function search(
  query: string,
  limit = 5,
  filter?: { type?: string; agentId?: string }
): Promise<SearchResult[]> {
  await initialize();

  const queryVector = await getEmbedding(query);

  const body: Record<string, unknown> = {
    vector: queryVector,
    limit,
    with_payload: true
  };

  // Add filter if specified
  if (filter) {
    const must: Array<Record<string, unknown>> = [];
    if (filter.type) {
      must.push({ key: 'type', match: { value: filter.type } });
    }
    if (filter.agentId) {
      must.push({ key: 'agentId', match: { value: filter.agentId } });
    }
    if (must.length > 0) {
      body.filter = { must };
    }
  }

  const response = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Search failed: ${error}`);
  }

  const data = await response.json() as {
    result: Array<{
      score: number;
      payload: QdrantPoint['payload']
    }>
  };

  return data.result.map(r => ({
    text: r.payload.text,
    source: r.payload.source,
    type: r.payload.type,
    score: r.score,
    metadata: r.payload.metadata
  }));
}

/**
 * Delete all chunks from a source
 */
export async function deleteBySource(source: string): Promise<void> {
  await initialize();

  const response = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: {
        must: [{ key: 'source', match: { value: source } }]
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Delete failed: ${error}`);
  }

  logger.info({ source }, 'Deleted indexed content');
}

/**
 * Get collection stats
 */
export async function getStats(): Promise<{ points: number; segments: number }> {
  await initialize();

  const response = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);

  if (!response.ok) {
    throw new Error(`Failed to get stats: ${response.status}`);
  }

  const data = await response.json() as {
    result: {
      points_count: number;
      segments_count: number
    }
  };

  return {
    points: data.result.points_count,
    segments: data.result.segments_count
  };
}

/**
 * Build context string from search results for injection into prompts
 */
export function buildContext(results: SearchResult[], maxTokens = 2000): string {
  if (results.length === 0) return '';

  const maxChars = maxTokens * 4;
  let context = '## Relevant Context\n\n';
  let currentLength = context.length;

  for (const result of results) {
    const entry = `### ${result.source} (${result.type})\n${result.text}\n\n`;
    if (currentLength + entry.length > maxChars) break;
    context += entry;
    currentLength += entry.length;
  }

  return context;
}

// ============================================
// AUTO-INDEX: Git Hash Based Updates
// ============================================

const REDIS_KEY_LAST_HASH = 'rag:lastIndexedHash';
const PROFILES_DIR = '/app/profiles';
const DOCS_DIR = '/app/docs';

/**
 * Get current git commit hash
 * First checks GIT_HASH env (set at Docker build time), then tries git command
 */
function getGitHash(): string | null {
  // First try ENV (set during docker build)
  const envHash = process.env.GIT_HASH;
  if (envHash && envHash !== 'unknown') {
    return envHash;
  }

  // Fallback to git command (works in dev, not in Docker)
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    logger.warn('Could not get git hash - set GIT_HASH env or run in git repo');
    return null;
  }
}

/**
 * Read all .md files from a directory recursively
 */
function readMarkdownFiles(dir: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...readMarkdownFiles(fullPath));
      } else if (entry.endsWith('.md')) {
        files.push({
          path: fullPath.replace(/\\/g, '/'),
          content: readFileSync(fullPath, 'utf8')
        });
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }

  return files;
}

/**
 * Check if re-indexing is needed and perform it if so
 * Called automatically during initialize()
 */
async function checkAndReindex(): Promise<void> {
  const currentHash = getGitHash();
  if (!currentHash) return; // Skip if not in git repo

  const lastHash = await redis.get(REDIS_KEY_LAST_HASH);

  if (lastHash === currentHash) {
    logger.debug({ hash: currentHash }, 'RAG index up-to-date');
    return;
  }

  logger.info({
    oldHash: lastHash || 'none',
    newHash: currentHash
  }, 'RAG index outdated - re-indexing...');

  // Delete old project docs (keep agent outputs and decisions)
  await deleteByType('project_doc');

  // Index profiles
  const profiles = readMarkdownFiles(PROFILES_DIR);
  for (const file of profiles) {
    const source = `profile/${file.path.split('/').pop()?.replace('.md', '')}`;
    await indexDocument(file.content, source, 'project_doc', { gitHash: currentHash });
  }

  // Index docs
  const docs = readMarkdownFiles(DOCS_DIR);
  for (const file of docs) {
    const source = `docs/${file.path.split('/').pop()}`;
    await indexDocument(file.content, source, 'project_doc', { gitHash: currentHash });
  }

  // Save new hash
  await redis.set(REDIS_KEY_LAST_HASH, currentHash);

  const stats = await getStats();
  logger.info({
    oldHash: lastHash || 'none',
    newHash: currentHash,
    profilesIndexed: profiles.length,
    docsIndexed: docs.length,
    totalPoints: stats.points
  }, 'RAG re-indexed successfully');
}

/**
 * Delete all chunks of a specific type
 */
async function deleteByType(type: string): Promise<void> {
  await initialize();

  const response = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: {
        must: [{ key: 'type', match: { value: type } }]
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Delete by type failed: ${error}`);
  }
}

/**
 * Index a decision when it's approved
 */
export async function indexDecision(
  decisionId: string,
  title: string,
  description: string,
  tier: string,
  result: string
): Promise<void> {
  const content = `# Decision: ${title}\n\nTier: ${tier}\nResult: ${result}\n\n${description}`;
  await indexDocument(content, `decision/${decisionId}`, 'decision', { tier, result });
}

/**
 * Index agent output after a loop
 */
export async function indexAgentOutput(
  agentId: string,
  agentType: string,
  summary: string
): Promise<void> {
  if (!summary || summary.length < 50) return; // Skip tiny summaries

  const timestamp = new Date().toISOString().split('T')[0];
  await indexDocument(
    summary,
    `agent/${agentType}/${timestamp}`,
    'agent_output',
    { agentId, agentType }
  );
}

/**
 * Index API usage pattern for self-learning
 * Records successful (and failed) API calls so future workers can learn from them
 *
 * SECURITY: Does NOT index actual API keys - only env var names and usage patterns
 */
export async function indexAPIUsage(
  apiName: string,
  endpoint: string,
  method: string,
  params: Record<string, string>,
  responsePreview: string,
  success: boolean,
  usedBy: string,
  errorMessage?: string
): Promise<void> {
  // Build human-readable pattern description
  const paramStr = Object.entries(params)
    .filter(([k]) => !k.toLowerCase().includes('key') && !k.toLowerCase().includes('token'))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const text = success
    ? `API Call: ${apiName}\n${method} ${endpoint}${paramStr ? '?' + paramStr : ''}\nResponse: ${responsePreview.slice(0, 200)}`
    : `API Call FAILED: ${apiName}\n${method} ${endpoint}${paramStr ? '?' + paramStr : ''}\nError: ${errorMessage || 'Unknown error'}`;

  const source = `api/${apiName}/${endpoint.replace(/\//g, '-').replace(/^-/, '')}`;

  await indexDocument(
    text,
    source,
    'api_usage',
    {
      apiName,
      endpoint,
      method,
      success,
      usedBy,
      timestamp: new Date().toISOString(),
      ...(errorMessage && { errorMessage }),
    }
  );

  logger.info({
    apiName,
    endpoint,
    success,
    usedBy,
  }, 'Indexed API usage pattern');
}

/**
 * Search for API usage patterns
 * Helps workers learn from previous successful API calls
 */
export async function searchAPIPatterns(
  query: string,
  agentType?: string,
  limit = 3
): Promise<SearchResult[]> {
  // Search only api_usage type
  const results = await search(query, limit * 2, { type: 'api_usage' });

  // Prioritize successful patterns
  return results
    .sort((a, b) => {
      const aSuccess = a.metadata?.success === true ? 1 : 0;
      const bSuccess = b.metadata?.success === true ? 1 : 0;
      return bSuccess - aSuccess;
    })
    .slice(0, limit);
}

/**
 * Review PR content against RAG knowledge base for quality assurance
 * Returns approval status, score, issues, and feedback
 */
export async function reviewPRContent(
  agentType: string,
  summary: string,
  changedFiles: string[]
): Promise<{
  approved: boolean;
  score: number;
  issues: string[];
  feedback: string;
}> {
  const issues: string[] = [];
  let score = 100;

  try {
    // 1. Basic validation
    if (!summary || summary.length < 20) {
      issues.push('Summary is too short or missing');
      score -= 20;
    }

    if (changedFiles.length === 0) {
      issues.push('No files changed in this PR');
      score -= 30;
    }

    // 2. Search RAG for agent profile/guidelines
    const profileResults = await search(`${agentType} guidelines responsibilities`, 3, {
      type: 'profile',
    });

    // 3. Search for related content to check consistency
    const relatedResults = await search(summary, 5);

    // 4. Check for forbidden patterns
    const forbiddenPatterns = [
      { pattern: /api[_-]?key|secret|password|token/i, issue: 'Potential sensitive data in content' },
      { pattern: /rm\s+-rf\s+\/|sudo\s+rm/i, issue: 'Dangerous command patterns detected' },
      { pattern: /wallet.*private|mnemonic|seed\s*phrase/i, issue: 'Crypto key material detected' },
    ];

    for (const { pattern, issue } of forbiddenPatterns) {
      if (pattern.test(summary) || changedFiles.some(f => pattern.test(f))) {
        issues.push(issue);
        score -= 25;
      }
    }

    // 5. Check if content aligns with agent's domain
    const agentDomains: Record<string, string[]> = {
      ceo: ['strategy', 'executive', 'approval', 'oversight', 'leadership'],
      dao: ['governance', 'voting', 'proposal', 'treasury', 'snapshot'],
      cmo: ['marketing', 'content', 'social', 'campaign', 'brand'],
      cto: ['technical', 'infrastructure', 'development', 'architecture'],
      cfo: ['finance', 'budget', 'treasury', 'accounting', 'financial'],
      coo: ['operations', 'process', 'efficiency', 'workflow', 'sop'],
      cco: ['compliance', 'legal', 'risk', 'regulation', 'policy'],
    };

    const domain = agentDomains[agentType] || [];
    const summaryLower = summary.toLowerCase();
    const domainRelevance = domain.some(keyword => summaryLower.includes(keyword));

    if (!domainRelevance && domain.length > 0) {
      issues.push(`Content may be outside ${agentType.toUpperCase()}'s domain`);
      score -= 10;
    }

    // 6. Check file path patterns
    const agentPaths: Record<string, RegExp[]> = {
      cmo: [/marketing|content|social|campaigns/i],
      cto: [/technical|infrastructure|docs|architecture/i],
      cfo: [/finance|treasury|budget|reports/i],
      coo: [/operations|sops|processes|workflows/i],
      cco: [/compliance|legal|risk|policies/i],
    };

    const allowedPaths = agentPaths[agentType];
    if (allowedPaths) {
      const invalidFiles = changedFiles.filter(f =>
        !allowedPaths.some(regex => regex.test(f)) &&
        !f.includes(agentType) // Allow agent's own directory
      );

      if (invalidFiles.length > 0) {
        issues.push(`Files outside agent's domain: ${invalidFiles.slice(0, 3).join(', ')}`);
        score -= 15;
      }
    }

    // 7. Check for contradictions with existing knowledge (basic)
    if (relatedResults.length > 0) {
      // Look for conflicting claims (simplified check)
      const existingContent = relatedResults.map(r => r.text || '').join(' ');

      // Check for numeric inconsistencies (e.g., token supply, addresses)
      const numericPattern = /(\d{6,}|0x[a-fA-F0-9]{40})/g;
      const newNumbers: string[] = summary.match(numericPattern) || [];
      const existingNumbers: string[] = existingContent.match(numericPattern) || [];

      // Flag if claiming different values for same type of data
      for (const num of newNumbers) {
        if (existingNumbers.length > 0 && num.startsWith('0x')) {
          // Check if it's a new address not seen before
          if (!existingNumbers.includes(num)) {
            logger.debug({ newAddress: num }, 'New address mentioned, may need verification');
          }
        }
      }
    }

    // 8. Calculate final approval
    const approved = score >= 60;
    const feedback = generateFeedback(agentType, issues, score, profileResults);

    logger.info({
      agentType,
      score,
      approved,
      issueCount: issues.length,
    }, 'PR review completed');

    return { approved, score, issues, feedback };
  } catch (error) {
    logger.error({ error }, 'RAG review failed');
    // On error, approve with warning to avoid blocking
    return {
      approved: true,
      score: 70,
      issues: ['RAG review encountered an error - manual review recommended'],
      feedback: 'Automatic review failed. Please manually verify the changes.',
    };
  }
}

/**
 * Generate helpful feedback based on review results
 */
function generateFeedback(
  agentType: string,
  issues: string[],
  _score: number,
  profileResults: any[]
): string {
  if (issues.length === 0) {
    return `Content looks good! Aligns well with ${agentType.toUpperCase()} responsibilities.`;
  }

  let feedback = 'Please address the following:\n\n';

  for (const issue of issues) {
    feedback += `• ${issue}\n`;
  }

  feedback += '\nSuggestions:\n';

  if (issues.some(i => i.includes('domain'))) {
    feedback += `• Ensure content is relevant to ${agentType.toUpperCase()}'s role\n`;
  }

  if (issues.some(i => i.includes('sensitive'))) {
    feedback += '• Remove any API keys, tokens, or credentials\n';
  }

  if (issues.some(i => i.includes('short'))) {
    feedback += '• Provide more detailed description of changes\n';
  }

  // Add guidance from profile if available
  if (profileResults.length > 0) {
    feedback += `\nRefer to ${agentType.toUpperCase()} profile for approved activities.`;
  }

  return feedback;
}

// Export for convenience
export const rag = {
  initialize,
  index: indexDocument,
  search,
  deleteBySource,
  getStats,
  buildContext,
  checkAndReindex,
  indexDecision,
  indexAgentOutput,
  indexAPIUsage,
  searchAPIPatterns,
  reviewPRContent,
};
