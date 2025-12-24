/**
 * SHIBC Telegram Bot Template
 * grammY-based Telegram Bot
 */

import { Bot, session, GrammyError, HttpError } from 'grammy';
import type { Context, SessionFlavor } from 'grammy';
import { hydrateReply, parseMode } from '@grammyjs/hydrate';
import type { ParseModeFlavor } from '@grammyjs/hydrate';
import { logger } from './lib/logger.js';
import { config } from './config/index.js';
import { startCommand, helpCommand } from './commands/index.js';

// Session Data Interface
interface SessionData {
  messageCount: number;
  lastInteraction: Date;
}

// Custom Context Type
type BotContext = Context & SessionFlavor<SessionData> & ParseModeFlavor<Context>;

// Initialize Bot
const bot = new Bot<BotContext>(config.botToken);

// Plugins
bot.use(
  session({
    initial: (): SessionData => ({
      messageCount: 0,
      lastInteraction: new Date(),
    }),
  })
);
bot.use(hydrateReply);
bot.api.config.use(parseMode('HTML'));

// Commands
bot.command('start', startCommand);
bot.command('help', helpCommand);

// Message Handler
bot.on('message:text', async (ctx) => {
  ctx.session.messageCount++;
  ctx.session.lastInteraction = new Date();

  logger.info('Message received', {
    userId: ctx.from?.id,
    messageCount: ctx.session.messageCount,
  });

  await ctx.reply(`You've sent ${ctx.session.messageCount} messages!`);
});

// Error Handler
bot.catch((err) => {
  const ctx = err.ctx;
  logger.error('Bot error', {
    error: err.error,
    update: ctx.update,
  });

  if (err.error instanceof GrammyError) {
    logger.error('Telegram API error', { description: err.error.description });
  } else if (err.error instanceof HttpError) {
    logger.error('HTTP error', { error: err.error });
  }
});

// Graceful Shutdown
const shutdown = async (): Promise<void> => {
  logger.info('Shutting down bot...');
  await bot.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start Bot
logger.info('Starting bot...');
bot.start({
  onStart: (botInfo) => {
    logger.info(`Bot started as @${botInfo.username}`);
  },
});
