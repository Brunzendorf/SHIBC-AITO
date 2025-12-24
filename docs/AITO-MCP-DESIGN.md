# AITO Database MCP Server Design

## Motivation

Agents brauchen Zugriff auf interne AITO-Daten, aber:
- Alles in den Loop-Prompt zu injizieren → zu viel Kontext
- Hardcoded Werte (CI, etc.) → nicht white-label fähig

**Lösung:** Ein leichtgewichtiger MCP Server für AITO-interne Daten.

---

## Architektur

```
┌──────────────────────────────────────────────────────────────────┐
│                         AGENT CONTEXT                            │
├──────────────────────────────────────────────────────────────────┤
│  PROGRAMMATISCH INJIZIERT (immer dabei):                         │
│  ├── Profile (Name, Rolle, Basis-Guidelines)                     │
│  ├── State (Volatile: Preise | Persistent: Loop-Count)           │
│  ├── RAG Context (relevante History, max 1500 chars)             │
│  ├── Kanban Issues (In Progress, Ready)                          │
│  └── Pending Tasks (Critical Queue)                              │
│                                                                  │
│  VIA MCP (on-demand, Agent entscheidet):                         │
│  ├── aito_get_projects() → Alle aktiven Projekte                 │
│  ├── aito_get_project_tasks(projectId) → Tasks eines Projekts    │
│  ├── aito_get_scheduled_events(days) → Geplante Events           │
│  ├── aito_get_brand_config() → CI Farben, Logos, Style           │
│  ├── aito_get_agent_status(agentType) → Was macht der Agent?     │
│  └── aito_create_scheduled_event(...) → Event erstellen          │
└──────────────────────────────────────────────────────────────────┘
```

---

## MCP Tools

### 1. Projekt-Übersicht
```typescript
aito_get_projects()
// Returns: [{ id, title, status, priority, progress, assignedAgent, upcomingEvents }]
```

### 2. Projekt-Details
```typescript
aito_get_project_details(projectId: string)
// Returns: { project, phases, tasks, events }
```

### 3. Scheduled Events
```typescript
aito_get_scheduled_events(days: number = 7, agent?: string, platform?: string)
// Returns: [{ id, title, eventType, scheduledAt, platform, status }]
```

### 4. Event erstellen (Alternative zu schedule_event Action)
```typescript
aito_create_event(event: {
  title: string,
  eventType: 'post' | 'ama' | 'release' | 'milestone' | 'meeting' | 'deadline',
  scheduledAt: string,
  platform?: 'twitter' | 'telegram' | 'discord' | 'website',
  content?: string
})
// Returns: { id, title, scheduledAt, status: 'scheduled' }
```

### 5. Brand/CI Konfiguration
```typescript
aito_get_brand_config()
// Returns: {
//   name: "SHIBA CLASSIC",
//   shortName: "SHIBC",
//   colors: {
//     primary: "#fda92d",
//     secondary: "#8E33FF",
//     background: "#141A21",
//     accent: "#00B8D9"
//   },
//   logos: {
//     main: "https://...",
//     icon: "https://...",
//     watermark: "https://..."
//   },
//   socials: {
//     twitter: "@shibc_cto",
//     telegram: "t.me/shibaclassic",
//     website: "shibaclassic.io"
//   },
//   imageStyle: {
//     aesthetic: "Professional crypto, glassmorphism, blockchain patterns",
//     mascot: "Golden Shiba Inu",
//     brandingDefault: "text-footer"
//   }
// }
```

### 6. Agent Status
```typescript
aito_get_agent_status(agentType?: string)
// Returns: [{ agentType, status, lastLoop, currentTask, loopCount }]
```

---

## Datenbank-Schema: brand_config

```sql
CREATE TABLE brand_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_key VARCHAR(50) UNIQUE NOT NULL,  -- 'shibc', 'client-xyz'

    -- Basic Info
    name VARCHAR(100) NOT NULL,
    short_name VARCHAR(20) NOT NULL,
    tagline VARCHAR(255),

    -- Colors (JSON)
    colors JSONB NOT NULL DEFAULT '{
        "primary": "#fda92d",
        "secondary": "#8E33FF",
        "background": "#141A21",
        "accent": "#00B8D9",
        "text": "#FFFFFF"
    }',

    -- Logos (Directus File IDs or URLs)
    logos JSONB NOT NULL DEFAULT '{
        "main": null,
        "icon": null,
        "watermark": null
    }',

    -- Social Links
    socials JSONB NOT NULL DEFAULT '{
        "twitter": null,
        "telegram": null,
        "discord": null,
        "website": null
    }',

    -- Image Generation Style
    image_style JSONB NOT NULL DEFAULT '{
        "aesthetic": "Professional, modern, tech-forward",
        "patterns": "Blockchain networks, connected nodes",
        "mascot": null,
        "defaultBranding": "text-footer"
    }',

    -- Active/Default
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed default SHIBC config
INSERT INTO brand_config (project_key, name, short_name, tagline, is_default) VALUES
('shibc', 'SHIBA CLASSIC', 'SHIBC', 'The Original', true);
```

