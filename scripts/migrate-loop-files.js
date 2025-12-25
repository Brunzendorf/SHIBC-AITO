#!/usr/bin/env node
/**
 * Migrate Loop Files to Status Database
 *
 * Reads all loop/status files from workspace and inserts them
 * into the agent_status table for historical preservation.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/app/workspace';
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgresql://aito:aito@localhost:5432/aito';

const pool = new Pool({ connectionString: DATABASE_URL });

// Agent folder to type mapping
const AGENT_FOLDERS = {
  'SHIBC-CEO-001': 'ceo',
  'SHIBC-CMO-001': 'cmo',
  'SHIBC-CTO-001': 'cto',
  'SHIBC-CFO-001': 'cfo',
  'SHIBC-COO-001': 'coo',
  'SHIBC-CCO-001': 'cco',
  'SHIBC-DAO-001': 'dao',
};

// Extract loop number from filename or content
function extractLoopNumber(filename, content) {
  // Try filename first: loop_123.md, ceo-loop-415-*.md, loop123-*.md
  const fileMatch = filename.match(/loop[_-]?(\d+)/i);
  if (fileMatch) return parseInt(fileMatch[1], 10);

  // Try content: "Loop 415", "# CMO Loop 106"
  const contentMatch = content.match(/Loop\s+(\d+)/i);
  if (contentMatch) return parseInt(contentMatch[1], 10);

  return 0;
}

// Extract activity summary from content (first few lines)
function extractActivity(content) {
  const lines = content.split('\n').slice(0, 10);

  // Look for "Executive Summary", "Loop Focus", or first heading
  for (const line of lines) {
    if (line.includes('Loop Focus:')) {
      return line.replace(/.*Loop Focus:\s*/i, '').trim().slice(0, 200);
    }
    if (line.includes('Summary')) {
      continue; // Skip "Executive Summary" heading, get content after
    }
  }

  // Fallback: first non-empty, non-heading line
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.length > 10) {
      return trimmed.slice(0, 200);
    }
  }

  return 'Historical loop data (migrated)';
}

// Find all loop/status files recursively
function findLoopFiles(dir) {
  const files = [];

  function walk(currentDir) {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // Skip archive folders
          if (entry.name.startsWith('_') || entry.name === '.git') continue;
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          // Check if it's a loop/status file
          if (entry.name.includes('loop') || entry.name.includes('status')) {
            files.push(fullPath);
          }
        }
      }
    } catch (err) {
      console.error(`Error reading ${currentDir}:`, err.message);
    }
  }

  walk(dir);
  return files;
}

// Determine agent type from file path
function getAgentType(filePath) {
  for (const [folder, agentType] of Object.entries(AGENT_FOLDERS)) {
    if (filePath.includes(folder)) {
      return agentType;
    }
  }
  return null;
}

async function migrateFiles() {
  console.log('Starting loop file migration...');
  console.log(`Workspace: ${WORKSPACE_DIR}`);
  console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);

  const files = findLoopFiles(WORKSPACE_DIR);
  console.log(`Found ${files.length} loop/status files`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const filePath of files) {
      try {
        const agentType = getAgentType(filePath);
        if (!agentType) {
          skipped++;
          continue;
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);
        const loopNumber = extractLoopNumber(path.basename(filePath), content);
        const activity = extractActivity(content);

        // Check if already migrated (by loop number and agent)
        const existing = await client.query(
          `SELECT id FROM agent_status
           WHERE agent_type = $1 AND loop_number = $2 AND activity LIKE '%migrated%'
           LIMIT 1`,
          [agentType, loopNumber]
        );

        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }

        // Insert into agent_status
        await client.query(
          `INSERT INTO agent_status (agent_type, loop_number, status_type, activity, details, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            agentType,
            loopNumber,
            'completed',
            activity,
            JSON.stringify({ migrated: true, source: path.basename(filePath) }),
            stats.mtime
          ]
        );

        migrated++;

        if (migrated % 50 === 0) {
          console.log(`  Migrated ${migrated} files...`);
        }
      } catch (fileErr) {
        console.error(`Error processing ${filePath}:`, fileErr.message);
        errors++;
      }
    }

    await client.query('COMMIT');

    console.log('\n--- Migration Complete ---');
    console.log(`Migrated: ${migrated}`);
    console.log(`Skipped:  ${skipped}`);
    console.log(`Errors:   ${errors}`);

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
}

migrateFiles().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
