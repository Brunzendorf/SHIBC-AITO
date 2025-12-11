/**
 * RAG Test Script
 * Run: npx ts-node scripts/test-rag.ts
 */

import { rag } from '../src/lib/rag.js';

async function main() {
  console.log('Testing RAG system...\n');

  // Test document
  const testDoc = `
# Shiba Classic Project Overview

Shiba Classic ($SHIBC) ist ein Community-getriebenes Kryptowährungsprojekt auf der Ethereum-Blockchain.

## Treasury
Das Treasury-Wallet ist eine Gnosis Safe Multi-Sig unter der Adresse 0x2363c8FA46daF9c090248C6D638f92Cf7cE4bD44.
Es werden 3 von 5 Signaturen benötigt für Transaktionen.

## Governance
Die DAO nutzt Snapshot für Abstimmungen unter dem Space shibaclassic.eth.
Quorum ist 5% der Token-Holder, Abstimmungen dauern 5 Tage.

## Token
- Contract: 0x249cA82617eC3DfB2589c4c17ab7EC9765350a18
- Decimals: 18
- Total Supply: 1,000,000,000,000,000 SHIBC
  `;

  try {
    // Initialize
    await rag.initialize();
    console.log('✅ RAG initialized\n');

    // Index test document
    const chunks = await rag.index(testDoc, 'test/project-overview.md', 'project_doc');
    console.log(`✅ Indexed ${chunks} chunks\n`);

    // Get stats
    const stats = await rag.getStats();
    console.log(`📊 Stats: ${stats.points} points, ${stats.segments} segments\n`);

    // Test searches
    const queries = [
      'Was ist die Treasury Adresse?',
      'Wie funktioniert die Governance?',
      'Wieviele Token gibt es?'
    ];

    for (const query of queries) {
      console.log(`🔍 Query: "${query}"`);
      const results = await rag.search(query, 2);

      for (const r of results) {
        console.log(`   Score: ${r.score.toFixed(3)} | Source: ${r.source}`);
        console.log(`   "${r.text.slice(0, 100)}..."\n`);
      }
    }

    // Build context
    const context = rag.buildContext(await rag.search('Treasury Governance', 3));
    console.log('📄 Context for prompt:');
    console.log(context.slice(0, 500) + '...\n');

    console.log('✅ All tests passed!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
