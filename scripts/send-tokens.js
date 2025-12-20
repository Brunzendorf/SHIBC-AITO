/**
 * Simple Token Transfer Script
 * Bypasses MetaMask restrictions for sending to any address (e.g., burn/dead wallets)
 *
 * Usage: node send-tokens.js
 */

const { ethers } = require('ethers');
const readline = require('readline');

// ERC20 ABI (only transfer function needed)
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

// Common networks
const NETWORKS = {
  ethereum: {
    name: 'Ethereum Mainnet',
    rpc: 'https://eth.llamarpc.com',
    chainId: 1,
  },
  sepolia: {
    name: 'Sepolia Testnet',
    rpc: 'https://rpc.sepolia.org',
    chainId: 11155111,
  },
  polygon: {
    name: 'Polygon',
    rpc: 'https://polygon-rpc.com',
    chainId: 137,
  },
  bsc: {
    name: 'BNB Smart Chain',
    rpc: 'https://bsc-dataseed.binance.org',
    chainId: 56,
  },
  arbitrum: {
    name: 'Arbitrum One',
    rpc: 'https://arb1.arbitrum.io/rpc',
    chainId: 42161,
  },
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function isValidAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function isValidPrivateKey(key) {
  const clean = key.startsWith('0x') ? key.slice(2) : key;
  return /^[a-fA-F0-9]{64}$/.test(clean);
}

async function main() {
  console.log('\n=== Token Transfer Script ===\n');
  console.log('Available networks:');
  Object.entries(NETWORKS).forEach(([key, net]) => {
    console.log(`  ${key}: ${net.name}`);
  });

  // Get network
  const networkKey = await ask('\nNetwork (ethereum/sepolia/polygon/bsc/arbitrum): ');
  const network = NETWORKS[networkKey.toLowerCase()];
  if (!network) {
    console.error('Invalid network!');
    process.exit(1);
  }

  // Get private key
  const privateKey = await ask('Private Key (64 hex chars, with or without 0x): ');
  if (!isValidPrivateKey(privateKey)) {
    console.error('❌ Invalid private key! Must be 64 hex characters.');
    process.exit(1);
  }
  const cleanKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

  // Get token contract
  const tokenAddress = await ask('Token Contract Address (0x...): ');
  if (!isValidAddress(tokenAddress)) {
    console.error('❌ Invalid token address! Must be 0x + 40 hex characters.');
    process.exit(1);
  }

  // Get recipient
  const toAddress = await ask('Recipient Address (e.g., 0x000...dead): ');
  if (!isValidAddress(toAddress)) {
    console.error('❌ Invalid recipient address! Must be 0x + 40 hex characters.');
    process.exit(1);
  }

  // Get amount
  const amountStr = await ask('Amount to send (number or "max" for full balance): ');

  console.log('\n--- Connecting ---');

  try {
    // Connect
    const provider = new ethers.JsonRpcProvider(network.rpc);
    const wallet = new ethers.Wallet(cleanKey, provider);
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    // Get token info
    const [symbol, decimals, balance] = await Promise.all([
      token.symbol(),
      token.decimals(),
      token.balanceOf(wallet.address),
    ]);

    // Handle "max" amount
    const isMax = amountStr.toLowerCase() === 'max';
    const amount = isMax ? balance : ethers.parseUnits(amountStr, decimals);
    const amountFormatted = ethers.formatUnits(amount, decimals);
    const balanceFormatted = ethers.formatUnits(balance, decimals);

    console.log(`\n--- Transaction Details ---`);
    console.log(`Network: ${network.name}`);
    console.log(`From: ${wallet.address}`);
    console.log(`To: ${toAddress}`);
    console.log(`Token: ${symbol} (${tokenAddress})`);
    console.log(`Amount: ${amountFormatted} ${symbol}${isMax ? ' (MAX)' : ''}`);
    console.log(`Your Balance: ${balanceFormatted} ${symbol}`);

    if (amount > balance) {
      console.error('\n❌ Insufficient balance!');
      process.exit(1);
    }

    const confirm = await ask('\nConfirm transaction? (yes/no): ');
    if (confirm.toLowerCase() !== 'yes') {
      console.log('Cancelled.');
      process.exit(0);
    }

    console.log('\n--- Sending Transaction ---');
    const tx = await token.transfer(toAddress, amount);
    console.log(`TX Hash: ${tx.hash}`);
    console.log('Waiting for confirmation...');

    const receipt = await tx.wait();
    console.log(`\n✅ Success! Block: ${receipt.blockNumber}`);
    console.log(`Explorer: https://etherscan.io/tx/${tx.hash}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }

  rl.close();
}

main();
