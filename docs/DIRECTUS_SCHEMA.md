# Directus Schema - C-Level Team & Website Content

## Overview

Schema-Erweiterungen für die SHIBC Website via Directus CMS.

---

## Collection: `team_members`

C-Level AI Management Team Seite

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Primary key |
| `status` | string | published, draft, archived |
| `sort` | integer | Display order |
| `role` | string | CEO, CTO, CMO, CFO, COO, CCO, DAO |
| `codename` | string | SHIBC-CEO-001, etc. |
| `name` | string | Display name (z.B. "AI CEO") |
| `department` | string | Executive, Technology, Marketing, etc. |
| `avatar_style` | string | Avatar-Beschreibung für AI-generiertes Bild |
| `mission_statement` | text | Kurze Mission (2-3 Sätze) |
| `responsibilities` | json | Array von Hauptverantwortlichkeiten |
| `strengths` | json | Array von Stärken/Skills |
| `current_focus` | text | Aktuelle Priorität |
| `loop_count` | integer | Anzahl ausgeführter Loops |
| `success_rate` | float | Erfolgsquote in % |
| `last_active` | datetime | Letzter Loop-Zeitstempel |
| `quote` | text | Charakteristisches Zitat |
| `translations` | o2m | Relation zu team_members_translations |

### Translations

| Field | Type |
|-------|------|
| `languages_code` | string (de, en, es, fr, zh, ru) |
| `mission_statement` | text |
| `current_focus` | text |
| `quote` | text |

---

## Collection: `utilities`

SHIBC Utilities (Wallpaper, Tools, etc.)

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Primary key |
| `status` | string | published, draft |
| `sort` | integer | Display order |
| `name` | string | Utility name |
| `slug` | string | URL-friendly identifier |
| `type` | string | wallpaper, tool, widget, game |
| `description` | text | Kurzbeschreibung |
| `thumbnail` | file | Preview-Bild |
| `files` | m2m | Zugehörige Dateien |
| `external_url` | string | Link zu externem Tool |
| `is_featured` | boolean | Homepage-Feature |
| `download_count` | integer | Anzahl Downloads |
| `translations` | o2m | Relation zu utilities_translations |

---

## Collection: `blog_posts`

News und Blog-Artikel

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Primary key |
| `status` | string | published, draft, scheduled |
| `date_published` | datetime | Veröffentlichungsdatum |
| `author` | m2o | Relation zu team_members |
| `title` | string | Artikel-Titel |
| `slug` | string | URL-friendly identifier |
| `excerpt` | text | Kurzzusammenfassung |
| `content` | text (WYSIWYG) | Voller Artikel-Inhalt |
| `featured_image` | file | Header-Bild |
| `tags` | m2m | Relation zu tags |
| `category` | string | news, update, community, tech |
| `translations` | o2m | Relation zu blog_posts_translations |

---

## Collection: `roadmap_items`

Projekt-Roadmap

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Primary key |
| `status` | string | planned, in_progress, completed, cancelled |
| `quarter` | string | Q1 2025, Q2 2025, etc. |
| `title` | string | Milestone-Titel |
| `description` | text | Beschreibung |
| `category` | string | tech, marketing, community, governance |
| `progress` | integer | 0-100% |
| `dependencies` | m2m | Abhängige Items |
| `assigned_to` | m2o | Relation zu team_members |
| `translations` | o2m | Relation zu roadmap_translations |

---

## Multi-Language Support

### Unterstützte Sprachen

| Code | Language |
|------|----------|
| `de` | Deutsch (Primary) |
| `en` | English |
| `es` | Español |
| `fr` | Français |
| `zh` | 中文 |
| `ru` | Русский |

### Translation Strategy

1. **Primär-Content:** Deutsche Version als Basis
2. **Übersetzung:**
   - Marketing-Content: Claude (Lokalisierung wichtig)
   - Technische Docs: DeepL API (präzise, günstig)
3. **Review:** Muttersprachler-Community für Qualität

---

## Implementation Notes

### CTO Tasks

1. **Schema erstellen** via Directus Admin UI oder API
2. **Permissions** für API-Zugriff konfigurieren
3. **Webhooks** für Content-Updates (optional)
4. **Assets** folder für Team-Avatare

### CMO Tasks

1. **Team-Profile** für alle 7 Agents erstellen
2. **Avatar-Styles** definieren für AI-Generierung
3. **Content** in DE schreiben, Übersetzungen vorbereiten

### Deployment

```bash
# Directus Schema Export (für Backup)
npx directus schema snapshot ./schema-snapshot.yaml

# Directus Schema Apply (für Deployment)
npx directus schema apply ./schema-snapshot.yaml
```

---

## Sample Data: Team Members

```json
{
  "role": "CEO",
  "codename": "SHIBC-CEO-001",
  "name": "AI CEO",
  "department": "Executive",
  "mission_statement": "Strategische Führung des SHIBC-Projekts mit datenbasierten Entscheidungen und transparenter Governance.",
  "responsibilities": [
    "Strategische Führung",
    "C-Level Koordination",
    "Entscheidungsfindung",
    "Krisenmanagement"
  ],
  "strengths": [
    "Datenanalyse",
    "Langfristiges Denken",
    "Team-Koordination",
    "Risikobewertung"
  ],
  "current_focus": "Launch-Koordination und Team-Alignment",
  "loop_count": 93,
  "success_rate": 96.1,
  "quote": "Leadership Through Coordination | Data-Driven Decisions | Long-Term Vision"
}
```

---

*Schema-Definition für CTO-Implementation*
*Erstellt: 2025-12-12*
