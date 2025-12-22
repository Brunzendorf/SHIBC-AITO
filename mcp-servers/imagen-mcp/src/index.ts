// Use require for CommonJS compatibility
const { GoogleGenAI, PersonGeneration } = require('@google/genai');
import * as readline from 'readline';
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
  maxCostPerDay: parseFloat(process.env.IMAGEN_MAX_COST_PER_DAY || '2.00'), // $2.00 default
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
  const hourlyUsage = getUsageInWindow(60 * 60 * 1000); // 1 hour
  const dailyUsage = getUsageInWindow(24 * 60 * 60 * 1000); // 24 hours

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

  // Log usage for monitoring
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

// --- Types and Interfaces ---

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
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

const TOOLS = [
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
];

// --- Branding Functions ---

async function addTextFooter(imageBuffer: Buffer, handles?: { telegram?: string; twitter?: string }): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Could not determine image dimensions');
  }

  const tg = handles?.telegram || SHIBC_BRAND.social.telegram;
  const tw = handles?.twitter || SHIBC_BRAND.social.twitter;

  // Smart text: If handles are the same, show handle + website
  // Otherwise show both X (Twitter) and TG (Telegram) handles
  const text = (tg === tw)
    ? `𝕏 ${tw}  •  ${SHIBC_BRAND.social.website}`
    : `𝕏 ${tw}  •  TG ${tg}`;

  // Increased font size for better visibility (was 1.8%, now 3.5%)
  const fontSize = Math.max(18, Math.floor(metadata.width * 0.035));
  const padding = Math.floor(fontSize * 1.0);
  const footerHeight = fontSize + padding * 2;

  // Escape text for XML/SVG safety
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

  // Look for logo in workspace
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
    const padding = 20;

    let left = 0, top = 0;
    switch (position) {
      case 'top-left': left = padding; top = padding; break;
      case 'top-right': left = metadata.width - logoWidth - padding; top = padding; break;
      case 'bottom-left': left = padding; top = metadata.height - logoHeight - padding; break;
      case 'bottom-right': left = metadata.width - logoWidth - padding; top = metadata.height - logoHeight - padding; break;
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
  const padding = 20;

  let left = 0, top = 0;
  switch (position) {
    case 'top-left': left = padding; top = padding; break;
    case 'top-right': left = metadata.width - logoWidth - padding; top = padding; break;
    case 'bottom-left': left = padding; top = metadata.height - logoHeight - padding; break;
    case 'bottom-right': left = metadata.width - logoWidth - padding; top = metadata.height - logoHeight - padding; break;
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

// --- Utility Functions ---

function sendResponse(id: number, result: any) {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id,
    result
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendError(id: number, message: string) {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32603,
      message
    }
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

// --- Logging Helper (logs to stderr, not stdout) ---
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: any) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: 'imagen-mcp',
    msg: message,
    ...data
  };
  console.error(JSON.stringify(entry));
}

// --- Tool Implementation ---

