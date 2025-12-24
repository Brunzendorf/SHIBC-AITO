/**
 * Bot Commands
 */

import type { Context } from 'grammy';

export async function startCommand(ctx: Context): Promise<void> {
  await ctx.reply(`Welcome to SHIBC Bot!

Use /help to see available commands.`);
}

export async function helpCommand(ctx: Context): Promise<void> {
  await ctx.reply(`<b>Available Commands:</b>

/start - Start the bot
/help - Show this help message

Send any message to interact with the bot.`, { parse_mode: 'HTML' });
}
