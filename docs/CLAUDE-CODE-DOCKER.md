# Claude Code Docker Integration

## Überblick

AITO nutzt **Claude Code CLI** (nicht API!) für AI-Intelligence. Das spart massive Kosten:

| Methode | Monatliche Kosten |
|---------|-------------------|
| API (geschätzt) | ~$12.000 |
| **Claude Code CLI (Max Plan)** | **$200** |

## Docker Installation

### Im Dockerfile

```dockerfile
# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code@latest || \
    curl -fsSL https://claude.ai/cli/install.sh | sh

# Create persistent config directory
RUN mkdir -p /app/.claude && chown -R 1001:1001 /app/.claude
```

### Fallback (wenn npm/curl fehlschlägt)

```dockerfile
# Ollama-Routing als Fallback für einfache Tasks
RUN printf '#!/bin/bash\n\
PROMPT="$*"\n\
if curl -s http://ollama:11434/api/tags >/dev/null 2>&1; then\n\
    curl -s -X POST http://ollama:11434/api/generate \\\n\
        -H "Content-Type: application/json" \\\n\
        -d "{\"model\":\"llama3.2:1b\",\"prompt\":\"$PROMPT\",\"stream\":false}" \\\n\
        | jq -r ".response"\n\
fi\n' > /usr/local/bin/claude-fallback && chmod +x /usr/local/bin/claude-fallback
```

## Authentifizierung (Einmalig!)

### Option 1: Interaktiv (Empfohlen)

```bash
# Windows (Git Bash/WSL)
winpty docker exec -it aito-ceo-agent claude auth login

# Linux/Mac
docker exec -it aito-ceo-agent claude auth login
```

### Option 2: Browser Session Token

```bash
# 1. Gehe zu claude.ai → Developer Tools (F12)
# 2. Application → Cookies → sessionKey kopieren
# 3. Im Container:
docker exec -it aito-ceo-agent claude setup-token DEIN_SESSION_TOKEN
```

### Option 3: Volume Mount (Persistent über Restarts)

```bash
# 1. Auf Host authentifizieren
claude auth login

# 2. Config kopieren
cp -r ~/.claude /path/to/docker/volumes/claude_config/
```

## Docker Volume für Persistenz

```yaml
# docker-compose.yml
services:
  ceo-agent:
    volumes:
      - claude_config:/app/.claude  # Auth-Daten persistent!

volumes:
  claude_config:
```

## Verwendung im Agent

```typescript
import { execSync } from 'child_process';

async function askClaude(prompt: string): Promise<string> {
  try {
    const response = execSync(`claude --print "${prompt}"`, {
      encoding: 'utf8',
      timeout: 60000,  // 60 sec timeout
    });
    return response.trim();
  } catch (err) {
    // Fallback zu Ollama
    return askOllama(prompt);
  }
}
```

## Test

```bash
# Test im Container
docker exec aito-ceo-agent claude --print "AI CEO READY?"

# Erwartete Antwort
AI CEO READY!
```

## Kostenmodell

```
Claude Max Plan: $200/month flat
├── Unlimitierte Nachrichten (mit Session-Limits)
├── Claude Code CLI inkludiert
├── Alle Features
└── Keine zusätzlichen API-Kosten

Session Limits (Max Plan):
├── Pro Session: ~50-100 Nachrichten
├── Pro Tag: Mehrere Sessions möglich
└── Bei Überschreitung: Kurze Pause, dann weiter
```

## Best Practices

### 1. Ollama First, Claude Second

```typescript
function routeToAI(task: Task): 'ollama' | 'claude' {
  // Einfache Tasks → Ollama (kostenlos, schnell)
  if (['sentiment', 'classification', 'spam'].includes(task.type)) {
    return 'ollama';
  }
  // Komplexe Tasks → Claude
  return 'claude';
}
```

### 2. Batching

```typescript
// SCHLECHT: Einzelne Anfragen
await claude("Frage 1");
await claude("Frage 2");
await claude("Frage 3");

// GUT: Gebündelte Anfrage
await claude(`
  Beantworte folgende Fragen:
  1. Frage 1
  2. Frage 2
  3. Frage 3
`);
```

### 3. Context Management

```typescript
// Agent-Profile als System-Prompt
const profile = fs.readFileSync('/profiles/ceo.md', 'utf8');
const context = await loadRecentHistory(agentId, 50);

await claude(`
${profile}

## Aktuelle Situation
${context}

## Aufgabe
${task}
`);
```

## Troubleshooting

### "Claude not found"

```bash
# Prüfe Installation
docker exec aito-ceo-agent which claude

# Neu installieren
docker exec aito-ceo-agent npm install -g @anthropic-ai/claude-code@latest
```

### "Authentication required"

```bash
# Re-Auth
docker exec -it aito-ceo-agent claude auth login
```

### "Rate limited"

```bash
# Warte oder nutze Ollama-Fallback
# Session-Limits sind temporär (meist 1-2h Pause)
```

## Wichtig

- ❌ **KEINE API Keys** im Code/Umgebungsvariablen
- ✅ **Volume Mount** für ~/.claude Persistenz
- ✅ **Einmalige Auth** pro Container-Typ
- ✅ **Ollama Fallback** für einfache Tasks
