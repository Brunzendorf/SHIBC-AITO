/**
 * Shared MCP Server Types & Interfaces
 *
 * Diese Interfaces ermöglichen einfache Erweiterung durch neue Adapter.
 * Jeder neue MCP Server sollte diese Interfaces implementieren.
 */

// ============================================
// CORE MCP TYPES
// ============================================

/**
 * MCP Tool Definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, MCPPropertySchema>;
    required?: string[];
  };
}

export interface MCPPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: MCPPropertySchema;
  default?: unknown;
}

/**
 * MCP Tool Result
 */
export interface MCPToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * MCP Server Configuration
 */
export interface MCPServerConfig {
  name: string;
  version: string;
  description: string;
  env: Record<string, string>;
}

// ============================================
// ADAPTER INTERFACES
// ============================================

/**
 * Base Adapter Interface
 * Alle MCP Adapter müssen dieses Interface implementieren.
 */
export interface IAdapter {
  /** Adapter-Name für Logging */
  readonly name: string;

  /** Initialisierung (Verbindung aufbauen, etc.) */
  initialize(): Promise<void>;

  /** Cleanup (Verbindung schließen, etc.) */
  dispose(): Promise<void>;

  /** Health Check */
  isHealthy(): Promise<boolean>;
}

/**
 * API Adapter Interface
 * Für externe API-basierte Dienste (Portainer, Woodpecker, etc.)
 */
export interface IApiAdapter extends IAdapter {
  /** Base URL der API */
  readonly baseUrl: string;

  /** API Request ausführen */
  request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>>;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

// ============================================
// CI/CD ADAPTER INTERFACE
// ============================================

/**
 * CI/CD Adapter Interface
 * Implementiert von: Woodpecker, GitHub Actions, GitLab CI, Jenkins, etc.
 */
export interface ICICDAdapter extends IApiAdapter {
  /** Pipelines auflisten */
  listPipelines(repo: RepoIdentifier, options?: PaginationOptions): Promise<Pipeline[]>;

  /** Pipeline-Details abrufen */
  getPipeline(repo: RepoIdentifier, pipelineId: string | number): Promise<Pipeline>;

  /** Pipeline triggern */
  triggerPipeline(repo: RepoIdentifier, options?: TriggerOptions): Promise<Pipeline>;

  /** Pipeline abbrechen */
  cancelPipeline(repo: RepoIdentifier, pipelineId: string | number): Promise<void>;

  /** Pipeline neu starten */
  restartPipeline(repo: RepoIdentifier, pipelineId: string | number): Promise<Pipeline>;

  /** Logs abrufen */
  getLogs(repo: RepoIdentifier, pipelineId: string | number, stepId?: number): Promise<string>;
}

export interface RepoIdentifier {
  owner: string;
  name: string;
}

export interface PaginationOptions {
  page?: number;
  perPage?: number;
}

export interface TriggerOptions {
  branch?: string;
  variables?: Record<string, string>;
}

export interface Pipeline {
  id: string | number;
  number?: number;
  status: PipelineStatus;
  branch: string;
  commit?: string;
  message?: string;
  author?: string;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  steps?: PipelineStep[];
}

export type PipelineStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'blocked';

export interface PipelineStep {
  id: string | number;
  name: string;
  status: PipelineStatus;
  exitCode?: number;
  startedAt?: Date;
  finishedAt?: Date;
}

// ============================================
// CONTAINER ADAPTER INTERFACE
// ============================================

/**
 * Container Adapter Interface
 * Implementiert von: Portainer, Docker API, Kubernetes, etc.
 */
export interface IContainerAdapter extends IApiAdapter {
  /** Container auflisten */
  listContainers(options?: ContainerListOptions): Promise<Container[]>;

  /** Container-Details abrufen */
  getContainer(containerId: string): Promise<Container>;

  /** Container starten */
  startContainer(containerId: string): Promise<void>;

