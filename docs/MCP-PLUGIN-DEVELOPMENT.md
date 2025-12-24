# MCP Plugin Development Guide

Anleitung zur Entwicklung neuer MCP Server/Adapter für das AITO System.

## Architektur-Übersicht

```
@shibc/mcp-shared
├── types.ts      ← Interfaces (IAdapter, ICICDAdapter, etc.)
├── base.ts       ← Base Classes (BaseAdapter, BaseApiAdapter)
├── registry.ts   ← AdapterRegistry, Factory Functions
└── index.ts      ← Barrel Export

mcp-servers/
├── shared/       ← Shared Library
├── git-mcp/      ← Git Adapter (IGitAdapter)
├── shell-mcp/    ← Shell Adapter (IShellAdapter)
├── portainer-mcp/← Container Adapter (IContainerAdapter)
├── woodpecker-mcp/← CI/CD Adapter (ICICDAdapter)
├── telegram-mcp/ ← Messaging Adapter (IMessagingAdapter)
└── my-new-mcp/   ← Dein neuer Adapter
```

## Quick Start: Neuen Adapter erstellen

### 1. Verzeichnis & Package erstellen

```bash
mkdir -p mcp-servers/my-mcp/src
cd mcp-servers/my-mcp
```

**package.json:**
```json
{
  "name": "@shibc/my-mcp",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.2"
  }
}
```

### 2. Interface wählen

Wähle das passende Interface für deinen Adapter:

| Interface | Verwendung | Beispiel |
|-----------|------------|----------|
| `IApiAdapter` | REST APIs | Portainer, Woodpecker |
| `ICICDAdapter` | CI/CD Systeme | Jenkins, GitLab CI |
| `IContainerAdapter` | Container Mgmt | Docker, Kubernetes |
| `IGitAdapter` | Git Providers | GitHub, GitLab, Gitea |
| `IShellAdapter` | Shell/CLI Tools | SSH, Local Shell |
| `ICMSAdapter` | CMS Systeme | Strapi, Contentful |
| `IMessagingAdapter` | Messaging | Discord, Slack |

### 3. Adapter implementieren

**Beispiel: API-basierter Adapter**

```typescript
// src/adapter.ts
import {
  BaseApiAdapter,
  ICICDAdapter,
  Pipeline,
  RepoIdentifier,
  TriggerOptions,
  PaginationOptions,
} from '@shibc/mcp-shared';

export class JenkinsAdapter extends BaseApiAdapter implements ICICDAdapter {
  constructor(config: Record<string, string>) {
    super('jenkins', config, 'JENKINS_URL');
  }

  protected setupAuth(): void {
    // Basic Auth für Jenkins
    const user = this.getEnvOrConfig('JENKINS_USER', 'user');
    const token = this.getEnvOrConfig('JENKINS_TOKEN', 'token');
    const auth = Buffer.from(`${user}:${token}`).toString('base64');
    this.headers['Authorization'] = `Basic ${auth}`;
  }

  protected getHealthEndpoint(): string {
    return '/api/json';
  }

  async listPipelines(repo: RepoIdentifier, options?: PaginationOptions): Promise<Pipeline[]> {
    const response = await this.request<JenkinsJob[]>('GET', '/api/json?tree=jobs[name,color,url]');
    if (response.error) throw new Error(response.error);

    return (response.data || []).map(job => ({
      id: job.name,
      status: this.mapStatus(job.color),
      branch: 'main',
      createdAt: new Date(),
    }));
  }

  async triggerPipeline(repo: RepoIdentifier, options?: TriggerOptions): Promise<Pipeline> {
    const path = `/job/${repo.name}/build`;
    const response = await this.request('POST', path);
    if (response.error) throw new Error(response.error);

    return { id: 'new', status: 'pending', branch: options?.branch || 'main', createdAt: new Date() };
  }

  // ... weitere Interface-Methoden implementieren

  private mapStatus(color: string): Pipeline['status'] {
    switch (color) {
      case 'blue': return 'success';
      case 'red': return 'failure';
      case 'yellow': return 'running';
      default: return 'pending';
    }
  }
}
```

