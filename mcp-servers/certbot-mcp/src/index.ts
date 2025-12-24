/**
 * Certbot MCP Server
 *
 * Manages SSL certificates via Let's Encrypt/Certbot.
 * Provides tools for certificate creation, renewal, and status.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// ============================================
// CONFIGURATION
// ============================================

const LETSENCRYPT_LIVE = process.env.LETSENCRYPT_LIVE || '/etc/letsencrypt/live';
const CERTBOT_EMAIL = process.env.CERTBOT_EMAIL || 'admin@shibaclassic.io';
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || 'shibaclassic.io').split(',');
const USE_STAGING = process.env.CERTBOT_STAGING === 'true';

// ============================================
// LOGGING
// ============================================

function log(level: 'info' | 'error' | 'debug', message: string, data?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: 'certbot-mcp',
    msg: message,
    ...data,
  };
  console.error(JSON.stringify(entry));
}

// ============================================
// SECURITY
// ============================================

function validateDomain(domain: string): void {
  const isAllowed = ALLOWED_DOMAINS.some(allowed =>
    domain === allowed || domain.endsWith(`.${allowed}`)
  );
  if (!isAllowed) {
    throw new Error(`Domain not allowed: ${domain}. Allowed: ${ALLOWED_DOMAINS.join(', ')}`);
  }
}

// ============================================
// CERTBOT OPERATIONS
// ============================================

interface CertificateInfo {
  domain: string;
  expires: Date | null;
  daysRemaining: number | null;
  issuer: string | null;
  path: string;
}

function listCertificates(): CertificateInfo[] {
  if (!existsSync(LETSENCRYPT_LIVE)) {
    return [];
  }

  const domains = readdirSync(LETSENCRYPT_LIVE).filter(d => !d.startsWith('.') && d !== 'README');
  const certs: CertificateInfo[] = [];

  for (const domain of domains) {
    const certPath = join(LETSENCRYPT_LIVE, domain, 'cert.pem');
    if (existsSync(certPath)) {
      try {
        const output = execSync(`openssl x509 -in "${certPath}" -noout -enddate -issuer 2>/dev/null`, {
          encoding: 'utf-8',
        });

        const expiresMatch = output.match(/notAfter=(.+)/);
        const issuerMatch = output.match(/issuer=(.+)/);

        const expires = expiresMatch ? new Date(expiresMatch[1]) : null;
        const daysRemaining = expires
          ? Math.floor((expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : null;

        certs.push({
          domain,
          expires,
          daysRemaining,
          issuer: issuerMatch ? issuerMatch[1].trim() : null,
          path: join(LETSENCRYPT_LIVE, domain),
        });
      } catch {
        certs.push({
          domain,
          expires: null,
          daysRemaining: null,
          issuer: null,
          path: join(LETSENCRYPT_LIVE, domain),
        });
      }
    }
  }

  return certs;
}

function getCertificateStatus(domain: string): CertificateInfo | null {
  const certs = listCertificates();
  return certs.find(c => c.domain === domain) || null;
}

function createCertificate(options: {
  domain: string;
  email?: string;
  webroot?: string;
  standalone?: boolean;
  dryRun?: boolean;
}): { success: boolean; output: string } {
  const { domain, email, webroot, standalone, dryRun } = options;

  validateDomain(domain);

  let cmd = 'certbot certonly';

  if (standalone) {
    cmd += ' --standalone';
  } else if (webroot) {
    cmd += ` --webroot -w "${webroot}"`;
  } else {
    cmd += ' --nginx';
  }

  cmd += ` -d "${domain}"`;
  cmd += ` --email "${email || CERTBOT_EMAIL}"`;
  cmd += ' --agree-tos --non-interactive';

  if (USE_STAGING) {
    cmd += ' --staging';
  }

  if (dryRun) {
    cmd += ' --dry-run';
  }

  try {
    const output = execSync(`${cmd} 2>&1`, { encoding: 'utf-8' });
    log('info', 'Certificate created', { domain, dryRun });
    return { success: true, output };
  } catch (error) {
    const output = error instanceof Error ? (error as Error & { stdout?: string }).stdout || error.message : 'Unknown error';
    log('error', 'Certificate creation failed', { domain, error: output });
    return { success: false, output };
  }
}

function renewCertificates(options: {
  domain?: string;
  dryRun?: boolean;
  force?: boolean;
}): { success: boolean; output: string } {
  const { domain, dryRun, force } = options;

  let cmd = 'certbot renew';

  if (domain) {
    cmd += ` --cert-name "${domain}"`;
  }

  if (dryRun) {
    cmd += ' --dry-run';
  }

  if (force) {
    cmd += ' --force-renewal';
  }

  cmd += ' --non-interactive';

  try {
    const output = execSync(`${cmd} 2>&1`, { encoding: 'utf-8' });
    log('info', 'Certificates renewed', { domain: domain || 'all', dryRun });
    return { success: true, output };
  } catch (error) {
    const output = error instanceof Error ? (error as Error & { stdout?: string }).stdout || error.message : 'Unknown error';
    return { success: false, output };
  }
}

function deleteCertificate(domain: string): { success: boolean; output: string } {
  validateDomain(domain);

  try {
    const output = execSync(`certbot delete --cert-name "${domain}" --non-interactive 2>&1`, {
      encoding: 'utf-8',
    });
    log('info', 'Certificate deleted', { domain });
    return { success: true, output };
  } catch (error) {
    const output = error instanceof Error ? (error as Error & { stdout?: string }).stdout || error.message : 'Unknown error';
    return { success: false, output };
  }
}

// ============================================
// TOOL DEFINITIONS
// ============================================

const tools = [
  {
    name: 'certbot_list',
    description: 'List all SSL certificates managed by Certbot',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'certbot_status',
    description: 'Get status of a specific certificate',
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Domain name' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'certbot_create',
    description: 'Create a new SSL certificate for a domain',
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Domain name' },
        email: { type: 'string', description: 'Admin email (optional)' },
        webroot: { type: 'string', description: 'Webroot path for HTTP-01 challenge' },
        standalone: { type: 'boolean', description: 'Use standalone mode (requires port 80)' },
        dry_run: { type: 'boolean', description: 'Test without creating certificate' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'certbot_renew',
    description: 'Renew SSL certificates',
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Specific domain to renew (optional, all if not specified)' },
        dry_run: { type: 'boolean', description: 'Test renewal without changes' },
        force: { type: 'boolean', description: 'Force renewal even if not due' },
      },
      required: [],
    },
  },
  {
    name: 'certbot_delete',
    description: 'Delete a certificate',
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Domain name' },
      },
      required: ['domain'],
    },
  },
];

// ============================================
// TOOL HANDLERS
// ============================================

async function handleToolCall(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'certbot_list': {
      const certs = listCertificates();
      return {
        success: true,
        certificates: certs.map(c => ({
          ...c,
          expires: c.expires?.toISOString() || null,
        })),
        count: certs.length,
      };
    }

    case 'certbot_status': {
      const schema = z.object({ domain: z.string() });
      const { domain } = schema.parse(args);
      const cert = getCertificateStatus(domain);

      if (!cert) {
        return { success: false, error: `No certificate found for: ${domain}` };
      }

      return {
        success: true,
        domain: cert.domain,
        expires: cert.expires?.toISOString() || null,
        daysRemaining: cert.daysRemaining,
        issuer: cert.issuer,
        path: cert.path,
        needsRenewal: cert.daysRemaining !== null && cert.daysRemaining < 30,
      };
    }

    case 'certbot_create': {
      const schema = z.object({
        domain: z.string(),
        email: z.string().optional(),
        webroot: z.string().optional(),
        standalone: z.boolean().optional(),
        dry_run: z.boolean().default(false),
      });
      const params = schema.parse(args);

      const result = createCertificate({
        domain: params.domain,
        email: params.email,
        webroot: params.webroot,
        standalone: params.standalone,
        dryRun: params.dry_run,
      });

      return {
        ...result,
        domain: params.domain,
        dryRun: params.dry_run,
      };
    }

    case 'certbot_renew': {
      const schema = z.object({
        domain: z.string().optional(),
        dry_run: z.boolean().default(false),
        force: z.boolean().default(false),
      });
      const params = schema.parse(args);

      const result = renewCertificates({
        domain: params.domain,
        dryRun: params.dry_run,
        force: params.force,
      });

      return {
        ...result,
        domain: params.domain || 'all',
        dryRun: params.dry_run,
      };
    }

    case 'certbot_delete': {
      const schema = z.object({ domain: z.string() });
      const { domain } = schema.parse(args);
      const result = deleteCertificate(domain);
      return { ...result, domain };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ============================================
// SERVER SETUP
// ============================================

const server = new Server(
  { name: 'certbot-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  log('info', 'Tool called', { tool: name });

  try {
    const result = await handleToolCall(name, args as Record<string, unknown>);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log('error', 'Tool error', { tool: name, error: message });
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }, null, 2) }],
      isError: true,
    };
  }
});

// ============================================
// MAIN
// ============================================

async function main() {
  log('info', 'Certbot MCP Server starting', {
    letsencryptLive: LETSENCRYPT_LIVE,
    email: CERTBOT_EMAIL,
    staging: USE_STAGING,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('info', 'Certbot MCP Server running');
}

main().catch((error) => {
  log('error', 'Fatal error', { error: error.message });
  process.exit(1);
});
