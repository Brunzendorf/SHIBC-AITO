# SHIBC Smart Contract Template

Hardhat-basiertes Smart Contract Projekt mit TypeScript und OpenZeppelin.

## Features

- Hardhat 2.22+ Development Environment
- OpenZeppelin Contracts 5.x
- TypeChain für Type-Safe Interactions
- Gas Reporter
- Contract Verification (Etherscan)
- Solhint Linting
- Prettier Formatting
- Woodpecker CI Pipeline

## Quick Start

```bash
# Dependencies installieren
npm install

# Contracts kompilieren
npm run compile

# Tests ausführen
npm run test

# Lokales Netzwerk starten
npm run node

# Deploy auf lokalem Netzwerk
npm run deploy:local
```

## Environment Variables

```bash
# Wallet Private Key (ohne 0x prefix)
PRIVATE_KEY=your-private-key

# Etherscan API Key für Verification
ETHERSCAN_API_KEY=your-etherscan-key

# Infura API Key für Netzwerk-Zugang
INFURA_API_KEY=your-infura-key

# Optional: Gas Reporter
REPORT_GAS=true
COINMARKETCAP_API_KEY=your-cmc-key
```

## Project Structure

```
contracts/         # Solidity contracts
├── Example.sol    # Example contract
scripts/           # Deployment scripts
├── deploy.ts      # Main deploy script
test/              # Test files
├── Example.test.ts
typechain-types/   # Generated types (after compile)
```

## Security Checklist

Vor jedem Mainnet Deploy:

- [ ] Alle Tests bestanden
- [ ] Coverage > 90%
- [ ] Slither Static Analysis
- [ ] Manual Code Review
- [ ] External Audit (für kritische Contracts)
- [ ] CEO Approval
- [ ] DAO Vote (bei Token-Änderungen)

## Deployment Process

1. **Testnet (Sepolia)**:
   ```bash
   npm run deploy:sepolia
   ```

2. **Mainnet** (ACHTUNG - unumkehrbar!):
   ```bash
   # Nur nach CEO Approval!
   npm run deploy:mainnet
   ```

3. **Verification**:
   ```bash
   npm run verify -- --network mainnet <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
   ```

## License

MIT - Shiba Classic Project