### 4. MCP Server erstellen

```typescript
// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  ToolBuilder,
  successResult,
  errorResult,
} from '@shibc/mcp-shared';

import { JenkinsAdapter } from './adapter.js';

// Adapter initialisieren
const adapter = new JenkinsAdapter({
  JENKINS_URL: process.env.JENKINS_URL || '',
  JENKINS_USER: process.env.JENKINS_USER || '',
  JENKINS_TOKEN: process.env.JENKINS_TOKEN || '',
});

// MCP Server erstellen
const server = new Server(
  { name: 'jenkins-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Tools definieren
const tools = new ToolBuilder()
  .add('jenkins_jobs', 'List all Jenkins jobs', {
    filter: { type: 'string', description: 'Optional name filter' },
  })
  .add('jenkins_build', 'Trigger a build', {
    job: { type: 'string', description: 'Job name', required: true },
    params: { type: 'object', description: 'Build parameters' },
  })
  .build();

// Tools registrieren
server.setRequestHandler('tools/list', async () => ({ tools }));

// Tool-Aufrufe verarbeiten
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'jenkins_jobs': {
        const pipelines = await adapter.listPipelines({ owner: '', name: '' });
        return successResult({ jobs: pipelines });
      }

      case 'jenkins_build': {
        const schema = z.object({ job: z.string(), params: z.record(z.unknown()).optional() });
        const { job, params } = schema.parse(args);
        const result = await adapter.triggerPipeline({ owner: '', name: job });
        return successResult({ triggered: result });
      }

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : 'Unknown error');
  }
});

// Server starten
async function main() {
  await adapter.initialize();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

### 5. Zur Registry hinzufügen (optional)

```typescript
// src/register.ts
import { RegisterAdapter } from '@shibc/mcp-shared';
import { JenkinsAdapter } from './adapter.js';

// Auto-Registrierung via Decorator
@RegisterAdapter('cicd', 'jenkins', 'Jenkins CI Adapter')
class RegisteredJenkinsAdapter extends JenkinsAdapter {}

// Oder manuell
import { registry } from '@shibc/mcp-shared';

