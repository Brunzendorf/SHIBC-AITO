/**
 * Post C-Level Portraits to Telegram
 *
 * Sends headshots with profile descriptions for each C-Level executive
 */

import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';

// Load environment variables from .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=');
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = '-1002876952840';
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

const WORKSPACE_PATH = path.join(__dirname, '..', 'workspace', 'assets', 'team');

interface TeamMember {
  id: string;
  name: string;
  role: string;
  title: string;
  bio: string;
  personality: string;
}

async function sendPhotoFromFile(
  filePath: string,
  caption: string
): Promise<boolean> {
  const url = `${API_BASE}/sendPhoto`;

  try {
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return false;
    }

    const imageBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
    };
    const contentType = contentTypes[ext] || 'image/jpeg';

    const form = new FormData();
    form.append('chat_id', CHANNEL_ID);
    form.append('photo', imageBuffer, { filename, contentType });
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');

    const response = await fetch(url, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    const data = await response.json() as { ok: boolean; description?: string };

    if (!data.ok) {
      console.error(`Telegram error: ${data.description}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error sending photo: ${error}`);
    return false;
  }
}

async function sendMessage(text: string): Promise<boolean> {
  const url = `${API_BASE}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        text,
        parse_mode: 'HTML',
      }),
    });

    const data = await response.json() as { ok: boolean; description?: string };

    if (!data.ok) {
      console.error(`Telegram error: ${data.description}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error sending message: ${error}`);
    return false;
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  if (!BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not set');
    process.exit(1);
  }

  console.log('🚀 Posting C-Level Portraits to Telegram...\n');

  // Post introduction message
  const introMessage = `
🎯 <b>Meet the SHIBC AI Leadership Team</b>

Introducing our C-Level executives - each brings unique expertise to drive $SHIBC forward into 2025!

#SHIBC #AITeam #Leadership #MeetTheTeam
`.trim();

  console.log('📣 Sending introduction message...');
  await sendMessage(introMessage);
  await delay(2000);

  // Get all team folders
  const teamFolders = fs.readdirSync(WORKSPACE_PATH).filter(f => {
    const fullPath = path.join(WORKSPACE_PATH, f);
    return fs.statSync(fullPath).isDirectory();
  });

  // Order: CEO first, then others
  const orderedFolders = [
    'ceo_marcus',
    'cmo_yuki',
    'cto_viktor',
    'cfo_sarah',
    'coo_james',
    'cco_elena',
  ].filter(f => teamFolders.includes(f));

  console.log(`📸 Found ${orderedFolders.length} team members\n`);

  for (const folder of orderedFolders) {
    const folderPath = path.join(WORKSPACE_PATH, folder);
    const metaPath = path.join(folderPath, `${folder}_meta.json`);
    const headshotPath = path.join(folderPath, `${folder}_1_headshot.jpg`);

    if (!fs.existsSync(metaPath) || !fs.existsSync(headshotPath)) {
      console.log(`⚠️ Skipping ${folder} - missing files`);
      continue;
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as TeamMember;

    const caption = `
🎯 <b>Meet Our ${meta.role}</b>

<b>${meta.name}</b> | ${meta.title}

${meta.bio.replace(/\n/g, '\n')}

🔸 ${meta.personality}

#SHIBC #AITeam #Leadership #${meta.role}
`.trim();

    console.log(`📤 Posting ${meta.name} (${meta.role})...`);
    const success = await sendPhotoFromFile(headshotPath, caption);

    if (success) {
      console.log(`   ✅ Posted successfully`);
    } else {
      console.log(`   ❌ Failed to post`);
    }

    // Rate limiting - wait between posts
    await delay(3000);
  }

  console.log('\n🎉 Done posting C-Level portraits to Telegram!');
}

main().catch(console.error);
