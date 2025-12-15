/**
 * Archive Worker - Intelligent RAG Knowledge Curator
 *
 * Evaluates agent outputs and decides:
 * - DISCARD: Routine noise, not worth storing
 * - INDEX: New valuable knowledge to add
 * - UPDATE: Corrects/updates existing knowledge
 * - INVALIDATE: Removes outdated/wrong information
 * - CONSOLIDATE: Merges similar entries
 */

import { createLogger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { executeOllamaFallback } from '../agents/claude.js';
import {
  indexDocument,
  search,
  deleteBySource,
  getStats,
  type RAGContentType,
} from '../lib/rag.js';

const logger = createLogger('archive-worker');

// Redis queue for pending archive items
const ARCHIVE_QUEUE = 'queue:archive';
const ARCHIVE_PROCESSED = 'archive:processed:count';
const ARCHIVE_LAST_RUN = 'archive:last_run';

// How many items to process per batch
const BATCH_SIZE = 10;

export interface ArchiveItem {
  id: string;
  agentType: string;
  agentId: string;
  summary: string;
  timestamp: string;
  loopCount?: number;
  actions?: string[];
}

export type ArchiveAction = 'DISCARD' | 'INDEX' | 'UPDATE' | 'INVALIDATE' | 'CONSOLIDATE';

export interface ArchiveDecision {
  action: ArchiveAction;
  reason: string;
  category?: string;
  tags?: string[];
  relatedSource?: string; // For UPDATE/INVALIDATE - which existing entry to modify
  consolidatedSummary?: string; // For CONSOLIDATE - merged summary
}

/**
 * Add an item to the archive queue
 */
export async function queueForArchive(item: ArchiveItem): Promise<void> {
  await redis.rpush(ARCHIVE_QUEUE, JSON.stringify(item));
  logger.debug({ agentType: item.agentType, id: item.id }, 'Queued for archive');
}

/**
 * Get queue length
 */
export async function getQueueLength(): Promise<number> {
  return await redis.llen(ARCHIVE_QUEUE);
}

/**
 * Process pending archive items
 */
export async function processArchiveQueue(): Promise<{
  processed: number;
  indexed: number;
  discarded: number;
  updated: number;
  errors: number;
}> {
  const stats = { processed: 0, indexed: 0, discarded: 0, updated: 0, errors: 0 };

  const queueLength = await getQueueLength();
  if (queueLength === 0) {
    logger.debug('Archive queue empty');
    return stats;
  }

  logger.info({ queueLength }, 'Processing archive queue');

  // Get batch of items
  const items: ArchiveItem[] = [];
  for (let i = 0; i < Math.min(BATCH_SIZE, queueLength); i++) {
    const raw = await redis.lpop(ARCHIVE_QUEUE);
    if (raw) {
      try {
        items.push(JSON.parse(raw));
      } catch {
        logger.warn({ raw }, 'Failed to parse archive item');
      }
    }
  }

  if (items.length === 0) return stats;

  // Process each item
  for (const item of items) {
    try {
      const decision = await evaluateForArchive(item);
      await executeArchiveDecision(item, decision);

      stats.processed++;
      switch (decision.action) {
        case 'INDEX':
          stats.indexed++;
          break;
        case 'DISCARD':
          stats.discarded++;
          break;
        case 'UPDATE':
        case 'INVALIDATE':
        case 'CONSOLIDATE':
          stats.updated++;
          break;
      }
    } catch (error) {
      logger.error({ error, item }, 'Failed to process archive item');
      stats.errors++;
    }
  }

  // Update stats
  const totalProcessed = parseInt(await redis.get(ARCHIVE_PROCESSED) || '0', 10);
  await redis.set(ARCHIVE_PROCESSED, String(totalProcessed + stats.processed));
  await redis.set(ARCHIVE_LAST_RUN, new Date().toISOString());

  logger.info(stats, 'Archive batch completed');
  return stats;
}

/**
 * Use Claude to evaluate if/how to archive an item
 */
async function evaluateForArchive(item: ArchiveItem): Promise<ArchiveDecision> {
  // First, search for related existing knowledge
  const existingKnowledge = await search(item.summary, 3);

  const existingContext = existingKnowledge.length > 0
    ? `\n\nExisting related knowledge in RAG:\n${existingKnowledge.map((k, i) =>
        `${i + 1}. [${k.source}] ${k.text.slice(0, 200)}...`
      ).join('\n')}`
    : '\n\nNo related existing knowledge found.';

  const prompt = `You are the Archive Worker for SHIBC-AITO. Your job is to curate the knowledge base.

Evaluate this agent output and decide what to do:

**Agent:** ${item.agentType.toUpperCase()}
**Timestamp:** ${item.timestamp}
**Loop:** ${item.loopCount || 'unknown'}
**Summary:**
${item.summary}
${existingContext}

Decide ONE action:

1. **DISCARD** - Routine/noise, not worth storing
   - "Loop completed, all systems normal"
   - Repetitive status updates
   - No new information

2. **INDEX** - New valuable knowledge to store
   - Discoveries, decisions, important events
   - New information not in existing knowledge
   - Learnings that help future operations

3. **UPDATE** - Existing knowledge is outdated, replace it
   - New info contradicts/supersedes old entry
   - Specify which source to update

4. **INVALIDATE** - Remove wrong/obsolete knowledge
   - Information proven false
   - Volatile data that's now stale (old prices, etc.)

5. **CONSOLIDATE** - Merge with similar existing entries
   - Multiple entries about same topic
   - Create one comprehensive entry

Respond in JSON only:
{
  "action": "DISCARD|INDEX|UPDATE|INVALIDATE|CONSOLIDATE",
  "reason": "Brief explanation",
  "category": "decision|discovery|alert|learning|status",
  "tags": ["relevant", "tags"],
  "relatedSource": "source/to/update (if UPDATE/INVALIDATE)",
  "consolidatedSummary": "merged summary (if CONSOLIDATE)"
}`;

  try {
    // Use Ollama for archive evaluation (orchestrator doesn't have Claude CLI)
    const fullPrompt = `You are a knowledge curator. Respond only with valid JSON. Be selective - only INDEX truly valuable information.

${prompt}`;

    const result = await executeOllamaFallback(fullPrompt, 'llama3.2:3b');

    if (!result.success || !result.output) {
      logger.warn({ error: result.error }, 'Archive evaluation failed, defaulting to DISCARD');
      return { action: 'DISCARD', reason: 'Evaluation failed' };
    }

    // Parse JSON from response
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn({ output: result.output }, 'No JSON in archive response');
      return { action: 'DISCARD', reason: 'Failed to parse response' };
    }

    const decision = JSON.parse(jsonMatch[0]) as ArchiveDecision;

    // Validate action
    if (!['DISCARD', 'INDEX', 'UPDATE', 'INVALIDATE', 'CONSOLIDATE'].includes(decision.action)) {
      decision.action = 'DISCARD';
      decision.reason = 'Invalid action, defaulting to DISCARD';
    }

    logger.info({
      agentType: item.agentType,
      action: decision.action,
      reason: decision.reason,
    }, 'Archive decision made');

    return decision;
  } catch (error) {
    logger.error({ error }, 'Archive evaluation error');
    return { action: 'DISCARD', reason: 'Error during evaluation' };
  }
}