registry.register('cicd', 'jenkins', {
  factory: (config) => new JenkinsAdapter(config),
  description: 'Jenkins CI Adapter',
});
```

## Verfügbare Interfaces

### IAdapter (Basis)

```typescript
interface IAdapter {
  readonly name: string;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  isHealthy(): Promise<boolean>;
}
```

### IApiAdapter

```typescript
interface IApiAdapter extends IAdapter {
  readonly baseUrl: string;
  request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>>;
}
```

### ICICDAdapter

```typescript
interface ICICDAdapter extends IApiAdapter {
  listPipelines(repo: RepoIdentifier, options?: PaginationOptions): Promise<Pipeline[]>;
  getPipeline(repo: RepoIdentifier, pipelineId: string | number): Promise<Pipeline>;
  triggerPipeline(repo: RepoIdentifier, options?: TriggerOptions): Promise<Pipeline>;
  cancelPipeline(repo: RepoIdentifier, pipelineId: string | number): Promise<void>;
  restartPipeline(repo: RepoIdentifier, pipelineId: string | number): Promise<Pipeline>;
  getLogs(repo: RepoIdentifier, pipelineId: string | number, stepId?: number): Promise<string>;
}
```

### IContainerAdapter

```typescript
interface IContainerAdapter extends IApiAdapter {
  listContainers(options?: ContainerListOptions): Promise<Container[]>;
  getContainer(containerId: string): Promise<Container>;
  startContainer(containerId: string): Promise<void>;
  stopContainer(containerId: string): Promise<void>;
  restartContainer(containerId: string): Promise<void>;
  getContainerLogs(containerId: string, options?: LogOptions): Promise<string>;
  listStacks(): Promise<Stack[]>;
  startStack(stackId: string | number): Promise<void>;
  stopStack(stackId: string | number): Promise<void>;
  redeployStack(stackId: string | number): Promise<void>;
}
```

### IGitAdapter

```typescript
interface IGitAdapter extends IAdapter {
  clone(url: string, path: string, options?: CloneOptions): Promise<void>;
  status(path: string): Promise<GitStatus>;
  add(path: string, files: string[]): Promise<void>;
  commit(path: string, message: string): Promise<CommitResult>;
  push(path: string, options?: PushOptions): Promise<void>;
  pull(path: string, options?: PullOptions): Promise<void>;
  branch(path: string, action: BranchAction, name?: string): Promise<BranchResult>;
  log(path: string, options?: LogQueryOptions): Promise<CommitInfo[]>;
  diff(path: string, options?: DiffOptions): Promise<string>;
}
```

### IShellAdapter

```typescript
interface IShellAdapter extends IAdapter {
  exec(command: string, options: ExecOptions): Promise<ExecResult>;
  readFile(path: string, options?: ReadFileOptions): Promise<string>;
  writeFile(path: string, content: string, options?: WriteFileOptions): Promise<void>;
  listDir(path: string, options?: ListDirOptions): Promise<DirEntry[]>;
  exists(path: string): Promise<{ exists: boolean; type?: 'file' | 'directory' }>;
}
```

### ICMSAdapter

```typescript
interface ICMSAdapter extends IApiAdapter {
  listCollections(): Promise<CMSCollection[]>;
  getItems(collection: string, options?: QueryOptions): Promise<CMSItem[]>;
  getItem(collection: string, id: string | number): Promise<CMSItem>;
  createItem(collection: string, data: Record<string, unknown>): Promise<CMSItem>;
  updateItem(collection: string, id: string | number, data: Record<string, unknown>): Promise<CMSItem>;
  deleteItem(collection: string, id: string | number): Promise<void>;
  uploadAsset(file: Buffer, filename: string, mimeType: string): Promise<CMSAsset>;
}
```

### IMessagingAdapter

```typescript
interface IMessagingAdapter extends IApiAdapter {
  sendMessage(chatId: string, text: string, options?: MessageOptions): Promise<Message>;
  sendPhoto(chatId: string, photo: Buffer | string, options?: PhotoOptions): Promise<Message>;
  sendDocument(chatId: string, document: Buffer | string, options?: DocumentOptions): Promise<Message>;
  editMessage(chatId: string, messageId: string, text: string): Promise<Message>;
  deleteMessage(chatId: string, messageId: string): Promise<void>;
}
```

## Helper-Klassen

### BaseApiAdapter

Abstrakte Basisklasse für API-basierte Adapter:

```typescript
class MyAdapter extends BaseApiAdapter {
  constructor(config: Record<string, string>) {
    super('my-adapter', config, 'MY_API_URL');
  }

  protected setupAuth(): void {
    // Auth-Header setzen
    this.headers['Authorization'] = `Bearer ${this.getEnvOrConfig('MY_TOKEN')}`;
  }

  async myMethod() {
    const response = await this.request<MyResponse>('GET', '/endpoint');
    if (response.error) throw new Error(response.error);
    return response.data;
  }
}
```

### ToolBuilder

Fluent API zum Erstellen von MCP Tools:

```typescript
const tools = new ToolBuilder()
  .add('tool_name', 'Tool description', {
    param1: { type: 'string', description: 'Required param', required: true },
    param2: { type: 'number', description: 'Optional param', default: 10 },
    param3: { type: 'string', description: 'Enum param', enum: ['a', 'b', 'c'] },
  })
  .add('another_tool', 'Another tool', { /* ... */ })
  .build();
```

### PathValidator

Pfad-Validierung für Sicherheit:

```typescript
const validator = new PathValidator(['/app/projects', '/app/workspace']);

