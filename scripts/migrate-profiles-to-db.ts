/**
 * Profile Migration Script
 * Migrates existing .md profile files to the database
 *
 * Usage: npx ts-node scripts/migrate-profiles-to-db.ts
 */

import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import { Pool } from 'pg';
import { config } from '../src/lib/config.js';

interface ProfileData {
  agentType: string;
  content: string;
  identity: Record<string, unknown>;
  mcpServers: Record<string, boolean>;
  capabilities: string[];
  constraints: string[];
  loopActions: string[];
  decisionAuthority: {
    minor: string[];
    major: string[];
    critical: string[];
  };
}

/**
 * Extract MCP servers from profile content
 */
function extractMcpServers(content: string): Record<string, boolean> {
  const servers: Record<string, boolean> = {};

  // Look for MCP server table
  const tableMatch = content.match(/\|\s*Server\s*\|\s*Zugriff\s*\|[\s\S]*?(?=\n\n|\n###|\n---)/i);
  if (tableMatch) {
    const lines = tableMatch[0].split('\n');
    for (const line of lines) {
      const match = line.match(/\|\s*`?(\w+)`?\s*\|\s*(✅|❌|JA|NEIN)/i);
      if (match) {
        const serverName = match[1].toLowerCase();
        const hasAccess = match[2].includes('✅') || match[2].toUpperCase() === 'JA';
        servers[serverName] = hasAccess;
      }
    }
  }

  return servers;
}

/**
 * Extract identity fields from profile
 */
function extractIdentity(content: string): Record<string, unknown> {
  const identity: Record<string, unknown> = {};

  const fields = ['Role', 'Codename', 'Department', 'Reports To', 'Manages'];
  for (const field of fields) {
    const regex = new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`, 'i');
    const match = content.match(regex);
    if (match) {
      identity[field.toLowerCase().replace(' ', '_')] = match[1].trim();
    }
  }

  return identity;
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
 * Extract decision authority from profile
 */
function extractDecisionAuthority(content: string): ProfileData['decisionAuthority'] {
  const section = extractSection(content, 'Decision Authority');

  const minorSection = section.match(/###\s*Kann alleine entscheiden[\s\S]*?(?=###|$)/i)?.[0] || '';
  const majorSection = section.match(/###\s*Braucht (CEO|DAO)[\s\S]*?(?=###|$)/i)?.[0] || '';
  const criticalSection = section.match(/###\s*Braucht DAO \+ Human[\s\S]*?(?=###|$)/i)?.[0] || '';

  return {
    minor: extractBulletPoints(minorSection),
    major: extractBulletPoints(majorSection),
    critical: extractBulletPoints(criticalSection),
  };
}

/**
 * Parse a profile file into structured data
 */
function parseProfile(filename: string, content: string): ProfileData {
  // Extract agent type from filename (e.g., "ceo.md" -> "ceo")
  const agentType = basename(filename, '.md').toLowerCase();

  return {
    agentType,
    content,
    identity: extractIdentity(content),
    mcpServers: extractMcpServers(content),
    capabilities: extractBulletPoints(extractSection(content, 'Core Responsibilities')),
    constraints: extractBulletPoints(extractSection(content, 'Veto Guidelines') ||
                                     extractSection(content, 'Guiding Principles')),
    loopActions: extractBulletPoints(extractSection(content, 'Loop Schedule') ||
                                     extractSection(content, 'Loop Actions')),
    decisionAuthority: extractDecisionAuthority(content),
  };
}

async function migrateProfiles() {
  console.log('Starting profile migration to database...\n');

  const pool = new Pool({
    connectionString: config.POSTGRES_URL,
  });

  try {
    // Get profiles directory
    const profilesDir = join(process.cwd(), 'profiles');
    const files = await readdir(profilesDir);
    const profileFiles = files.filter(f => f.endsWith('.md') && f !== 'base.md' && f !== 'designer.md');

    console.log(`Found ${profileFiles.length} profile files to migrate.\n`);

    // Load base profile for merging
    let baseContent = '';
    try {
      baseContent = await readFile(join(profilesDir, 'base.md'), 'utf-8');
      console.log('Loaded base profile for merging.\n');
    } catch {
      console.log('No base profile found, using individual profiles only.\n');
    }

    // Get all agents from database
    const agentsResult = await pool.query('SELECT id, type FROM agents');
    const agentMap = new Map<string, string>();
    for (const row of agentsResult.rows) {
      agentMap.set(row.type, row.id);
    }

    console.log(`Found ${agentMap.size} agents in database.\n`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const filename of profileFiles) {
      const agentType = basename(filename, '.md').toLowerCase();
      const agentId = agentMap.get(agentType);

      if (!agentId) {
        console.log(`⚠️  Skipping ${filename}: No matching agent in database`);
        skippedCount++;
        continue;
      }

      // Check if profile already exists
      const existingResult = await pool.query(
        'SELECT id FROM agent_profiles WHERE agent_id = $1 AND is_active = true',
        [agentId]
      );

      if (existingResult.rows.length > 0) {
        console.log(`⏩ Skipping ${filename}: Profile already exists in database`);
        skippedCount++;
        continue;
      }

      // Read and parse profile
      const content = await readFile(join(profilesDir, filename), 'utf-8');
      const mergedContent = baseContent
        ? `${baseContent}\n\n---\n\n# Role-Specific Profile\n\n${content}`
        : content;

      const profileData = parseProfile(filename, mergedContent);

      // Insert into database
      await pool.query(
        `INSERT INTO agent_profiles
          (agent_id, content, identity, mcp_servers, capabilities, constraints, loop_actions, decision_authority, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'migration')`,
        [
          agentId,
          mergedContent,
          JSON.stringify(profileData.identity),
          JSON.stringify(profileData.mcpServers),
          JSON.stringify(profileData.capabilities),
          JSON.stringify(profileData.constraints),
          JSON.stringify(profileData.loopActions),
          JSON.stringify(profileData.decisionAuthority),
        ]
      );

      console.log(`✅ Migrated ${filename} -> agent_profiles (agent: ${agentType})`);
      migratedCount++;
    }

    console.log('\n' + '='.repeat(50));
    console.log(`Migration complete!`);
    console.log(`  Migrated: ${migratedCount}`);
    console.log(`  Skipped:  ${skippedCount}`);
    console.log('='.repeat(50));

    // Verify migration
    const countResult = await pool.query('SELECT COUNT(*) as count FROM agent_profiles WHERE is_active = true');
    console.log(`\nTotal active profiles in database: ${countResult.rows[0].count}`);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration
migrateProfiles().catch(console.error);
