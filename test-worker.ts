/**
 * Test script for MCP Worker system
 * Run with: npx tsx test-worker.ts
 */

import { spawnWorker } from './src/workers/spawner.js';
import { validateServerAccess } from './src/workers/worker.js';
import { MCP_SERVERS_BY_AGENT } from './src/lib/mcp.js';

async function runTests() {
  console.log('\n=== MCP Worker Test ===\n');

  // Test 1: Check server access validation
  console.log('Test 1: Server Access Validation');
  console.log('CMO servers:', MCP_SERVERS_BY_AGENT['cmo']);
  
  const validAccess = validateServerAccess('cmo', ['telegram', 'fetch']);
  console.log('CMO -> [telegram, fetch]:', validAccess);
  
  const invalidAccess = validateServerAccess('cmo', ['etherscan']);
  console.log('CMO -> [etherscan]:', invalidAccess);
  
  // Test 2: Spawn a worker with filesystem (no external creds needed)
  console.log('\nTest 2: Spawn Worker with Filesystem MCP');
  console.log('This will list files in /app/workspace (or fail gracefully)\n');
  
  try {
    const result = await spawnWorker(
      'test-agent-id',
      'ceo', // CEO has filesystem access
      'List the files in the current directory. Return the list as JSON.',
      ['filesystem'],
      { test: true },
      30000 // 30s timeout
    );
    
    console.log('Worker Result:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Worker failed:', error);
  }
  
  console.log('\n=== Tests Complete ===\n');
}

runTests().catch(console.error);