validator.validate('/app/projects/foo');  // OK
validator.validate('/etc/passwd');        // Error: Path not allowed
```

### CommandValidator

Command-Validierung für Shell-Adapter:

```typescript
const validator = new CommandValidator(
  ['npm', 'node', 'git'],           // Erlaubte Befehle
  ['rm -rf /', 'sudo', '--force']   // Verbotene Muster
);

validator.validate('npm install');  // OK
validator.validate('sudo rm -rf /'); // Error: Forbidden pattern
```

### Result Helpers

```typescript
import { successResult, errorResult } from '@shibc/mcp-shared';

// Erfolg
return successResult({ data: myData, count: 42 });
// → { content: [{ type: 'text', text: '{"success":true,"data":...}' }] }

// Fehler
return errorResult('Something went wrong');
// → { content: [{ type: 'text', text: '{"success":false,"error":"..."}' }], isError: true }
```

## Integration in AITO

### 1. Dockerfile aktualisieren

```dockerfile
# docker/Dockerfile.agent
RUN cd mcp-servers/my-mcp && npm ci && npm run build || true
```

### 2. MCP Server Konfiguration

```json
// .claude/mcp_servers.json
{
  "mcpServers": {
    "my-mcp": {
      "command": "node",
      "args": ["/app/mcp-servers/my-mcp/dist/index.js"],
      "env": {
        "MY_API_URL": "${MY_API_URL}",
        "MY_TOKEN": "${MY_TOKEN}"
      },
      "description": "My custom MCP server"
    }
  }
}
```

### 3. Agent-Zuordnung

```typescript
// src/lib/mcp.ts
export const MCP_SERVERS_BY_AGENT: Record<string, string[]> = {
  cto: ['..existing...', 'my-mcp'],
};
```

### 4. Umgebungsvariablen

```bash
# .env
MY_API_URL=https://api.example.com
MY_TOKEN=secret-token
```

## Best Practices

### Security

1. **Pfad-Validierung** - Immer `PathValidator` für Dateizugriffe
2. **Command-Whitelist** - Immer `CommandValidator` für Shell-Befehle
3. **Secrets via Env** - Nie hardcoded Credentials
4. **Input-Validierung** - Zod für alle Tool-Parameter

### Error Handling

```typescript
try {
  const result = await adapter.doSomething();
  return successResult(result);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  this.logger.error('Operation failed', { error: message });
  return errorResult(message);
}
```

### Logging

```typescript
// Nutze den eingebauten Logger
this.logger.info('Starting operation', { param: value });
this.logger.debug('Detailed info', { data });
this.logger.warn('Warning', { issue });
this.logger.error('Error occurred', { error: message });
```

### Testing

```typescript
// tests/adapter.test.ts
import { describe, it, expect } from 'vitest';
import { MyAdapter } from '../src/adapter.js';

describe('MyAdapter', () => {
  it('should initialize successfully', async () => {
    const adapter = new MyAdapter({ MY_API_URL: 'http://localhost' });
    await adapter.initialize();
    expect(await adapter.isHealthy()).toBe(true);
  });
});
```

## Neue Kategorie hinzufügen

Falls du eine völlig neue Adapter-Kategorie brauchst:

### 1. Interface definieren

```typescript
// mcp-servers/shared/src/types.ts
export interface IMonitoringAdapter extends IApiAdapter {
  getMetrics(service: string): Promise<Metric[]>;
  createAlert(config: AlertConfig): Promise<Alert>;
  // ...
}
```

### 2. Kategorie registrieren

```typescript
// mcp-servers/shared/src/registry.ts
export type AdapterCategory =
  | 'cicd'
  | 'container'
  | 'monitoring'  // Neue Kategorie
  | ...;

// In Constructor
const categories: AdapterCategory[] = [
  'monitoring',
  // ...
];
```

### 3. Factory-Funktion hinzufügen

```typescript
export function createMonitoringAdapter(name: string, config: Record<string, string>): IMonitoringAdapter {
  return registry.create<IMonitoringAdapter>('monitoring', name, config);
}
```
