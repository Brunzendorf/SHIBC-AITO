/**
 * Agent Profile Loader
 * Loads and parses agent profile markdown files
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { createLogger } from '../lib/logger.js';
import type { AgentType } from '../lib/types.js';

const logger = createLogger('profile');

// Cache for base profile to avoid re-reading
let cachedBaseProfile: string | null = null;

export interface AgentProfile {
  type: AgentType;
  name: string;
  codename: string;
  department: string;
  reportsTo: string;
  manages?: string;
  mission: string;
  responsibilities: string[];
  decisionAuthority: {
    solo: string[];
    ceoApproval: string[];
    daoVote: string[];
  };
  loopInterval: number;
  loopActions: string[];
  metrics: string[];
  communicationStyle: {
    internal?: string;
    external?: string;
    crisis?: string;
  };
  guidingPrinciples: string[];
  startupPrompt: string;
  rawContent: string;
}

/**
 * Parse loop interval from profile content
 * Looks for patterns like "3600 Sekunden" or "Alle 4 Stunden"
 */
function parseLoopInterval(content: string): number {
  // Look for explicit seconds
  const secondsMatch = content.match(/(\d+)\s*Sekunden/i);
  if (secondsMatch) {
    return parseInt(secondsMatch[1], 10);
  }

  // Look for hours pattern
  const hoursMatch = content.match(/Alle\s*(\d+)\s*Stunden?/i);
  if (hoursMatch) {
    return parseInt(hoursMatch[1], 10) * 3600;
  }

  // Look for "Jede Stunde"
  if (/Jede\s*Stunde/i.test(content)) {
    return 3600;
  }

  // Default: 1 hour
  return 3600;
}

/**
 * Extract section content from markdown
 */
function extractSection(content: string, heading: string): string {
  const regex = new RegExp(
    '##\\s*' + heading + '\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)',
    'i'
  );
  const match = content.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Extract bullet points from a section
 */
function extractBulletPoints(section: string): string[] {
  const lines = section.split('\n');
  const points: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      points.push(trimmed.substring(2).trim());
    } else if (/^\d+\.\s/.test(trimmed)) {
      points.push(trimmed.replace(/^\d+\.\s*/, '').trim());
    }
  }

  return points;
}

/**
 * Extract identity fields from profile
 */
function extractIdentity(content: string): Partial<AgentProfile> {
  const identitySection = extractSection(content, 'Identity');

  const getField = (name: string): string => {
    const regex = new RegExp('\\*\\*' + name + ':\\*\\*\\s*(.+)', 'i');
    const match = identitySection.match(regex);
    return match ? match[1].trim() : '';
  };

  return {
    name: getField('Role'),
    codename: getField('Codename'),
    department: getField('Department'),
    reportsTo: getField('Reports To'),
    manages: getField('Manages') || undefined,
  };
}

/**
 * Extract decision authority from profile
 */