async function handleToolCall(request: JsonRpcRequest) {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  log('info', `Tool called: ${name}`, { tool: name, argsKeys: args ? Object.keys(args) : [] });

  try {
    switch (name) {
      case 'imagen_list_models':
        log('debug', 'Returning model catalog');
        sendResponse(request.id, { content: [{ type: 'text', text: JSON.stringify(MODEL_CATALOG, null, 2) }] });
        break;

      case 'imagen_get_prompt_guide':
        log('debug', 'Returning prompt guide');
        sendResponse(request.id, { content: [{ type: 'text', text: JSON.stringify(PROMPT_GUIDE, null, 2) }] });
        break;

      case 'imagen_check_quota':
        log('debug', 'Checking quota');
        const hourlyUsage = getUsageInWindow(60 * 60 * 1000);
        const dailyUsage = getUsageInWindow(24 * 60 * 60 * 1000);
        sendResponse(request.id, {
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
        });
        break;

      case 'imagen_generate_image':
        const { modelId, prompt, negativePrompt, ...configArgs } = args;

        log('info', 'Starting image generation', { modelId, promptLen: prompt?.length });

        // Check rate limits FIRST
        const rateLimitCheck = checkRateLimit(modelId);
        if (!rateLimitCheck.allowed) {
          log('warn', 'Rate limit exceeded', { reason: rateLimitCheck.reason });
          throw new Error(`Image generation blocked: ${rateLimitCheck.reason}`);
        }

        const modelInfo = MODEL_CATALOG.find(m => m.model_id === modelId);
        if (!modelInfo) {
          log('error', 'Model not found', { modelId });
          throw new Error(`Model with id '${modelId}' not found in catalog.`);
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            log('error', 'Missing GEMINI_API_KEY');
            throw new Error("GEMINI_API_KEY environment variable is not set.");
        }

        log('debug', 'Calling Google GenAI API', { model: modelInfo.technical_id });
        const ai = new GoogleGenAI({ apiKey });

        // Dynamically build the config object from provided arguments
        const config: any = {};
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
        const response = await ai.models.generateImages({
            model: modelInfo.technical_id,
            prompt: prompt,
            negativePrompt: negativePrompt,
            config: config,
          });

        log('info', 'API response received', { durationMs: Date.now() - genStart, hasImages: !!response?.generatedImages });

        if (!response?.generatedImages) {
            throw new Error('API did not return any generated images.');
        }

        const imagesBase64 = response.generatedImages.map((img: any) => img?.image?.imageBytes).filter(Boolean);

        // Record successful usage for rate limiting
        const imageCount = imagesBase64.length || 1;
        recordUsage(modelId, modelInfo.price_per_image * imageCount);

        log('info', 'Image generation completed', { imageCount, cost: modelInfo.price_per_image * imageCount, totalDurationMs: Date.now() - startTime });

        sendResponse(request.id, {
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
        });
        break;

      case 'imagen_apply_branding':
        const { imageBase64, brandingType, logoPosition, logoOpacity, customHandles } = args;

        log('info', 'Applying branding', { brandingType, logoPosition, hasImage: !!imageBase64 });

        if (!imageBase64) {
          throw new Error('imageBase64 is required');
        }
        if (!brandingType || !['logo-watermark', 'text-footer', 'logo-and-text', 'none'].includes(brandingType)) {
          throw new Error("Invalid brandingType. Must be one of: 'logo-watermark', 'text-footer', 'logo-and-text', 'none'");
        }

        const brandStart = Date.now();
        const brandedImage = await applyBranding(imageBase64, brandingType, {
          logoPosition: logoPosition || 'bottom-right',
          logoOpacity: logoOpacity || 0.85,
          customHandles: customHandles,
        });

        log('info', 'Branding applied', { brandingType, durationMs: Date.now() - brandStart });

        sendResponse(request.id, {
          content: [{ type: 'text', text: JSON.stringify({
            message: `Branding applied successfully: ${brandingType}`,
            branding_type: brandingType,
            logo_position: logoPosition || 'bottom-right',
            image_base64: brandedImage,
          })}]
        });
        break;

      default:
        throw new Error(`Tool '${name}' not found.`);
    }

    log('debug', `Tool completed: ${name}`, { durationMs: Date.now() - startTime });
  } catch (error: any) {
    log('error', `Tool failed: ${name}`, { error: error.message, durationMs: Date.now() - startTime });
    sendError(request.id, `Tool call failed: ${error.message}`);
  }
}

// --- Main Server Logic ---

log('info', 'Imagen MCP Server starting', { rateLimits: RATE_LIMITS });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  try {
    const request: JsonRpcRequest = JSON.parse(line);

    if ('result' in request || 'error' in request) return;

    log('debug', `Received request: ${request.method}`, { id: request.id });

    switch (request.method) {
      case 'initialize':
        log('info', 'MCP Initialize called');
        sendResponse(request.id, { capabilities: {} });
        break;

      case 'tools/list':
        log('debug', 'Returning tools list');
        sendResponse(request.id, { tools: TOOLS });
        break;
        
      case 'tools/call':
        await handleToolCall(request);
        break;
        
      default:
        sendError(request.id, `Unknown method: ${request.method}`);
    }
  } catch (error: any) {
    console.error(`Fatal Error: Failed to process request line: ${line}. Error: ${error.message}`);
  }
});