  /** Container stoppen */
  stopContainer(containerId: string): Promise<void>;

  /** Container neu starten */
  restartContainer(containerId: string): Promise<void>;

  /** Container-Logs abrufen */
  getContainerLogs(containerId: string, options?: LogOptions): Promise<string>;

  /** Stacks auflisten */
  listStacks(): Promise<Stack[]>;

  /** Stack starten */
  startStack(stackId: string | number): Promise<void>;

  /** Stack stoppen */
  stopStack(stackId: string | number): Promise<void>;

  /** Stack neu deployen */
  redeployStack(stackId: string | number): Promise<void>;
}

export interface ContainerListOptions {
  all?: boolean;
  filters?: Record<string, string[]>;
}

export interface LogOptions {
  tail?: number;
  since?: Date;
  timestamps?: boolean;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  status: string;
  createdAt: Date;
  ports?: ContainerPort[];
}

export type ContainerState = 'running' | 'stopped' | 'paused' | 'restarting' | 'dead';

export interface ContainerPort {
  private: number;
  public?: number;
  protocol: 'tcp' | 'udp';
}

export interface Stack {
  id: string | number;
  name: string;
  status: StackStatus;
  services?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type StackStatus = 'active' | 'inactive' | 'partial';

// ============================================
// GIT ADAPTER INTERFACE
// ============================================

/**
 * Git Adapter Interface
 * Implementiert von: simple-git (lokal), GitHub API, GitLab API, etc.
 */
export interface IGitAdapter extends IAdapter {
  /** Repository klonen */
  clone(url: string, path: string, options?: CloneOptions): Promise<void>;

  /** Status abrufen */
  status(path: string): Promise<GitStatus>;

  /** Dateien stagen */
  add(path: string, files: string[]): Promise<void>;

  /** Commit erstellen */
  commit(path: string, message: string): Promise<CommitResult>;

  /** Push zu Remote */
  push(path: string, options?: PushOptions): Promise<void>;

  /** Pull von Remote */
  pull(path: string, options?: PullOptions): Promise<void>;

  /** Branch-Operationen */
  branch(path: string, action: BranchAction, name?: string): Promise<BranchResult>;

  /** Log abrufen */
  log(path: string, options?: LogQueryOptions): Promise<CommitInfo[]>;

  /** Diff anzeigen */
  diff(path: string, options?: DiffOptions): Promise<string>;
}

export interface CloneOptions {
  branch?: string;
  depth?: number;
}

export interface GitStatus {
  branch: string;
  tracking?: string;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  deleted: string[];
  untracked: string[];
  conflicted: string[];
  isClean: boolean;
}

export interface CommitResult {
  hash: string;
  branch: string;
  author: string;
  summary: {
    changes: number;
    insertions: number;
    deletions: number;
  };
}

export interface PushOptions {
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
  force?: boolean;
}

export interface PullOptions {
  remote?: string;
  branch?: string;
  rebase?: boolean;
}

export type BranchAction = 'list' | 'create' | 'switch' | 'delete';

export interface BranchResult {
  current?: string;
  all?: string[];
  created?: string;
  switched?: string;
  deleted?: string;
}

export interface LogQueryOptions {
  limit?: number;
  file?: string;
  from?: string;
  to?: string;
}

export interface CommitInfo {
  hash: string;
  date: Date;
  message: string;
  author: string;
  email: string;
}

export interface DiffOptions {
  staged?: boolean;
  file?: string;
  from?: string;
  to?: string;
}

// ============================================
// SHELL ADAPTER INTERFACE
// ============================================

/**
 * Shell Adapter Interface
 * Implementiert von: shell-mcp (lokal), SSH, Remote Exec, etc.
 */
export interface IShellAdapter extends IAdapter {
  /** Befehl ausführen */
  exec(command: string, options: ExecOptions): Promise<ExecResult>;

  /** Datei lesen */
  readFile(path: string, options?: ReadFileOptions): Promise<string>;