/**
 * Execute the archive decision
 */
async function executeArchiveDecision(item: ArchiveItem, decision: ArchiveDecision): Promise<void> {
  const source = `agent/${item.agentType}/${item.timestamp.split('T')[0]}/${item.id.slice(0, 8)}`;

  switch (decision.action) {
    case 'DISCARD':
      logger.debug({ source, reason: decision.reason }, 'Discarded');
      break;

    case 'INDEX':
      await indexDocument(
        item.summary,
        source,
        'agent_output' as RAGContentType,
        {
          agentType: item.agentType,
          agentId: item.agentId,
          category: decision.category,
          tags: decision.tags,
          timestamp: item.timestamp,
        }
      );
      logger.info({ source, category: decision.category }, 'Indexed new knowledge');
      break;

    case 'UPDATE':
      if (decision.relatedSource) {
        // Delete old entry
        await deleteBySource(decision.relatedSource);
        logger.debug({ oldSource: decision.relatedSource }, 'Deleted outdated entry');
      }
      // Index new entry
      await indexDocument(
        item.summary,
        source,
        'agent_output' as RAGContentType,
        {
          agentType: item.agentType,
          agentId: item.agentId,
          category: decision.category,
          tags: decision.tags,
          timestamp: item.timestamp,
          updatedFrom: decision.relatedSource,
        }
      );
      logger.info({ source, updatedFrom: decision.relatedSource }, 'Updated knowledge');
      break;

    case 'INVALIDATE':
      if (decision.relatedSource) {
        await deleteBySource(decision.relatedSource);
        logger.info({ source: decision.relatedSource, reason: decision.reason }, 'Invalidated knowledge');
      }
      break;

    case 'CONSOLIDATE':
      if (decision.consolidatedSummary && decision.relatedSource) {
        // Delete old entries
        await deleteBySource(decision.relatedSource);
        // Index consolidated entry
        await indexDocument(
          decision.consolidatedSummary,
          source,
          'agent_output' as RAGContentType,
          {
            agentType: item.agentType,
            category: decision.category,
            tags: decision.tags,
            timestamp: item.timestamp,
            consolidated: true,
          }
        );
        logger.info({ source }, 'Consolidated knowledge');
      }
      break;
  }
}

/**
 * Get archive stats
 */
export async function getArchiveStats(): Promise<{
  queueLength: number;
  totalProcessed: number;
  lastRun: string | null;
  ragStats: { points: number; segments: number };
}> {
  const [queueLength, totalProcessed, lastRun, ragStats] = await Promise.all([
    getQueueLength(),
    redis.get(ARCHIVE_PROCESSED),
    redis.get(ARCHIVE_LAST_RUN),
    getStats(),
  ]);

  return {
    queueLength,
    totalProcessed: parseInt(totalProcessed || '0', 10),
    lastRun,
    ragStats,
  };
}

/**
 * Run archive worker as a scheduled task
 * Can be called from orchestrator scheduler
 */
export async function runArchiveWorker(): Promise<void> {
  const startTime = Date.now();

  try {
    const stats = await processArchiveQueue();

    logger.info({
      duration: Date.now() - startTime,
      ...stats,
    }, 'Archive worker run completed');
  } catch (error) {
    logger.error({ error }, 'Archive worker run failed');
  }
}
