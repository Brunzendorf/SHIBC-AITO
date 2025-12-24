/**
 * SHIBC MCP Shared Library
 *
 * Zentrale Bibliothek mit Interfaces, Base Classes und Utilities
 * für alle MCP Server im AITO System.
 *
 * @example
 * // Import all
 * import { BaseApiAdapter, registry, ICICDAdapter } from '@shibc/mcp-shared';
 *
 * // Import specific modules
 * import { ICICDAdapter, IContainerAdapter } from '@shibc/mcp-shared/types';
 * import { BaseApiAdapter, ToolBuilder } from '@shibc/mcp-shared/base';
 * import { registry, RegisterAdapter } from '@shibc/mcp-shared/registry';
 */

// Types & Interfaces
export type {
  // Core MCP Types
  MCPTool,
  MCPPropertySchema,
  MCPToolResult,
  MCPServerConfig,
  // Base Interfaces
  IAdapter,
  IApiAdapter,
  ApiResponse,
  // CI/CD
  ICICDAdapter,
  RepoIdentifier,
  PaginationOptions,
  TriggerOptions,
  Pipeline,
  PipelineStatus,
  PipelineStep,
  // Container
  IContainerAdapter,
  ContainerListOptions,
  LogOptions,
  Container,
  ContainerState,
  ContainerPort,
  Stack,
  StackStatus,
  // Git
  IGitAdapter,
  CloneOptions,
  GitStatus,
  CommitResult,
  PushOptions,
  PullOptions,
  BranchAction,
  BranchResult,
  LogQueryOptions,
  CommitInfo,
  DiffOptions,
  // Shell
  IShellAdapter,
  ExecOptions,
  ExecResult,
  ReadFileOptions,
  WriteFileOptions,
  ListDirOptions,
  DirEntry,
  // CMS
  ICMSAdapter,
  CMSCollection,
  CMSField,
  CMSItem,
  CMSAsset,
  QueryOptions,
  // Messaging
  IMessagingAdapter,
  MessageOptions,
  PhotoOptions,
  DocumentOptions,
  Message,
  // Registry
  AdapterFactory,
  AdapterRegistryEntry,
} from './types.js';

// Base Classes & Helpers
export {
  // Logging
  type LogLevel,
  type Logger,
  JsonLogger,
  // Base Classes
  BaseAdapter,
  BaseApiAdapter,
  // MCP Helpers
  ToolBuilder,
  successResult,
  errorResult,
  // Validators
  PathValidator,
  CommandValidator,
} from './base.js';

// Registry
export {
  type AdapterCategory,
  AdapterRegistry,
  registry,
  createCICDAdapter,
  createContainerAdapter,
  createGitAdapter,
  createShellAdapter,
  createCMSAdapter,
  createMessagingAdapter,
  RegisterAdapter,
} from './registry.js';
