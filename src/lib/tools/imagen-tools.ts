// Import necessary modules
import * as fs from 'fs/promises';
import * as path from 'path';

// Define types for Imagen API responses
export interface ImagenModelInfo {
  model_id: string;
  name: string;
  feature: string;
  input: string;
  output: string;
  price_per_image: number;
  technical_id: string; // Internal, not necessarily exposed to LLM directly
}

export interface ImagenPromptGuide {
  general_tips: string[];
  model_specific_tips: { [key: string]: string };
}

export interface GenerateImageResponse {
  message: string;
  model_used: string;
  images_base64: string[];
}

/**
 * Retrieves the base URL for the Imagen MCP server from the project's mcp.json configuration.
 * @returns {Promise<string>} The base URL of the Imagen MCP server.
 * @throws {Error} If the Imagen base URL cannot be found in mcp.json.
 */
async function getImagenBaseUrl(): Promise<string> {
  // Assuming process.cwd() is the project root
  const mcpConfigPath = path.join(process.cwd(), 'config', 'mcp.json');
  try {
    const mcpConfigFile = await fs.readFile(mcpConfigPath, 'utf-8');
    const mcpConfig = JSON.parse(mcpConfigFile);

    const baseUrl = mcpConfig.imagen?.url;
    if (!baseUrl) {
      throw new Error("Could not find 'imagen' service base URL in config/mcp.json");
    }
    return baseUrl;
  } catch (error) {
    console.error(`Error reading mcp.json or parsing: ${error}`);
    throw new Error(`Failed to get Imagen base URL: ${error}`);
  }
}


/**
 * Discovers and lists all available Google Imagen models, their capabilities, and pricing.
 * This tool allows an agent to understand which image generation options are available
 * and to make informed decisions about which model to use.
 *
 * @returns {Promise<ImagenModelInfo[]>} A list of available Imagen models.
 * @example
 * // Agent decides to list models to understand options
 * const models = await listImagenModels();
 * console.log(models[0].name); // "Imagen 4 Ultra"
 */
export async function listImagenModels(): Promise<ImagenModelInfo[]> {
  const baseUrl = await getImagenBaseUrl();
  const response = await fetch(`${baseUrl}/models`);
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch Imagen models from ${baseUrl}/models: ${response.status} ${errorBody}`);
  }
  return response.json() as Promise<ImagenModelInfo[]>;
}

/**
 * Provides general and model-specific tips for writing effective image generation prompts for Imagen.
 * This helps the agent to create higher quality and more relevant images by following best practices.
 *
 * @returns {Promise<ImagenPromptGuide>} An object containing general and model-specific prompting advice.
 * @example
 * // Agent asks for prompting guide to improve its prompt quality
 * const guide = await getImagenPromptGuide();
 * console.log(guide.general_tips[0]); // "Be specific and detailed..."
 */
export async function getImagenPromptGuide(): Promise<ImagenPromptGuide> {
  const baseUrl = await getImagenBaseUrl();
  const response = await fetch(`${baseUrl}/prompt-guide`);
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch Imagen prompt guide from ${baseUrl}/prompt-guide: ${response.status} ${errorBody}`);
  }
  return response.json() as Promise<ImagenPromptGuide>;
}

/**
 * Generates an image using a specified Google Imagen model based on a text prompt.
 * The agent must first use 'listImagenModels' to get a valid 'model_id'.
 *
 * @param {string} modelId The ID of the Imagen model to use (e.g., 'imagen-4-ultra', 'imagen-4-fast').
 *                         Obtain valid model IDs by calling 'listImagenModels'.
 * @param {string} prompt The text description for the image to be generated.
 * @param {string} [negativePrompt] Optional. A prompt describing what should NOT be in the image.
 *                                  Use this to guide the image generation away from undesired elements.
 * @param {number} [numberOfImages=1] Optional. The number of images to generate (default is 1).
 *                                    Defaults to 1 if not specified.
 * @returns {Promise<GenerateImageResponse>} An object containing the generated images as base64 encoded strings.
 *                                    The 'images_base64' array will contain one or more base64 encoded PNG images.
 * @example
 * // Agent decides to generate an image
 * const result = await generateImageWithImagen(
 *   'imagen-4-fast',
 *   'A futuristic city at sunset, cyberpunk style, neon lights',
 *   'ugly, deformed, blurry, low resolution',
 *   1
 * );
 * console.log(`Generated image (first 50 chars of base64): ${result.images_base64[0].substring(0, 50)}...`);
 */
export async function generateImageWithImagen(
  modelId: string,
  prompt: string,
  negativePrompt?: string,
  numberOfImages: number = 1
): Promise<GenerateImageResponse> {
  const baseUrl = await getImagenBaseUrl();
  const response = await fetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: modelId, prompt, negative_prompt: negativePrompt, number_of_images: numberOfImages }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to generate image with Imagen (${modelId}) from ${baseUrl}/generate: ${response.status} ${errorBody}`);
  }
  return response.json() as Promise<GenerateImageResponse>;
}

// Export a default object if the agent framework expects a single export
export default {
  listImagenModels,
  getImagenPromptGuide,
  generateImageWithImagen,
};