  /** Datei schreiben */
  writeFile(path: string, content: string, options?: WriteFileOptions): Promise<void>;

  /** Verzeichnis auflisten */
  listDir(path: string, options?: ListDirOptions): Promise<DirEntry[]>;

  /** Datei/Verzeichnis prüfen */
  exists(path: string): Promise<{ exists: boolean; type?: 'file' | 'directory' }>;
}

export interface ExecOptions {
  cwd: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: string;
  timedOut: boolean;
  durationMs: number;
}

export interface ReadFileOptions {
  encoding?: BufferEncoding;
  maxSize?: number;
}

export interface WriteFileOptions {
  encoding?: BufferEncoding;
  createDirs?: boolean;
}

export interface ListDirOptions {
  recursive?: boolean;
  maxDepth?: number;
}

export interface DirEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
  children?: DirEntry[];
}

// ============================================
// CMS ADAPTER INTERFACE
// ============================================

/**
 * CMS Adapter Interface
 * Implementiert von: Directus, Strapi, Contentful, etc.
 */
export interface ICMSAdapter extends IApiAdapter {
  /** Collections auflisten */
  listCollections(): Promise<CMSCollection[]>;

  /** Items einer Collection abrufen */
  getItems(collection: string, options?: QueryOptions): Promise<CMSItem[]>;

  /** Einzelnes Item abrufen */
  getItem(collection: string, id: string | number): Promise<CMSItem>;

  /** Item erstellen */
  createItem(collection: string, data: Record<string, unknown>): Promise<CMSItem>;

  /** Item aktualisieren */
  updateItem(collection: string, id: string | number, data: Record<string, unknown>): Promise<CMSItem>;

  /** Item löschen */
  deleteItem(collection: string, id: string | number): Promise<void>;

  /** Asset hochladen */
  uploadAsset(file: Buffer, filename: string, mimeType: string): Promise<CMSAsset>;
}

export interface CMSCollection {
  name: string;
  fields: CMSField[];
}

export interface CMSField {
  name: string;
  type: string;
  required?: boolean;
}

export interface CMSItem {
  id: string | number;
  [key: string]: unknown;
}

export interface CMSAsset {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface QueryOptions {
  filter?: Record<string, unknown>;
  sort?: string[];
  limit?: number;
  offset?: number;
  fields?: string[];
}

// ============================================
// MESSAGING ADAPTER INTERFACE
// ============================================

/**
 * Messaging Adapter Interface
 * Implementiert von: Telegram, Discord, Slack, etc.
 */
export interface IMessagingAdapter extends IApiAdapter {
  /** Nachricht senden */
  sendMessage(chatId: string, text: string, options?: MessageOptions): Promise<Message>;

  /** Bild senden */
  sendPhoto(chatId: string, photo: Buffer | string, options?: PhotoOptions): Promise<Message>;

  /** Dokument senden */
  sendDocument(chatId: string, document: Buffer | string, options?: DocumentOptions): Promise<Message>;

  /** Nachricht bearbeiten */
  editMessage(chatId: string, messageId: string, text: string): Promise<Message>;

  /** Nachricht löschen */
  deleteMessage(chatId: string, messageId: string): Promise<void>;
}

export interface MessageOptions {
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  replyTo?: string;
  silent?: boolean;
}

export interface PhotoOptions extends MessageOptions {
  caption?: string;
}

export interface DocumentOptions extends MessageOptions {
  caption?: string;
  filename?: string;
}

export interface Message {
  id: string;
  chatId: string;
  text?: string;
  date: Date;
}

// ============================================
// REGISTRY TYPES
// ============================================

/**
 * Adapter Factory Function
 */
export type AdapterFactory<T extends IAdapter> = (config: Record<string, string>) => T;

/**
 * Adapter Registry Entry
 */
export interface AdapterRegistryEntry<T extends IAdapter> {
  type: string;
  factory: AdapterFactory<T>;
  description: string;
}
