#!/usr/bin/env npx tsx
/**
 * C-Level Portrait Generator
 * Generates consistent character portraits for SHIBC AI Team
 *
 * Usage: npx tsx scripts/generate-clevel-portraits.ts [characterId]
 * Example: npx tsx scripts/generate-clevel-portraits.ts cmo_yuki
 */

import { GoogleGenAI, Modality } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

// Load .env manually
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

// --- Configuration ---
const OUTPUT_DIR = './workspace/assets/team';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY not set in environment');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// --- Character Definitions ---
interface Character {
  id: string;
  name: string;
  role: string;
  title: string;
  gender: 'male' | 'female';
  ethnicity: string;
  age: string;
  appearance: string;
  style: string;
  personality: string;
  bio: string;
}

const CHARACTERS: Record<string, Character> = {
  cmo_yuki: {
    id: 'cmo_yuki',
    name: 'Yuki Tanaka',
    role: 'CMO',
    title: 'Chief Marketing Officer',
    gender: 'female',
    ethnicity: 'Japanese',
    age: '32',
    appearance: `Japanese woman, 32 years old, strikingly beautiful with model-like elegance.
Long straight black hair with subtle shine, usually styled professionally.
Warm brown almond-shaped eyes with confident gaze.
High cheekbones, delicate features, flawless skin.
Tall and slender with graceful posture.
Subtle makeup enhancing natural beauty.`,
    style: 'Elegant, sophisticated, fashion-forward. Designer blazers, silk blouses, subtle luxury accessories.',
    personality: 'Confident, creative, charismatic. Natural leader with strong vision.',
    bio: `Tokyo → Stanford MBA → Head of Marketing at Binance Japan → SHIBC CMO.
Building bridges between traditional finance and DeFi.
Fluent in 4 languages. Fashion icon in crypto circles.`,
  },

  cto_viktor: {
    id: 'cto_viktor',
    name: 'Viktor "Vik" Kowalski',
    role: 'CTO',
    title: 'Chief Technology Officer',
    gender: 'male',
    ethnicity: 'Eastern European (Polish)',
    age: '38',
    appearance: `Eastern European man, 38 years old, with creative/eccentric energy.
Messy dark brown hair, slightly unruly but intentional.
Intense blue-grey eyes behind stylish rectangular glasses.
Short stubble beard, angular face.
Athletic build, often seen with headphones around neck.
Expressive hands, always gesturing when explaining.`,
    style: 'Smart casual with quirky touches. Band t-shirts under blazers, colorful socks, Converse sneakers.',
    personality: 'Brilliant, unconventional, passionate about technology. Night owl, energy drink enthusiast.',
    bio: `Warsaw → MIT → Google Brain → Ethereum core contributor → SHIBC CTO.
Published 12 papers on distributed systems. Open source legend.
Believes sleep is optional, coffee is not.`,
  },

  ceo_marcus: {
    id: 'ceo_marcus',
    name: 'Marcus Chen',
    role: 'CEO',
    title: 'Chief Executive Officer',
    gender: 'male',
    ethnicity: 'Mixed Asian-European',
    age: '47',
    appearance: `Mixed heritage man (Chinese-German), 47 years old, distinguished and commanding.
Salt-and-pepper hair, neatly styled back.
Deep brown eyes with wisdom and warmth.
Strong jawline, gentle smile lines.
Tall, athletic build maintained through discipline.
Always impeccably groomed.`,
    style: 'Classic executive elegance. Tailored suits, subtle cufflinks, quality watches.',
    personality: 'Visionary, calm under pressure, paternal figure. Natural mediator.',
    bio: `Hong Kong → Harvard Business School → McKinsey Partner → Goldman Sachs MD → SHIBC CEO.
20+ years in finance and tech. Board member of 3 Fortune 500 companies.
Father of two, marathon runner, chess grandmaster.`,
  },

  cfo_sarah: {
    id: 'cfo_sarah',
    name: 'Dr. Sarah Goldstein',
    role: 'CFO',
    title: 'Chief Financial Officer',
    gender: 'female',
    ethnicity: 'European (German-Jewish)',
    age: '44',
    appearance: `European woman, 44 years old, sharp and analytical presence.
Auburn hair in professional bob cut.
Piercing green eyes behind elegant rimless glasses.
Fair complexion, minimal makeup.
Medium height, poised posture.
Often seen with tablet or financial reports.`,
    style: 'Conservative professional. Structured blazers, pencil skirts, quality leather accessories.',
    personality: 'Precise, detail-oriented, quietly confident. The voice of financial reason.',
    bio: `Frankfurt → PhD Economics LSE → Deutsche Bank → Deloitte Partner → SHIBC CFO.
CPA, CFA, published author on crypto economics.
Known for turning complex numbers into clear decisions.`,
  },

  coo_james: {
    id: 'coo_james',
    name: 'James Wilson',
    role: 'COO',
    title: 'Chief Operating Officer',
    gender: 'male',
    ethnicity: 'African-American',
    age: '49',
    appearance: `African-American man, 49 years old, calm and commanding presence.
Clean-shaven head, distinguished look.
Warm brown eyes that put people at ease.
Broad shoulders, athletic build.
Deep voice, reassuring smile.
Often seen with coffee mug.`,
    style: 'Professional but approachable. Navy suits, open collar shirts, quality loafers.',
    personality: 'Organized, dependable, people-focused. The operational backbone.',
    bio: `Chicago → West Point → US Army Logistics Officer → Amazon Operations VP → SHIBC COO.
Expert in scaling operations. Mentor to hundreds.
Believes in systems, processes, and people.`,
  },

  cco_elena: {
    id: 'cco_elena',
    name: 'Elena Vasquez',
    role: 'CCO',
    title: 'Chief Compliance Officer',
    gender: 'female',
    ethnicity: 'Hispanic (Spanish-Mexican)',
    age: '42',
    appearance: `Hispanic woman, 42 years old, sharp and authoritative.
Dark wavy hair usually in professional updo.
Dark brown eyes with intense focus.
Olive skin, defined features.
Medium height, confident stance.
Often carries legal documents or tablet.`,
    style: 'Power professional. Structured suits, statement jewelry, designer heels.',
    personality: 'Detail-obsessed, protective, fair but firm. Guardian of compliance.',
    bio: `Mexico City → Columbia Law → SEC Enforcement → Coinbase Legal → SHIBC CCO.
Bar admitted in 3 countries. Expert witness on crypto regulation.
The shield that protects the company.`,
  },
};

