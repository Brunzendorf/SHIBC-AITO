# SHIBC Telegram Bot Template

grammY-based Telegram Bot mit Session Management.

## Features

- grammY 1.30+ mit TypeScript
- Session Management (Redis optional)
- Conversations Plugin
- Menu Plugin
- Hydrate Plugin für Parse Mode
- Docker Multi-Stage Build
- Woodpecker CI Pipeline
- Structured Logging (Pino)

## Quick Start

```bash
# Dependencies installieren
npm install

# Bot Token in .env setzen
echo "BOT_TOKEN=your-bot-token" > .env

# Development Server starten
npm run dev
```

## Environment Variables

```bash
# Required
BOT_TOKEN=your-telegram-bot-token

# Optional
REDIS_URL=redis://localhost:6379
LOG_LEVEL=info
NODE_ENV=development
```

## Project Structure

```
src/
├── commands/       # Command handlers
├── conversations/  # Multi-step conversations
├── config/         # Configuration
├── lib/            # Shared utilities
└── index.ts        # Entry point
```

## Creating a New Command

```typescript
// src/commands/mycommand.ts
import type { Context } from 'grammy';

export async function myCommand(ctx: Context): Promise<void> {
  await ctx.reply('Hello from my command!');
}

// Register in index.ts
bot.command('mycommand', myCommand);
```

## License

MIT - Shiba Classic Project
