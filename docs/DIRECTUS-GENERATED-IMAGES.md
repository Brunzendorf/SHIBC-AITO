# Directus Collection: Generated Images

## Requirements für White-Label Lösung

Diese Spezifikation beschreibt eine generische `generated_images` Collection für AI-generierte Bilder, die von mehreren Projekten/Mandanten genutzt werden kann.

---

## Collection Schema: `generated_images`

### Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | uuid | auto | Primary key |
| `project` | string | ✅ | Projekt-Identifier (z.B. "shibc", "client-xyz") |
| `title` | string | ✅ | Bildtitel für Anzeige |
| `description` | text | ❌ | Ausführliche Beschreibung |
| `alt_text` | string | ❌ | Accessibility/SEO Text |

### Generation Metadata

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt_used` | text | ✅ | Der Prompt der zur Generierung verwendet wurde |
| `model_id` | string | ✅ | Model-ID (z.B. "imagen-4.0-generate-001") |
| `model_provider` | string | ✅ | Provider (z.B. "google", "openai", "stability") |
| `generation_cost` | decimal | ❌ | Kosten in USD |
| `generation_params` | json | ❌ | Zusätzliche Parameter (aspect_ratio, seed, etc.) |

### Agent/Source Info

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `created_by_agent` | string | ❌ | Agent-Type der das Bild erstellt hat (cmo, ceo, etc.) |
| `created_by_user` | user (m2o) | ❌ | Oder manuell von User erstellt |
| `source_task_id` | string | ❌ | Worker Task ID für Traceability |

### File & Storage

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | file (m2o) | ✅ | Relation zu Directus Files |
| `workspace_path` | string | ❌ | Originaler Pfad im Workspace |
| `file_size_bytes` | integer | ❌ | Dateigröße |
| `dimensions` | json | ❌ | `{width: 1920, height: 1080}` |

### Publication Status

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | ✅ | `draft` / `review` / `published` / `archived` |
| `published_at` | datetime | ❌ | Wann wurde es veröffentlicht |
| `reviewed_by` | user (m2o) | ❌ | Wer hat reviewed/approved |

### Organization

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tags` | json | ❌ | Array von Tags `["marketing", "christmas", "2025"]` |
| `category` | string | ❌ | Kategorie (marketing, social, announcement, meme) |
| `campaign` | string | ❌ | Zugehörige Kampagne/Initiative |

### Timestamps

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `date_created` | datetime | auto | Erstellungsdatum |
| `date_updated` | datetime | auto | Letzte Änderung |

---

## Status Workflow

```
draft → review → published
  ↓        ↓         ↓
  └─→ archived ←─────┘
```

- **draft**: Frisch generiert, noch nicht geprüft
- **review**: Bereit zur Prüfung durch Human
- **published**: Freigegeben, sichtbar auf Website/Galerie
- **archived**: Nicht mehr aktiv, aber aufbewahrt

---

## API Endpoints (via Directus REST/GraphQL)

### Create Image Record
```
POST /items/generated_images
{
  "project": "shibc",
  "title": "Christmas 2025 Banner",
  "prompt_used": "...",
  "model_id": "imagen-4.0-generate-001",
  "model_provider": "google",
  "status": "draft",
  "file": "<file_id>",
  "tags": ["christmas", "marketing", "2025"],
  "created_by_agent": "cmo"
}
```

### Query Published Images
```
GET /items/generated_images?filter[status][_eq]=published&filter[project][_eq]=shibc
```

### Update Status
```
PATCH /items/generated_images/<id>
{
  "status": "published",
  "published_at": "2025-12-23T10:00:00Z"
}
```

---

## Feature Ideas / Future Enhancements

### 1. Similarity Search (Qdrant Integration)
- Embedding von `title + description + tags` in Qdrant speichern
- Vor neuer Generierung prüfen: "Haben wir schon ein ähnliches Bild?"
- Vermeidet Duplikate und spart Kosten

### 2. Auto-Tagging via AI
- Nach Generierung automatisch Tags aus Bild-Inhalt extrahieren
- Vision API für Objekt/Szenen-Erkennung
- Verbessert Suchbarkeit

### 3. Usage Tracking
- Welche Bilder wurden wo verwendet (Telegram, Twitter, Website)
- Performance-Metriken (Views, Engagement)
- Helps identify successful image types

### 4. Template System
- Vordefinierte Prompt-Templates mit Platzhaltern
- Konsistentes CI über alle Generierungen
- `{project_name}`, `{colors}`, `{style}` Variablen

### 5. Batch Generation
- Mehrere Varianten eines Prompts generieren
- A/B Testing für Marketing-Material
- Best performer wird published

### 6. Approval Workflow
- Multi-Step Approval für sensitive Content
- Notifications an Reviewer
- Audit Trail wer was wann approved

### 7. Expiration/Scheduling
- `publish_at` für geplante Veröffentlichung
- `expires_at` für zeitlich begrenzte Kampagnen
- Auto-Archivierung nach Ablauf

### 8. Version History
- Mehrere Versionen eines Bildes (Revisionen)
- Rollback zu früherer Version
- Diff-View für Prompt-Änderungen

### 9. Cost Dashboard
- Aggregierte Kosten pro Projekt/Agent/Zeitraum
- Budget-Warnungen
- ROI-Tracking (Kosten vs. Engagement)

### 10. Brand Consistency Check
- AI-basierte Prüfung ob Bild zu CI passt
- Farb-Analyse gegen Brand-Palette
- Logo-Detection für Branding-Compliance

---

## Integration mit AITO Agents

### Worker Flow
```
1. Agent entscheidet: Bild wird benötigt
2. spawn_worker mit ["imagen", "filesystem", "directus"]
3. Worker:
   a. imagen_check_quota()
   b. imagen_generate_image(prompt)
   c. imagen_apply_branding(type)
   d. filesystem.write(path)
   e. directus.upload_file(bytes)
   f. directus.create_item("generated_images", metadata)
4. Return: { directus_id, file_url, status: "draft" }
```

### RAG Integration
```
1. Vor Generierung: Qdrant-Suche nach ähnlichen Bildern
2. Wenn Match mit status=published → Bild wiederverwenden
3. Wenn kein Match → Neu generieren
4. Nach Generierung → In Qdrant indexieren
```

---

## Permissions (Directus Roles)

| Role | Create | Read | Update | Delete |
|------|--------|------|--------|--------|
| Public | ❌ | published only | ❌ | ❌ |
| Agent (API) | ✅ | ✅ all | status only | ❌ |
| Editor | ✅ | ✅ all | ✅ all | ❌ |
| Admin | ✅ | ✅ all | ✅ all | ✅ |