function extractDecisionAuthority(content: string): AgentProfile['decisionAuthority'] {
  const section = extractSection(content, 'Decision Authority');

  const soloSection = section.match(/###\s*Kann alleine entscheiden[\s\S]*?(?=###|$)/i)?.[0] || '';
  const ceoSection = section.match(/###\s*Braucht CEO[\s\S]*?(?=###|$)/i)?.[0] || '';
  const daoSection = section.match(/###\s*Braucht DAO[\s\S]*?(?=###|$)/i)?.[0] || '';

  return {
    solo: extractBulletPoints(soloSection),
    ceoApproval: extractBulletPoints(ceoSection),
    daoVote: extractBulletPoints(daoSection),
  };
}

/**
 * Extract startup prompt from profile
 */
function extractStartupPrompt(content: string): string {
  const section = extractSection(content, 'Startup Prompt');
  const codeBlock = section.match(/```[\s\S]*?\n([\s\S]*?)```/);
  return codeBlock ? codeBlock[1].trim() : section;
}

/**
 * Load base profile from profiles/base.md
 * Returns empty string if not found (backwards compatible)
 */
async function loadBaseProfile(profileDir: string): Promise<string> {
  if (cachedBaseProfile !== null) {
    return cachedBaseProfile;
  }

  const basePath = join(profileDir, 'base.md');

  if (!existsSync(basePath)) {
    logger.debug({ basePath }, 'No base profile found, using individual profile only');
    cachedBaseProfile = '';
    return '';
  }

  try {
    cachedBaseProfile = await readFile(basePath, 'utf-8');
    logger.info({ basePath }, 'Base profile loaded');
    return cachedBaseProfile;
  } catch (error) {
    logger.warn({ error, basePath }, 'Failed to load base profile');
    cachedBaseProfile = '';
    return '';
  }
}

/**
 * Load and parse an agent profile from markdown file
 * Automatically merges with base.md if present
 */
export async function loadProfile(profilePath: string, agentType: AgentType): Promise<AgentProfile> {
  logger.info({ profilePath, agentType }, 'Loading agent profile');

  if (!existsSync(profilePath)) {
    throw new Error('Profile file not found: ' + profilePath);
  }

  // Load base profile first
  const profileDir = dirname(profilePath);
  const baseContent = await loadBaseProfile(profileDir);

  // Load individual profile
  const individualContent = await readFile(profilePath, 'utf-8');

  // Merge: base first, then individual (individual can override)
  // The individual profile should focus on role-specific content
  const mergedContent = baseContent
    ? `${baseContent}\n\n---\n\n# Role-Specific Profile\n\n${individualContent}`
    : individualContent;

  const identity = extractIdentity(individualContent); // Identity comes from individual

  const profile: AgentProfile = {
    type: agentType,
    name: identity.name || agentType.toUpperCase() + ' Agent',
    codename: identity.codename || 'SHIBC-' + agentType.toUpperCase() + '-001',
    department: identity.department || 'Unknown',
    reportsTo: identity.reportsTo || 'CEO Agent',
    manages: identity.manages,
    mission: extractSection(individualContent, 'Mission Statement'),
    responsibilities: extractBulletPoints(extractSection(individualContent, 'Core Responsibilities')),
    decisionAuthority: extractDecisionAuthority(individualContent),
    loopInterval: parseLoopInterval(individualContent),
    loopActions: extractBulletPoints(extractSection(individualContent, 'Loop Schedule')),
    metrics: extractBulletPoints(extractSection(individualContent, 'Key Metrics')),
    communicationStyle: {
      internal: extractSection(individualContent, 'Communication Style').substring(0, 500),
    },
    guidingPrinciples: extractBulletPoints(extractSection(mergedContent, 'Guiding Principles')),
    startupPrompt: extractStartupPrompt(individualContent),
    rawContent: mergedContent, // Claude gets the merged content!
  };

  logger.info({
    agentType,
    name: profile.name,
    loopInterval: profile.loopInterval,
    hasBaseProfile: !!baseContent
  }, 'Profile loaded');

  return profile;
}


/**
 * Extract MCP Workers section from raw profile content (test)
 */
function extractMCPWorkersSection(content: string): string {
  const match = content.match(/## MCP Workers[\s\S]*?(?=\n## [^M]|\n---\s*$|$)/i);
  return match ? match[0].trim() : '';
}

/**
 * Extract DATA FIRST section from profile - CRITICAL for preventing hallucinations
 */
function extractDataFirstSection(content: string): string {
  // Handle both Windows (\r\n) and Unix (\n) line endings
  const match = content.match(/## 🚨 DATA FIRST[\s\S]*?(?=\r?\n## |---\s*$|$)/i);
  return match ? match[0].trim() : '';
}

/**
 * Extract HOUSEKEEPING section from profile - CRITICAL for fresh state each loop
 */
function extractHousekeepingSection(content: string): string {
  // Handle both Windows (\r\n) and Unix (\n) line endings
  const match = content.match(/## 🧹 HOUSEKEEPING[\s\S]*?(?=\r?\n## |---\s*$|$)/i);
  return match ? match[0].trim() : '';
}

/**
 * Generate system prompt from profile for Claude
 *
 * SIMPLIFIED: Just use the raw profile content directly!
 * This ensures nothing is lost (DATA FIRST, HOUSEKEEPING, etc.)
 */
export function generateSystemPrompt(profile: AgentProfile): string {
  // Use the complete raw profile - no selective extraction that might lose critical sections
  // The profile markdown is already well-structured for Claude to understand
  return profile.rawContent;
}