// --- Scene Definitions ---
const SCENES = [
  {
    id: 'headshot',
    name: 'Professional Headshot',
    prompt: 'Professional corporate headshot photo, direct eye contact with camera, confident subtle smile, clean gradient background, soft studio lighting, shoulders and face visible, magazine cover quality',
    outfit: 'formal business attire',
  },
  {
    id: 'at_work',
    name: 'At Work',
    prompt: 'Working at modern minimalist desk with MacBook Pro, focused expression, natural office lighting from large window, contemporary office background with plants, candid professional shot',
    outfit: 'business casual',
  },
  {
    id: 'presentation',
    name: 'Giving Presentation',
    prompt: 'Standing in front of large screen/whiteboard giving presentation, explaining with hand gesture, confident engaged expression, modern conference room, audience slightly blurred in background',
    outfit: 'formal business attire',
  },
  {
    id: 'team_meeting',
    name: 'Team Meeting',
    prompt: 'In casual team meeting setting, sitting at round table, friendly approachable expression, engaged in conversation, modern startup office environment, warm lighting',
    outfit: 'smart casual',
  },
  {
    id: 'casual',
    name: 'Casual Friday',
    prompt: 'Relaxed professional setting, holding coffee cup, genuine warm smile, standing near window with city view, natural daylight, lifestyle professional shot',
    outfit: 'casual but professional with subtle orange/gold accent (Shiba Classic brand color)',
  },
];

// --- Helper Functions ---

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function saveImage(base64: string, filepath: string) {
  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(filepath, buffer);
  console.log(`  💾 Saved: ${filepath}`);
}

function buildCharacterPrompt(char: Character, scene: typeof SCENES[0]): string {
  return `Professional corporate portrait photograph.

SUBJECT: ${char.name}, ${char.age} years old, ${char.ethnicity} ${char.gender}.
ROLE: ${char.title} at Shiba Classic ($SHIBC)

PHYSICAL APPEARANCE:
${char.appearance}

SCENE: ${scene.prompt}
OUTFIT: ${scene.outfit}, ${char.style}

STYLE REQUIREMENTS:
- Photorealistic, 8K quality
- Professional corporate photography
- Soft flattering lighting
- Sharp focus on face
- Subtle orange/gold accent somewhere (Shiba Classic brand color #fda92d)
- Magazine editorial quality

Generate a single photorealistic portrait.`;
}

