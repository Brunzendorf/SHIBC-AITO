/**
 * Agent Profile Loader
 * Loads and parses agent profile markdown files
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { createLogger } from '../lib/logger.js';
import type { AgentType } from '../lib/types.js';

const logger = createLogger('profile');

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
 * Load and parse an agent profile from markdown file
 */
export async function loadProfile(profilePath: string, agentType: AgentType): Promise<AgentProfile> {
  logger.info({ profilePath, agentType }, 'Loading agent profile');

  if (!existsSync(profilePath)) {
    throw new Error('Profile file not found: ' + profilePath);
  }

  const content = await readFile(profilePath, 'utf-8');
  const identity = extractIdentity(content);

  const profile: AgentProfile = {
    type: agentType,
    name: identity.name || agentType.toUpperCase() + ' Agent',
    codename: identity.codename || 'SHIBC-' + agentType.toUpperCase() + '-001',
    department: identity.department || 'Unknown',
    reportsTo: identity.reportsTo || 'CEO Agent',
    manages: identity.manages,
    mission: extractSection(content, 'Mission Statement'),
    responsibilities: extractBulletPoints(extractSection(content, 'Core Responsibilities')),
    decisionAuthority: extractDecisionAuthority(content),
    loopInterval: parseLoopInterval(content),
    loopActions: extractBulletPoints(extractSection(content, 'Loop Schedule')),
    metrics: extractBulletPoints(extractSection(content, 'Key Metrics')),
    communicationStyle: {
      internal: extractSection(content, 'Communication Style').substring(0, 500),
    },
    guidingPrinciples: extractBulletPoints(extractSection(content, 'Guiding Principles')),
    startupPrompt: extractStartupPrompt(content),
    rawContent: content,
  };

  logger.info({ agentType, name: profile.name, loopInterval: profile.loopInterval }, 'Profile loaded');
  return profile;
}

/**
 * Generate system prompt from profile for Claude
 */
export function generateSystemPrompt(profile: AgentProfile): string {
  const parts = [
    '# ' + profile.name,
    '',
    '## Identity',
    'Codename: ' + profile.codename,
    'Department: ' + profile.department,
    'Reports To: ' + profile.reportsTo,
    profile.manages ? 'Manages: ' + profile.manages : '',
    '',
    '## Mission',
    profile.mission,
    '',
    '## Core Responsibilities',
    ...profile.responsibilities.map(r => '- ' + r),
    '',
    '## Guiding Principles',
    ...profile.guidingPrinciples.map(p => '- ' + p),
    '',
    '## Startup',
    profile.startupPrompt,
  ];

  return parts.filter(Boolean).join('\n');
}
