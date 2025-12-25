import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

async function main() {
  console.log('API Key present:', !!process.env.GEMINI_API_KEY);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  // Try different model names for image generation
  const models = [
    'imagen-3.0-generate-001',
    'imagen-3.0-fast-generate-001',
    'imagen-4.0-generate-001',
    'models/imagen-3.0-generate-001',
    'models/imagen-3.0-fast-generate-001',
  ];

  console.log('\nTesting image generation models...\n');

  for (const model of models) {
    try {
      console.log(`Testing: ${model}`);
      const resp = await ai.models.generateImages({
        model,
        prompt: 'A simple red circle on white background',
        config: { numberOfImages: 1 },
      });
      console.log(`  ✅ ${model}: SUCCESS - got ${resp?.generatedImages?.length || 0} images`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.log(`  ❌ ${model}: ${msg.substring(0, 100)}`);
    }
  }
}

main().catch(console.error);