async function generateHeroImage(char: Character): Promise<string | null> {
  console.log(`\n🎨 Generating hero image for ${char.name}...`);

  const prompt = buildCharacterPrompt(char, SCENES[0]); // Use headshot scene for hero

  try {
    // Try Imagen 4.0 first
    console.log('  📡 Calling Imagen 4.0...');
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: '1:1',
        personGeneration: 'ALLOW_ADULT' as any,
      },
    });

    console.log(`  📊 Response: ${response?.generatedImages?.length || 0} images`);

    if (response?.generatedImages?.[0]?.image?.imageBytes) {
      return response.generatedImages[0].image.imageBytes;
    }

    console.log('  ⚠️ No image from Imagen 4.0, trying Gemini 2.0 Flash...');

    // Fallback to Gemini 2.0 Flash
    const geminiResponse = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      } as any,
    });

    if (geminiResponse.candidates?.[0]?.content?.parts) {
      for (const part of geminiResponse.candidates[0].content.parts) {
        if ((part as any).inlineData?.data) {
          return (part as any).inlineData.data;
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`  ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    return null;
  }
}

async function generateSceneWithReference(
  char: Character,
  scene: typeof SCENES[0],
  referenceImageBase64: string
): Promise<string | null> {
  console.log(`  🎬 Scene: ${scene.name}...`);

  const prompt = `You are an expert portrait photographer. Generate a new professional photograph of the EXACT SAME PERSON shown in the reference image.

CHARACTER: ${char.name}, ${char.title}
The person MUST have IDENTICAL facial features to the reference - same face, eyes, hair, skin tone.

NEW SCENE: ${scene.prompt}
OUTFIT: ${scene.outfit}
STYLE: ${char.style}

Generate a photorealistic image maintaining perfect character consistency.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: referenceImageBase64 } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      } as any,
    });

    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if ((part as any).inlineData?.data) {
          return (part as any).inlineData.data;
        }
      }
    }

    // Fallback to Imagen with detailed description
    console.log(`    ⚠️ Gemini didn't return image, using Imagen fallback...`);
    const fallbackPrompt = buildCharacterPrompt(char, scene);

    const imagenResponse = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: fallbackPrompt,
      config: {
        numberOfImages: 1,
        aspectRatio: '1:1',
        personGeneration: 'ALLOW_ADULT' as any,
      },
    });

    if (imagenResponse?.generatedImages?.[0]?.image?.imageBytes) {
      return imagenResponse.generatedImages[0].image.imageBytes;
    }

    return null;
  } catch (error) {
    console.error(`    ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    return null;
  }
}

async function generateCharacterPortraits(charId: string) {
  const char = CHARACTERS[charId];
  if (!char) {
    console.error(`❌ Character "${charId}" not found`);
    console.log('Available characters:', Object.keys(CHARACTERS).join(', '));
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎭 Generating portraits for: ${char.name} (${char.role})`);
  console.log(`${'='.repeat(60)}`);

  const charDir = path.join(OUTPUT_DIR, char.id);
  ensureDir(charDir);

  // Step 1: Generate hero image (DNA)
  const heroImage = await generateHeroImage(char);
  if (!heroImage) {
    console.error('❌ Failed to generate hero image');
    return;
  }

  const heroPath = path.join(charDir, `${char.id}_1_headshot.jpg`);
  saveImage(heroImage, heroPath);

  // Save character metadata
  const metaPath = path.join(charDir, `${char.id}_meta.json`);
  fs.writeFileSync(metaPath, JSON.stringify({
    ...char,
    generatedAt: new Date().toISOString(),
    scenes: SCENES.map(s => s.id),
  }, null, 2));
  console.log(`  📋 Saved metadata: ${metaPath}`);

  // Step 2: Generate remaining scenes with reference
  console.log(`\n📸 Generating scene variations with character consistency...`);

  for (let i = 1; i < SCENES.length; i++) {
    const scene = SCENES[i];

    // Add delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));

    const sceneImage = await generateSceneWithReference(char, scene, heroImage);
    if (sceneImage) {
      const scenePath = path.join(charDir, `${char.id}_${i + 1}_${scene.id}.jpg`);
      saveImage(sceneImage, scenePath);
    } else {
      console.log(`    ⚠️ Skipped ${scene.name}`);
    }
  }

  // Generate Telegram post
  const telegramPost = `
🎯 **Meet Our ${char.role}**

**${char.name}** | ${char.title}

${char.bio}

🔸 ${char.personality}

#SHIBC #AITeam #Leadership #${char.role}
`;

  const postPath = path.join(charDir, `${char.id}_telegram.txt`);
  fs.writeFileSync(postPath, telegramPost.trim());
  console.log(`  📱 Saved Telegram post: ${postPath}`);

  console.log(`\n✅ ${char.name} portraits complete!`);
  console.log(`   📁 Output: ${charDir}`);
}

// --- Main ---
async function main() {
  const charId = process.argv[2];

  if (!charId) {
    console.log('Available characters:');
    for (const [id, char] of Object.entries(CHARACTERS)) {
      console.log(`  ${id.padEnd(15)} - ${char.name} (${char.role})`);
    }
    console.log('\nUsage: npx tsx scripts/generate-clevel-portraits.ts <character_id>');
    console.log('Example: npx tsx scripts/generate-clevel-portraits.ts cmo_yuki');
    console.log('\nOr generate all: npx tsx scripts/generate-clevel-portraits.ts all');
    return;
  }

  ensureDir(OUTPUT_DIR);

  if (charId === 'all') {
    for (const id of Object.keys(CHARACTERS)) {
      await generateCharacterPortraits(id);
      await new Promise(r => setTimeout(r, 5000)); // Delay between characters
    }
  } else {
    await generateCharacterPortraits(charId);
  }

  console.log('\n🎉 Done!');
}

main().catch(console.error);
