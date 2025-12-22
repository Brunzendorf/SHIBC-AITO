#!/usr/bin/env node
/**
 * Imagen MCP Server
 *
 * Google Imagen image generation server for AITO using official @modelcontextprotocol/sdk.
 * Features: Image generation, SHIBC branding (logo watermark, text footer), rate limiting.
 *
 * Environment Variables:
 * - GEMINI_API_KEY: Google GenAI API key (required)
 * - IMAGEN_MAX_PER_HOUR: Max images per hour (default: 10)
 * - IMAGEN_MAX_PER_DAY: Max images per day (default: 50)
 * - IMAGEN_MAX_COST_PER_DAY: Max cost per day in USD (default: 2.00)
 * - WORKSPACE_DIR: Directory for workspace files (default: /app/workspace)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GoogleGenAI, PersonGeneration } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

// --- SHIBC Brand Constants ---
const SHIBC_BRAND = {
  colors: {
    primary: '#fda92d',      // Orange/Gold
    dark: '#141A21',         // Dark Background
    light: '#F7F8F9',        // Light text
  },
  social: {
    telegram: '@shibc_cto',
    twitter: '@shibc_cto',
    website: 'shibaclassic.io',
  },
};

// --- Rate Limiter Configuration ---
const RATE_LIMITS = {
  maxImagesPerHour: parseInt(process.env.IMAGEN_MAX_PER_HOUR || '10', 10),
  maxImagesPerDay: parseInt(process.env.IMAGEN_MAX_PER_DAY || '50', 10),
  maxCostPerDay: parseFloat(process.env.IMAGEN_MAX_COST_PER_DAY || '2.00'),
};

interface UsageRecord {
  timestamp: number;
  model: string;
  cost: number;
}

const usageHistory: UsageRecord[] = [];

function getUsageInWindow(windowMs: number): { count: number; cost: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const inWindow = usageHistory.filter(r => r.timestamp > cutoff);
  return {
    count: inWindow.length,
    cost: inWindow.reduce((sum, r) => sum + r.cost, 0),
  };
}

function checkRateLimit(modelId: string): { allowed: boolean; reason?: string } {
  const hourlyUsage = getUsageInWindow(60 * 60 * 1000);
  const dailyUsage = getUsageInWindow(24 * 60 * 60 * 1000);

  if (hourlyUsage.count >= RATE_LIMITS.maxImagesPerHour) {
    return { allowed: false, reason: `Rate limit exceeded: ${hourlyUsage.count}/${RATE_LIMITS.maxImagesPerHour} images per hour` };
  }

  if (dailyUsage.count >= RATE_LIMITS.maxImagesPerDay) {
    return { allowed: false, reason: `Rate limit exceeded: ${dailyUsage.count}/${RATE_LIMITS.maxImagesPerDay} images per day` };
  }

  if (dailyUsage.cost >= RATE_LIMITS.maxCostPerDay) {
    return { allowed: false, reason: `Cost limit exceeded: $${dailyUsage.cost.toFixed(2)}/$${RATE_LIMITS.maxCostPerDay.toFixed(2)} per day` };
  }

  return { allowed: true };
}

function recordUsage(modelId: string, cost: number) {
  usageHistory.push({ timestamp: Date.now(), model: modelId, cost });

  const dailyUsage = getUsageInWindow(24 * 60 * 60 * 1000);
  console.error(JSON.stringify({
    event: 'imagen_usage',
    model: modelId,
    cost,
    dailyCount: dailyUsage.count,
    dailyCost: dailyUsage.cost.toFixed(2),
    limits: RATE_LIMITS,
  }));

  // Cleanup old records (older than 24 hours)
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  while (usageHistory.length > 0 && usageHistory[0].timestamp < cutoff) {
    usageHistory.shift();
  }
}

// --- Data for Tools ---
const MODEL_CATALOG = [
  { model_id: "imagen-4.0-generate-001", name: "Imagen 4", feature: "Image Generation", input: "Text", output: "Image", price_per_image: 0.04, technical_id: "models/imagen-4.0-generate-001" },
  { model_id: "gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", feature: "Image Generation", input: "Text", output: "Image", price_per_image: 0.0, technical_id: "gemini-2.5-flash-image" },
];

const PROMPT_GUIDE = {
  general_tips: [
    "Be specific and detailed. Instead of 'a car', try 'a futuristic sports car with glowing blue accents on a rainy neon-lit street'.",
    "Include the style: 'photorealistic', 'cinematic lighting', 'van gogh style', 'cyberpunk aesthetic'.",
  ],
};

// --- Branding Functions ---

async function addTextFooter(imageBuffer: Buffer, handles?: { telegram?: string; twitter?: string }): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Could not determine image dimensions');
  }

  const tg = handles?.telegram || SHIBC_BRAND.social.telegram;
  const tw = handles?.twitter || SHIBC_BRAND.social.twitter;

  // Smart text: If handles are the same, show handle + website
  const text = (tg === tw)
    ? `𝕏 ${tw}  •  ${SHIBC_BRAND.social.website}`
    : `𝕏 ${tw}  •  TG ${tg}`;

  const fontSize = Math.max(18, Math.floor(metadata.width * 0.035));
  const padding = Math.floor(fontSize * 1.0);
  const footerHeight = fontSize + padding * 2;

  const escapedText = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const textSvg = `
    <svg width="${metadata.width}" height="${footerHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${SHIBC_BRAND.colors.dark}" fill-opacity="0.9"/>
      <text
        x="50%"
        y="55%"
        text-anchor="middle"
        dominant-baseline="middle"
        font-family="sans-serif"
        font-size="${fontSize}px"
        font-weight="600"
        fill="${SHIBC_BRAND.colors.light}"
      >${escapedText}</text>
    </svg>
  `;

  return sharp(imageBuffer)
    .composite([{
      input: Buffer.from(textSvg),
      top: metadata.height - footerHeight,
      left: 0,
    }])
    .toBuffer();
}

async function addLogoWatermark(
  imageBuffer: Buffer,
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' = 'bottom-right',
  opacity: number = 0.85
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Could not determine image dimensions');
  }

  const workspaceDir = process.env.WORKSPACE_DIR || '/app/workspace';
  const logoPaths = [
    path.join(workspaceDir, 'assets', 'brand', 'SHIBC-logo.png'),
    path.join(workspaceDir, 'SHIBC-logo.png'),
    '/app/workspace/assets/brand/SHIBC-logo.png',
  ];

  let logoPath: string | null = null;
  for (const p of logoPaths) {
    if (fs.existsSync(p)) {
      logoPath = p;
      break;
    }
  }

  if (!logoPath) {
    // Create a simple text-based logo as fallback
    const logoSize = Math.floor(metadata.width * 0.12);
    const logoSvg = `
      <svg width="${logoSize}" height="${logoSize}">
        <rect width="100%" height="100%" fill="${SHIBC_BRAND.colors.primary}" rx="10"/>
        <text
          x="50%"
          y="55%"
          text-anchor="middle"
          dominant-baseline="middle"
          font-family="Arial, sans-serif"
          font-size="${Math.floor(logoSize * 0.35)}"
          font-weight="bold"
          fill="${SHIBC_BRAND.colors.dark}"
        >SHIBC</text>
      </svg>
    `;

    const logoBuffer = await sharp(Buffer.from(logoSvg))
      .png()
      .toBuffer();

    const logoMeta = await sharp(logoBuffer).metadata();
    const logoWidth = logoMeta.width || logoSize;
    const logoHeight = logoMeta.height || logoSize;
    const paddingVal = 20;

    let left = 0, top = 0;
    switch (position) {
      case 'top-left': left = paddingVal; top = paddingVal; break;
      case 'top-right': left = metadata.width - logoWidth - paddingVal; top = paddingVal; break;
      case 'bottom-left': left = paddingVal; top = metadata.height - logoHeight - paddingVal; break;
      case 'bottom-right': left = metadata.width - logoWidth - paddingVal; top = metadata.height - logoHeight - paddingVal; break;
      case 'center': left = Math.floor((metadata.width - logoWidth) / 2); top = Math.floor((metadata.height - logoHeight) / 2); break;
    }

    return sharp(imageBuffer)
      .composite([{ input: logoBuffer, left, top }])
      .toBuffer();
  }

  // Use actual logo file
  const logoWidth = Math.floor(metadata.width * 0.15);
  const logo = await sharp(logoPath)
    .resize(logoWidth, null, { fit: 'inside', withoutEnlargement: true })
    .toBuffer();

  const logoMeta = await sharp(logo).metadata();
  const logoHeight = logoMeta.height || 0;
  const paddingVal = 20;

  let left = 0, top = 0;
  switch (position) {
    case 'top-left': left = paddingVal; top = paddingVal; break;
    case 'top-right': left = metadata.width - logoWidth - paddingVal; top = paddingVal; break;
    case 'bottom-left': left = paddingVal; top = metadata.height - logoHeight - paddingVal; break;
    case 'bottom-right': left = metadata.width - logoWidth - paddingVal; top = metadata.height - logoHeight - paddingVal; break;
    case 'center': left = Math.floor((metadata.width - logoWidth) / 2); top = Math.floor((metadata.height - logoHeight) / 2); break;
  }

  return sharp(imageBuffer)
    .composite([{ input: logo, left, top }])
    .toBuffer();
}

async function applyBranding(
  imageBase64: string,
  brandingType: 'logo-watermark' | 'text-footer' | 'logo-and-text' | 'none',
  options?: {
    logoPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
    logoOpacity?: number;
    customHandles?: { telegram?: string; twitter?: string };
  }
): Promise<string> {
  if (brandingType === 'none') {
    return imageBase64;
  }

  let buffer: Buffer = Buffer.from(imageBase64, 'base64');

  switch (brandingType) {
    case 'logo-watermark':
      buffer = Buffer.from(await addLogoWatermark(buffer, options?.logoPosition || 'bottom-right', options?.logoOpacity || 0.85));
      break;
    case 'text-footer':
      buffer = Buffer.from(await addTextFooter(buffer, options?.customHandles));
      break;
    case 'logo-and-text':
      buffer = Buffer.from(await addLogoWatermark(buffer, options?.logoPosition || 'top-right', options?.logoOpacity || 0.85));
      buffer = Buffer.from(await addTextFooter(buffer, options?.customHandles));
      break;
  }

  return buffer.toString('base64');
}

// --- Logging Helper ---
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: 'imagen-mcp',
    msg: message,
    ...data
  };
  console.error(JSON.stringify(entry));
}

// --- Create MCP Server using official SDK ---
const server = new Server(
  {
    name: 'imagen-mcp',
    version: '1.1.0',
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
        name: 'imagen_list_models',
        description: 'Discovers and lists all available Google Imagen models for the GenAI API.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'imagen_get_prompt_guide',
        description: 'Provides general tips for writing effective image generation prompts.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'imagen_check_quota',
        description: 'Checks current rate limit status and remaining quota for image generation. Call this BEFORE generating images to ensure quota is available.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'imagen_generate_image',
        description: 'Generates an image using a specified Google Imagen model based on a text prompt with extensive configuration options.',
        inputSchema: {
          type: 'object',
          properties: {
            modelId: { type: 'string', description: "The ID of the Imagen model to use (e.g., 'imagen-4.0-generate-001')." },
            prompt: { type: 'string', description: 'The text description for the image to be generated.' },
            negativePrompt: { type: 'string', description: 'Optional. A prompt describing what should NOT be in the image.' },
            numberOfImages: { type: 'number', description: 'Optional. The number of images to generate (1-4). Defaults to 1.' },
            aspectRatio: { type: 'string', description: "Optional. The aspect ratio of the generated image. Allowed values: '1:1', '16:9', '9:16', '4:3', '3:4'." },
            imageSize: { type: 'string', description: "Optional. The resolution of the image. Allowed values: '1K', '2K', '4K'. Defaults to '1K'." },
            personGeneration: { type: 'string', description: "Optional. Controls generation of people. Allowed values: 'dont_allow' (default), 'allow_adult', 'allow_all'." },
            add_watermark: { type: 'boolean', description: 'Optional. If true, a watermark is added to the generated images. Defaults to false.' },
            seed: { type: 'number', description: 'Optional. A specific seed for noise generation to ensure reproducibility.' },
            language: { type: 'string', description: 'Optional. The language of the prompt, e.g., "en" for English.' },
          },
          required: ['modelId', 'prompt']
        }
      },
      {
        name: 'imagen_apply_branding',
        description: 'Applies SHIBC branding (logo watermark and/or text footer with social handles) to an existing image. Use this AFTER generating an image to add official branding.',
        inputSchema: {
          type: 'object',
          properties: {
            imageBase64: { type: 'string', description: 'The base64-encoded image to apply branding to.' },
            brandingType: {
              type: 'string',
              description: "Type of branding to apply. Options: 'logo-watermark' (logo only), 'text-footer' (social handles only), 'logo-and-text' (both), 'none' (no branding).",
              enum: ['logo-watermark', 'text-footer', 'logo-and-text', 'none']
            },
            logoPosition: {
              type: 'string',
              description: "Position for logo watermark. Options: 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'. Default: 'bottom-right'.",
              enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']
            },
            logoOpacity: { type: 'number', description: 'Opacity for logo watermark (0.0-1.0). Default: 0.85.' },
            customHandles: {
              type: 'object',
              description: 'Optional custom social handles. Default uses @shibc_cto.',
              properties: {
                telegram: { type: 'string' },
                twitter: { type: 'string' }
              }
            }
          },
          required: ['imageBase64', 'brandingType']
        }
      }
    ],
  };
});

// --- Handle tool calls ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  log('info', `Tool called: ${name}`, { tool: name, argsKeys: args ? Object.keys(args) : [] });

  try {
    switch (name) {
      case 'imagen_list_models': {
        log('debug', 'Returning model catalog');
        return {
          content: [{ type: 'text', text: JSON.stringify(MODEL_CATALOG, null, 2) }],
        };
      }

      case 'imagen_get_prompt_guide': {
        log('debug', 'Returning prompt guide');
        return {
          content: [{ type: 'text', text: JSON.stringify(PROMPT_GUIDE, null, 2) }],
        };
      }

      case 'imagen_check_quota': {
        log('debug', 'Checking quota');
        const hourlyUsage = getUsageInWindow(60 * 60 * 1000);
        const dailyUsage = getUsageInWindow(24 * 60 * 60 * 1000);
        return {
          content: [{ type: 'text', text: JSON.stringify({
            limits: RATE_LIMITS,
            current_usage: {
              hourly: { count: hourlyUsage.count, remaining: RATE_LIMITS.maxImagesPerHour - hourlyUsage.count },
              daily: { count: dailyUsage.count, remaining: RATE_LIMITS.maxImagesPerDay - dailyUsage.count },
              cost: { spent: dailyUsage.cost.toFixed(2), remaining: (RATE_LIMITS.maxCostPerDay - dailyUsage.cost).toFixed(2) },
            },
            can_generate: hourlyUsage.count < RATE_LIMITS.maxImagesPerHour &&
                          dailyUsage.count < RATE_LIMITS.maxImagesPerDay &&
                          dailyUsage.cost < RATE_LIMITS.maxCostPerDay,
          }, null, 2) }]
        };
      }

      case 'imagen_generate_image': {
        const { modelId, prompt, negativePrompt, ...configArgs } = args as {
          modelId: string;
          prompt: string;
          negativePrompt?: string;
          numberOfImages?: number;
          aspectRatio?: string;
          imageSize?: string;
          personGeneration?: string;
          add_watermark?: boolean;
          seed?: number;
          language?: string;
        };

        log('info', 'Starting image generation', { modelId, promptLen: prompt?.length });

        // Check rate limits FIRST
        const rateLimitCheck = checkRateLimit(modelId);
        if (!rateLimitCheck.allowed) {
          log('warn', 'Rate limit exceeded', { reason: rateLimitCheck.reason });
          return {
            content: [{ type: 'text', text: `Image generation blocked: ${rateLimitCheck.reason}` }],
            isError: true,
          };
        }

        const modelInfo = MODEL_CATALOG.find(m => m.model_id === modelId);
        if (!modelInfo) {
          log('error', 'Model not found', { modelId });
          return {
            content: [{ type: 'text', text: `Model with id '${modelId}' not found in catalog.` }],
            isError: true,
          };
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          log('error', 'Missing GEMINI_API_KEY');
          return {
            content: [{ type: 'text', text: 'GEMINI_API_KEY environment variable is not set.' }],
            isError: true,
          };
        }

        log('debug', 'Calling Google GenAI API', { model: modelInfo.technical_id });
        const ai = new GoogleGenAI({ apiKey });

        // Dynamically build the config object
        const config: Record<string, unknown> = {};
        if (configArgs.numberOfImages) config.numberOfImages = configArgs.numberOfImages;
        if (configArgs.aspectRatio) config.aspectRatio = configArgs.aspectRatio;
        if (configArgs.imageSize) config.imageSize = configArgs.imageSize;
        if (configArgs.add_watermark !== undefined) config.add_watermark = configArgs.add_watermark;
        if (configArgs.seed) config.seed = configArgs.seed;
        if (configArgs.language) config.language = configArgs.language;

        // Handle the personGeneration enum
        if (configArgs.personGeneration) {
          const pg = configArgs.personGeneration.toUpperCase();
          if (pg === 'ALLOW_ADULT') config.personGeneration = PersonGeneration.ALLOW_ADULT;
          else if (pg === 'DONT_ALLOW') config.personGeneration = PersonGeneration.DONT_ALLOW;
          else if (pg === 'ALLOW_ALL') config.personGeneration = PersonGeneration.ALLOW_ALL;
        }

        const genStart = Date.now();
        // Build params - negativePrompt may not be in types but API accepts it
        const generateParams: Record<string, unknown> = {
          model: modelInfo.technical_id,
          prompt: prompt,
          config: config,
        };
        if (negativePrompt) {
          generateParams.negativePrompt = negativePrompt;
        }
        const response = await ai.models.generateImages(generateParams as unknown as Parameters<typeof ai.models.generateImages>[0]);

        log('info', 'API response received', { durationMs: Date.now() - genStart, hasImages: !!response?.generatedImages });

        if (!response?.generatedImages) {
          return {
            content: [{ type: 'text', text: 'API did not return any generated images.' }],
            isError: true,
          };
        }

        const imagesBase64 = response.generatedImages
          .map((img: { image?: { imageBytes?: string } }) => img?.image?.imageBytes)
          .filter(Boolean);

        // Record successful usage for rate limiting
        const imageCount = imagesBase64.length || 1;
        recordUsage(modelId, modelInfo.price_per_image * imageCount);

        log('info', 'Image generation completed', { imageCount, cost: modelInfo.price_per_image * imageCount, totalDurationMs: Date.now() - startTime });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            message: "Image(s) generated successfully.",
            model_used: modelId,
            images_base64: imagesBase64,
            rate_limit_info: {
              images_generated: imageCount,
              cost: (modelInfo.price_per_image * imageCount).toFixed(2),
              daily_usage: getUsageInWindow(24 * 60 * 60 * 1000),
            }
          })}]
        };
      }

      case 'imagen_apply_branding': {
        const { imageBase64, brandingType, logoPosition, logoOpacity, customHandles } = args as {
          imageBase64: string;
          brandingType: 'logo-watermark' | 'text-footer' | 'logo-and-text' | 'none';
          logoPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
          logoOpacity?: number;
          customHandles?: { telegram?: string; twitter?: string };
        };

        log('info', 'Applying branding', { brandingType, logoPosition, hasImage: !!imageBase64 });

        if (!imageBase64) {
          return {
            content: [{ type: 'text', text: 'imageBase64 is required' }],
            isError: true,
          };
        }
        if (!brandingType || !['logo-watermark', 'text-footer', 'logo-and-text', 'none'].includes(brandingType)) {
          return {
            content: [{ type: 'text', text: "Invalid brandingType. Must be one of: 'logo-watermark', 'text-footer', 'logo-and-text', 'none'" }],
            isError: true,
          };
        }

        const brandStart = Date.now();
        const brandedImage = await applyBranding(imageBase64, brandingType, {
          logoPosition: logoPosition || 'bottom-right',
          logoOpacity: logoOpacity || 0.85,
          customHandles: customHandles,
        });

        log('info', 'Branding applied', { brandingType, durationMs: Date.now() - brandStart });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            message: `Branding applied successfully: ${brandingType}`,
            branding_type: brandingType,
            logo_position: logoPosition || 'bottom-right',
            image_base64: brandedImage,
          })}]
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
  log('info', 'Imagen MCP Server starting', { rateLimits: RATE_LIMITS, version: '1.1.0', sdk: '@modelcontextprotocol/sdk' });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'Server connected via stdio');
}

main().catch((error) => {
  log('error', 'Fatal error', { error: error instanceof Error ? error.message : 'Unknown error' });
  process.exit(1);
});
