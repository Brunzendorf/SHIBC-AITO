/**
 * Base Adapter Classes
 *
 * Abstrakte Basisklassen für MCP Adapter.
 * Neue Adapter sollten von diesen Klassen erben.
 */

import type {
  IAdapter,
  IApiAdapter,
  ApiResponse,
  MCPTool,
  MCPToolResult,
} from './types.js';

// ============================================
// LOGGING
// ============================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void;
}

/**
 * Standard JSON Logger (stderr)
 */
export class JsonLogger implements Logger {
  constructor(private component: string) {}

  log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      component: this.component,
      msg: message,
      ...data,
    };
    console.error(JSON.stringify(entry));
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }
}

// ============================================
// BASE ADAPTER
// ============================================

/**
 * Abstrakte Basisklasse für alle Adapter
 */
export abstract class BaseAdapter implements IAdapter {
  protected logger: JsonLogger;
  protected initialized = false;

  constructor(
    public readonly name: string,
    protected config: Record<string, string>
  ) {
    this.logger = new JsonLogger(name);
  }

  abstract initialize(): Promise<void>;

  async dispose(): Promise<void> {
    this.initialized = false;
    this.logger.info('Adapter disposed');
  }

  async isHealthy(): Promise<boolean> {
    return this.initialized;
  }

  /**
   * Config-Wert mit Fallback
   */
  protected getConfig(key: string, defaultValue?: string): string {
    const value = this.config[key];
    if (value === undefined && defaultValue === undefined) {
      throw new Error(`Missing required config: ${key}`);
    }
    return value ?? defaultValue!;
  }

  /**
   * Env Variable oder Config
   */
  protected getEnvOrConfig(envKey: string, configKey?: string, defaultValue?: string): string {
    return process.env[envKey] ?? this.config[configKey ?? envKey] ?? defaultValue ?? '';
  }
}

// ============================================
// BASE API ADAPTER
// ============================================

/**
 * Abstrakte Basisklasse für API-basierte Adapter
 */
export abstract class BaseApiAdapter extends BaseAdapter implements IApiAdapter {
  public readonly baseUrl: string;
  protected headers: Record<string, string> = {};

  constructor(
    name: string,
    config: Record<string, string>,
    baseUrlKey: string
  ) {
    super(name, config);
    this.baseUrl = this.getConfig(baseUrlKey).replace(/\/$/, '');
  }

  async initialize(): Promise<void> {
    this.setupAuth();
    this.initialized = true;
    this.logger.info('API Adapter initialized', { baseUrl: this.baseUrl });
  }

  /**
   * Auth-Header setzen (überschreiben in Subklasse)
   */
  protected abstract setupAuth(): void;

  /**
   * API Request ausführen
   */
  async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const startTime = Date.now();

    try {
      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
      };

      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      const status = response.status;
      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn('API request failed', { method, path, status, durationMs });
        return { error: errorText || `HTTP ${status}`, status };
      }

      const text = await response.text();
      if (!text) {
        return { data: {} as T, status };
      }

      try {
        const data = JSON.parse(text) as T;
        this.logger.debug('API request success', { method, path, status, durationMs });
        return { data, status };
      } catch {
        return { data: text as unknown as T, status };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('API request error', { method, path, error: errorMessage });
      return { error: errorMessage, status: 0 };
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.initialized) return false;

    try {
      const result = await this.request('GET', this.getHealthEndpoint());
      return result.status >= 200 && result.status < 300;
    } catch {
      return false;
    }
  }

  /**
   * Health-Endpoint (überschreiben in Subklasse)
   */
  protected getHealthEndpoint(): string {
    return '/health';
  }
}

// ============================================
// MCP SERVER BUILDER
// ============================================

/**
 * Helper zum Erstellen von MCP Tool Definitionen
 */
export class ToolBuilder {
  private tools: MCPTool[] = [];

  /**
   * Tool hinzufügen
   */
  add(
    name: string,
    description: string,
    properties: Record<string, {
      type: 'string' | 'number' | 'boolean' | 'array' | 'object';
      description: string;
      enum?: string[];
      default?: unknown;
      required?: boolean;
    }>
  ): this {
    const required: string[] = [];
    const props: MCPTool['inputSchema']['properties'] = {};

    for (const [key, prop] of Object.entries(properties)) {
      if (prop.required) {
        required.push(key);
      }
      props[key] = {
        type: prop.type,
        description: prop.description,
        enum: prop.enum,
        default: prop.default,
      };
    }

    this.tools.push({
      name,
      description,
      inputSchema: {
        type: 'object',
        properties: props,
        required: required.length > 0 ? required : undefined,
      },
    });

    return this;
  }

  /**
   * Tools abrufen
   */
  build(): MCPTool[] {
    return this.tools;
  }
}

// ============================================
// RESULT HELPERS
// ============================================

/**
 * Erfolg-Result erstellen
 */
export function successResult(data: unknown): MCPToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: true, ...data as object }, null, 2),
    }],
  };
}

/**
 * Error-Result erstellen
 */
export function errorResult(message: string): MCPToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: false, error: message }, null, 2),
    }],
    isError: true,
  };
}

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Path Validator
 */
export class PathValidator {
  constructor(private allowedPaths: string[]) {}

  validate(path: string): void {
    const normalized = path.replace(/\\/g, '/');
    const isAllowed = this.allowedPaths.some(allowed =>
      normalized.startsWith(allowed.replace(/\\/g, '/'))
    );

    if (!isAllowed) {
      throw new Error(
        `Security: Path not allowed: ${path}. Allowed: ${this.allowedPaths.join(', ')}`
      );
    }
  }

  isAllowed(path: string): boolean {
    try {
      this.validate(path);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Command Validator
 */
export class CommandValidator {
  constructor(
    private allowedCommands: string[],
    private forbiddenPatterns: string[]
  ) {}

  validate(command: string): void {
    const lowerCommand = command.toLowerCase().trim();
    const firstWord = lowerCommand.split(/\s+/)[0];

    // Check allowed
    const isAllowed = this.allowedCommands.some(allowed =>
      firstWord === allowed.toLowerCase() ||
      firstWord.endsWith('/' + allowed.toLowerCase())
    );

    if (!isAllowed) {
      throw new Error(
        `Security: Command not allowed: ${firstWord}. Allowed: ${this.allowedCommands.join(', ')}`
      );
    }

    // Check forbidden patterns
    const hasForbidden = this.forbiddenPatterns.some(pattern =>
      lowerCommand.includes(pattern.toLowerCase())
    );

    if (hasForbidden) {
      throw new Error(
        `Security: Command contains forbidden pattern. Blocked: ${this.forbiddenPatterns.join(', ')}`
      );
    }
  }
}
