#!/usr/bin/env node
/**
 * Telegram MCP Server
 *
 * Full-featured Telegram Bot API server for AITO using official @modelcontextprotocol/sdk.
 * Supports: text messages, photos (base64/URL), documents, pins, forwards.
 *
 * Environment Variables:
 * - TELEGRAM_BOT_TOKEN: Telegram Bot API token (required)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import FormData from 'form-data';
import * as fs from 'fs';
import * as path from 'path';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// --- Logging Helper ---
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: 'telegram-mcp',
    msg: message,
    ...data
  };
  console.error(JSON.stringify(entry));
}

// --- Telegram API Helper ---
async function telegramRequest(
  method: string,
  params: Record<string, unknown> = {}
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const url = `${API_BASE}/${method}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await response.json() as { ok: boolean; result?: unknown; description?: string };
    return data;
  } catch (error) {
    return {
      ok: false,
      description: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// --- Send Photo with Base64 Support ---
async function sendPhotoWithBase64(
  chatId: string | number,
  photoBase64: string,
  caption?: string,
  parseMode?: string
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const url = `${API_BASE}/sendPhoto`;

  // Convert base64 to Buffer
  const imageBuffer = Buffer.from(photoBase64, 'base64');

  // Create form data
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', imageBuffer, {
    filename: 'image.png',
    contentType: 'image/png',
  });
  if (caption) form.append('caption', caption);
  if (parseMode) form.append('parse_mode', parseMode);

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    const data = await response.json() as { ok: boolean; result?: unknown; description?: string };
    return data;
  } catch (error) {
    return {
      ok: false,
      description: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// --- Send Photo from File Path ---
async function sendPhotoFromFile(
  chatId: string | number,
  filePath: string,
  caption?: string,
  parseMode?: string
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const url = `${API_BASE}/sendPhoto`;

  try {
    // Read file from disk
    if (!fs.existsSync(filePath)) {
      return { ok: false, description: `File not found: ${filePath}` };
    }

    const imageBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Determine content type
    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const contentType = contentTypes[ext] || 'image/png';

    // Create form data
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', imageBuffer, { filename, contentType });
    if (caption) form.append('caption', caption);
    if (parseMode) form.append('parse_mode', parseMode);

    const response = await fetch(url, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    const data = await response.json() as { ok: boolean; result?: unknown; description?: string };
    return data;
  } catch (error) {
    return {
      ok: false,
      description: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// --- Create MCP Server ---
const server = new Server(
  {
    name: 'telegram-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- List available tools ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log('debug', 'Returning tools list');
  return {
    tools: [
      {
        name: 'telegram_send_message',
        description: 'Send a text message to a Telegram chat or channel.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Chat ID or @username of the channel' },
            text: { type: 'string', description: 'Message text (supports Markdown/HTML)' },
            parse_mode: { type: 'string', enum: ['Markdown', 'HTML', 'MarkdownV2'], description: 'Optional parse mode' },
            disable_notification: { type: 'boolean', description: 'Send silently' },
          },
          required: ['chat_id', 'text']
        }
      },
      {
        name: 'telegram_send_photo',
        description: 'Send a photo to a Telegram chat. Supports base64-encoded images, URLs, or file_id.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Chat ID or @username of the channel' },
            photo: { type: 'string', description: 'Photo as base64 string, URL, or file_id' },
            photo_type: { type: 'string', enum: ['base64', 'url', 'file_id'], description: 'Type of photo input. Default: auto-detect' },
            caption: { type: 'string', description: 'Photo caption (0-1024 characters)' },
            parse_mode: { type: 'string', enum: ['Markdown', 'HTML', 'MarkdownV2'], description: 'Caption parse mode' },
          },
          required: ['chat_id', 'photo']
        }
      },
      {
        name: 'telegram_send_photo_from_file',
        description: 'Send a photo from a local file path to Telegram. Use this when you have an image saved on disk (e.g., from imagen_generate_image). This avoids passing large base64 data through the LLM context.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Chat ID or @username of the channel' },
            file_path: { type: 'string', description: 'Absolute path to the image file (PNG, JPG, GIF, WebP)' },
            caption: { type: 'string', description: 'Photo caption (0-1024 characters)' },
            parse_mode: { type: 'string', enum: ['Markdown', 'HTML', 'MarkdownV2'], description: 'Caption parse mode' },
          },
          required: ['chat_id', 'file_path']
        }
      },
      {
        name: 'telegram_send_document',
        description: 'Send a document/file to a Telegram chat.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Chat ID or @username of the channel' },
            document: { type: 'string', description: 'Document as base64 string, URL, or file_id' },
            document_type: { type: 'string', enum: ['base64', 'url', 'file_id'], description: 'Type of document input' },
            filename: { type: 'string', description: 'Filename for base64 documents' },
            caption: { type: 'string', description: 'Document caption' },
          },
          required: ['chat_id', 'document']
        }
      },
      {
        name: 'telegram_get_chat',
        description: 'Get information about a chat/channel.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Chat ID or @username' },
          },
          required: ['chat_id']
        }
      },
      {
        name: 'telegram_pin_message',
        description: 'Pin a message in a chat.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Chat ID or @username' },
            message_id: { type: 'number', description: 'Message ID to pin' },
            disable_notification: { type: 'boolean', description: 'Pin silently' },
          },
          required: ['chat_id', 'message_id']
        }
      },
      {
        name: 'telegram_forward_message',
        description: 'Forward a message from one chat to another.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Target chat ID' },
            from_chat_id: { type: 'string', description: 'Source chat ID' },
            message_id: { type: 'number', description: 'Message ID to forward' },
          },
          required: ['chat_id', 'from_chat_id', 'message_id']
        }
      },
      {
        name: 'telegram_get_chat_administrators',
        description: 'Get list of administrators in a chat.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'Chat ID or @username' },
          },
          required: ['chat_id']
        }
      },
    ],
  };
});

// --- Handle tool calls ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  // Check for bot token
  if (!BOT_TOKEN) {
    return {
      content: [{ type: 'text', text: 'Error: TELEGRAM_BOT_TOKEN not configured' }],
      isError: true,
    };
  }

  log('info', `Tool called: ${name}`, { tool: name });

  try {
    switch (name) {
      case 'telegram_send_message': {
        const { chat_id, text, parse_mode, disable_notification } = args as {
          chat_id: string;
          text: string;
          parse_mode?: string;
          disable_notification?: boolean;
        };

        const result = await telegramRequest('sendMessage', {
          chat_id,
          text,
          parse_mode,
          disable_notification,
        });

        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `Telegram error: ${result.description}` }],
            isError: true,
          };
        }

        const msg = result.result as { message_id: number; date: number };
        log('info', 'Message sent', { messageId: msg.message_id, chatId: chat_id });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            message_id: msg.message_id,
            chat_id,
            sent_at: new Date(msg.date * 1000).toISOString(),
          }, null, 2) }],
        };
      }

      case 'telegram_send_photo': {
        const { chat_id, photo, photo_type, caption, parse_mode } = args as {
          chat_id: string;
          photo: string;
          photo_type?: 'base64' | 'url' | 'file_id';
          caption?: string;
          parse_mode?: string;
        };

        // Auto-detect photo type if not specified
        let detectedType = photo_type;
        if (!detectedType) {
          if (photo.startsWith('http://') || photo.startsWith('https://')) {
            detectedType = 'url';
          } else if (photo.length > 100 && !photo.includes('/')) {
            detectedType = 'base64';
          } else {
            detectedType = 'file_id';
          }
        }

        let result;
        if (detectedType === 'base64') {
          log('info', 'Sending photo as base64', { chatId: chat_id, size: photo.length });
          result = await sendPhotoWithBase64(chat_id, photo, caption, parse_mode);
        } else {
          // URL or file_id - use JSON API
          result = await telegramRequest('sendPhoto', {
            chat_id,
            photo,
            caption,
            parse_mode,
          });
        }

        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `Telegram error: ${result.description}` }],
            isError: true,
          };
        }

        const msg = result.result as { message_id: number; date: number };
        log('info', 'Photo sent', { messageId: msg.message_id, chatId: chat_id, type: detectedType });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            message_id: msg.message_id,
            chat_id,
            photo_type: detectedType,
            sent_at: new Date(msg.date * 1000).toISOString(),
          }, null, 2) }],
        };
      }

      case 'telegram_send_photo_from_file': {
        const { chat_id, file_path, caption, parse_mode } = args as {
          chat_id: string;
          file_path: string;
          caption?: string;
          parse_mode?: string;
        };

        log('info', 'Sending photo from file', { chatId: chat_id, filePath: file_path });
        const result = await sendPhotoFromFile(chat_id, file_path, caption, parse_mode);

        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `Telegram error: ${result.description}` }],
            isError: true,
          };
        }

        const msg = result.result as { message_id: number; date: number };
        log('info', 'Photo sent from file', { messageId: msg.message_id, chatId: chat_id, filePath: file_path });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            message_id: msg.message_id,
            chat_id,
            file_path,
            sent_at: new Date(msg.date * 1000).toISOString(),
          }, null, 2) }],
        };
      }

      case 'telegram_send_document': {
        const { chat_id, document, document_type, filename, caption } = args as {
          chat_id: string;
          document: string;
          document_type?: 'base64' | 'url' | 'file_id';
          filename?: string;
          caption?: string;
        };

        let result;
        if (document_type === 'base64') {
          const url = `${API_BASE}/sendDocument`;
          const docBuffer = Buffer.from(document, 'base64');

          const form = new FormData();
          form.append('chat_id', String(chat_id));
          form.append('document', docBuffer, {
            filename: filename || 'document.bin',
            contentType: 'application/octet-stream',
          });
          if (caption) form.append('caption', caption);

          const response = await fetch(url, {
            method: 'POST',
            body: form,
            headers: form.getHeaders(),
          });
          result = await response.json() as { ok: boolean; result?: unknown; description?: string };
        } else {
          result = await telegramRequest('sendDocument', {
            chat_id,
            document,
            caption,
          });
        }

        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `Telegram error: ${result.description}` }],
            isError: true,
          };
        }

        const msg = result.result as { message_id: number };
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            message_id: msg.message_id,
            chat_id,
          }, null, 2) }],
        };
      }

      case 'telegram_get_chat': {
        const { chat_id } = args as { chat_id: string };

        const result = await telegramRequest('getChat', { chat_id });

        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `Telegram error: ${result.description}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result.result, null, 2) }],
        };
      }

      case 'telegram_pin_message': {
        const { chat_id, message_id, disable_notification } = args as {
          chat_id: string;
          message_id: number;
          disable_notification?: boolean;
        };

        const result = await telegramRequest('pinChatMessage', {
          chat_id,
          message_id,
          disable_notification,
        });

        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `Telegram error: ${result.description}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            pinned_message_id: message_id,
            chat_id,
          }, null, 2) }],
        };
      }

      case 'telegram_forward_message': {
        const { chat_id, from_chat_id, message_id } = args as {
          chat_id: string;
          from_chat_id: string;
          message_id: number;
        };

        const result = await telegramRequest('forwardMessage', {
          chat_id,
          from_chat_id,
          message_id,
        });

        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `Telegram error: ${result.description}` }],
            isError: true,
          };
        }

        const msg = result.result as { message_id: number };
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            new_message_id: msg.message_id,
            original_message_id: message_id,
            from_chat_id,
            to_chat_id: chat_id,
          }, null, 2) }],
        };
      }

      case 'telegram_get_chat_administrators': {
        const { chat_id } = args as { chat_id: string };

        const result = await telegramRequest('getChatAdministrators', { chat_id });

        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `Telegram error: ${result.description}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result.result, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log('error', `Tool failed: ${name}`, { error: errorMessage, durationMs: Date.now() - startTime });
    return {
      content: [{ type: 'text', text: `Tool call failed: ${errorMessage}` }],
      isError: true,
    };
  }
});

// --- Start server ---
async function main() {
  if (!BOT_TOKEN) {
    log('error', 'TELEGRAM_BOT_TOKEN not set');
    process.exit(1);
  }

  log('info', 'Telegram MCP Server starting', { version: '1.0.0', sdk: '@modelcontextprotocol/sdk' });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'Server connected via stdio');
}

main().catch((error) => {
  log('error', 'Fatal error', { error: error instanceof Error ? error.message : 'Unknown error' });
  process.exit(1);
});