---

## Implementation Priority

### Phase 1: Brand Config (White-Label) ✅ COMPLETED

**Status:** Implementiert am 2025-12-23

1. ✅ `brand_config` Tabelle erstellen → `docker/migrations/008_brand_config.sql`
2. ⏳ Dashboard UI zum Pflegen → Noch offen
3. ✅ Werte in Agent-Profile injizieren (nicht hardcoded)

**Implementierte Komponenten:**
- `src/lib/db.ts`: `brandConfigRepo` mit `getByProjectKey()`, `getDefault()`, `getForAgent()`
- `src/agents/claude.ts`: `buildLoopPrompt()` akzeptiert `BrandConfigContext`
- `src/agents/daemon.ts`: Lädt Brand Config bei jedem Loop aus DB
- `src/agents/session-executor.ts`: Session-Prompt enthält Brand CI

**Agent-Kontext enthält jetzt:**
```markdown
## 🎨 Brand Configuration (CI)
| Property | Value |
|----------|-------|
| Project Name | **SHIBA CLASSIC** |
| Short Name | **SHIBC** |
### Colors (REQUIRED for image generation)
- **Primary:** #fda92d
- **Secondary:** #8E33FF
...
```

### Phase 2: AITO MCP Server ⏳ TODO
1. Leichtgewichtiger MCP Server (`mcp-servers/aito-mcp/`)
2. Read-only Tools für Projekte, Events, Status
3. Write Tools für Events (optional)

### Phase 3: Agent Integration ⏳ TODO
1. AITO MCP als worker-only Server konfigurieren
2. Agents nutzen es bei Bedarf

---

## Kontext-Überlegungen

**Warum MCP statt mehr Injektion?**

| Szenario | Programmatisch | Via MCP |
|----------|---------------|---------|
| CMO braucht Projekt-Status | ~500 tokens jedes Mal | ~100 tokens wenn nötig |
| CMO plant 5 Events | Muss alle Events kennen | Fragt nur was er braucht |
| CI-Änderung | Rebuild nötig | Sofort wirksam |

**Kontext-Kosten (geschätzt):**
- MCP Tool-Definition: ~200 tokens einmalig
- Tool-Call + Response: ~150-300 tokens pro Aufruf
- Volle Projekt-Liste in Prompt: ~1000+ tokens

→ MCP ist effizienter wenn Agent nicht IMMER alle Daten braucht.

---

## Beispiel: CMO mit AITO MCP

```json
{
  "actions": [
    {
      "type": "spawn_worker",
      "task": "1. Call aito_get_brand_config to get CI colors. 2. Call aito_get_scheduled_events(7) to check what's already planned. 3. Generate marketing banner using CI colors. 4. Call aito_create_event to schedule the post.",
      "servers": ["aito", "imagen", "filesystem"]
    }
  ]
}
```

Der Agent entscheidet selbst:
- "Brauche ich die CI-Farben?" → Ja → aito_get_brand_config
- "Was ist schon geplant?" → Ja → aito_get_scheduled_events
- "Welches Format?" → Entscheidet basierend auf CI

---

## Alternative: Erweiterter Loop-Kontext

Falls MCP zu viel Overhead:

```typescript
// In daemon.ts - zusätzlich zu Kanban/RAG:
const brandConfig = await db.getBrandConfig(projectKey);
const upcomingEvents = await db.findUpcomingEvents(7);

// In buildLoopPrompt:
parts.push('## Brand Configuration');
parts.push(JSON.stringify(brandConfig.colors));
// ...
```

**Nachteil:** Immer geladen, auch wenn nicht gebraucht.

---

## Empfehlung

1. **Kurzfristig:** `brand_config` Tabelle + programmatische Injektion
2. **Mittelfristig:** AITO MCP für on-demand Zugriff
3. **Langfristig:** Agent wählt selbst was er braucht

Das macht das System:
- White-Label fähig (CI aus DB, nicht hardcoded)
- Effizient (nur laden was nötig)
- Flexibel (Agent entscheidet)
