// Use require for CommonJS compatibility
const { GoogleGenAI, PersonGeneration } = require('@google/genai');
import * as readline from 'readline';
import * as fs from 'fs';

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
  }
];

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

// --- Tool Implementation ---

async function handleToolCall(request: JsonRpcRequest) {
  const { name, arguments: args } = request.params;
  
  try {
    switch (name) {
      case 'imagen_list_models':
        sendResponse(request.id, { content: [{ type: 'text', text: JSON.stringify(MODEL_CATALOG, null, 2) }] });
        break;

      case 'imagen_get_prompt_guide':
        sendResponse(request.id, { content: [{ type: 'text', text: JSON.stringify(PROMPT_GUIDE, null, 2) }] });
        break;

      case 'imagen_check_quota':
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

        // Check rate limits FIRST
        const rateLimitCheck = checkRateLimit(modelId);
        if (!rateLimitCheck.allowed) {
          throw new Error(`Image generation blocked: ${rateLimitCheck.reason}`);
        }

        const modelInfo = MODEL_CATALOG.find(m => m.model_id === modelId);
        if (!modelInfo) {
          throw new Error(`Model with id '${modelId}' not found in catalog.`);
        }
        
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY environment variable is not set.");
        }

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


        const response = await ai.models.generateImages({
            model: modelInfo.technical_id,
            prompt: prompt,
            negativePrompt: negativePrompt,
            config: config,
          });
        
        if (!response?.generatedImages) {
            throw new Error('API did not return any generated images.');
        }

        const imagesBase64 = response.generatedImages.map((img: any) => img?.image?.imageBytes).filter(Boolean);

        // Record successful usage for rate limiting
        const imageCount = imagesBase64.length || 1;
        recordUsage(modelId, modelInfo.price_per_image * imageCount);

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

      default:
        throw new Error(`Tool '${name}' not found.`);
    }
  } catch (error: any) {
    sendError(request.id, `Tool call failed: ${error.message}`);
  }
}

// --- Main Server Logic ---

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  try {
    const request: JsonRpcRequest = JSON.parse(line);
    
    if ('result' in request || 'error' in request) return;

    switch (request.method) {
      case 'initialize':
        sendResponse(request.id, { capabilities: {} });
        break;
      
      case 'tools/list':
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