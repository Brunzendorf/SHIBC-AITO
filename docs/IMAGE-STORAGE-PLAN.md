# SHIBC Image Storage & CI System Design

## 1. Git Workflow per Loop

### Problem
- Agents create files locally but don't always commit/push
- Other agents can't see uncommitted changes
- Risk of losing work if container restarts

### Solution: Automatic Pull/Commit/Push

```
Loop Start:
1. pullWorkspace() - get latest from all agents
2. Handle conflicts (reset to remote if needed)

Loop End:
1. Check for uncommitted changes
2. commitAndPushDirect() with loop summary
3. All changes are immediately available to other agents
```

### Implementation in daemon.ts
- Add `pullWorkspace()` call at start of `runLoop()`
- Ensure `commitAndPushDirect()` is called after every successful loop
- Already exists but needs to be more consistent

---

## 2. Image Storage via Directus

### Directus Collection Schema: `shibc_images`

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| title | string | Image title (e.g., "Christmas Marketing Banner") |
| description | text | Full description |
| alt_text | string | Accessibility text |
| prompt_used | text | Imagen prompt that generated this |
| model_used | string | "imagen-4.0-generate-001" or "gemini-2.5-flash-image" |
| agent_type | string | "cmo", "ceo", etc. |
| cost_usd | decimal | Generation cost |
| status | string | "draft" / "review" / "published" |
| tags | json | ["christmas", "marketing", "banner"] |
| workspace_path | string | "/app/workspace/images/..." |
| directus_file | file (m2o) | Link to Directus Files collection |
| created_at | datetime | Auto |
| published_at | datetime | When status changed to published |

### Workflow
1. Image generated via imagen MCP -> saved to workspace
2. Worker uploads to Directus Files -> gets file ID
3. Worker creates `shibc_images` record with draft status
4. Human reviews in Directus UI -> publishes when ready
5. Published images appear on website gallery

### MCP Tools for Directus
Using `@directus/content-mcp`:
- `directus_upload_file` - Upload image file
- `directus_create_item` - Create shibc_images record
- `directus_update_item` - Update status to published

---

## 3. Qdrant Integration for Image Search

### Purpose
Before generating a new image, check if we already have one that fits.

### Vector Storage
```
Collection: shibc_images
Vector: Embedding of (title + description + tags)
Payload: {
  directus_id: "uuid",
  directus_url: "https://directus.shibaclassic.io/assets/...",
  title: "...",
  tags: [...],
  status: "published",
  created_at: "..."
}
```

### Search Flow
1. Agent needs image for "Christmas announcement"
2. RAG search in Qdrant: "Christmas announcement banner marketing"
3. If match found with published status -> use existing image
4. If not found -> generate new via imagen MCP

### Implementation
- After Directus upload, index in Qdrant via RAG system
- Add image search to CMO profile context

---

## 4. Corporate Identity Guidelines

### Color Palette
| Color | Hex | Usage |
|-------|-----|-------|
| Orange-Gold (Primary) | #fda92d | Main accent, gradients |
| Dark Background | #141A21 | Backgrounds, contrast |
| Cyan Accent | #00B8D9 | Blockchain elements, tech |
| Purple Highlight | #8E33FF | Secondary accent |
| White | #FFFFFF | Text, highlights |

### Visual Style
- **Aesthetic**: Professional crypto, glassmorphism, futuristic
- **Patterns**: Blockchain networks, connected nodes, tech grids
- **Gradients**: Orange-gold to dark, subtle glow effects
- **Mascot**: Golden Shiba Inu (friendly, professional)

### Image Types & Guidelines

| Type | Aspect | Resolution | Branding |
|------|--------|------------|----------|
| Marketing Banner | 16:9 | 1920x1080 | logo-watermark bottom-right |
| Social Post (Square) | 1:1 | 1080x1080 | text-footer with handles |
| Twitter Header | 3:1 | 1500x500 | logo-watermark |
| Announcement | 16:9 | 1920x1080 | logo-and-text |
| Meme/Casual | 1:1 | 1080x1080 | text-footer only |

### Prompt Template
```
"[Subject/Theme] for SHIBA CLASSIC cryptocurrency.
Style: Professional crypto marketing, modern glassmorphism.
Colors: Orange-gold gradient (#fda92d), dark background (#141A21),
        cyan blockchain patterns (#00B8D9), purple accents (#8E33FF).
Elements: [Blockchain networks / Shiba Inu mascot / Tech patterns]
Mood: [Professional / Celebratory / Informative / Urgent]
Text space: [Yes for overlays / No for clean]"
```

### Branding Options (imagen_apply_branding)
- `logo-watermark`: Small logo bottom-right (professional)
- `text-footer`: Social handles bar at bottom (@shibc_cto, shibaclassic.io)
- `logo-and-text`: Both logo and handles (major announcements)
- `none`: No branding (internal use only)

---

## 5. Implementation Steps

### Phase 1: Git Workflow (daemon.ts)
- [ ] Add `workspace.pull()` at start of `runLoop()`
- [ ] Ensure `commitAndPushDirect()` on every loop end
- [ ] Handle pull conflicts gracefully

### Phase 2: Directus Collection
- [ ] Create `shibc_images` collection in Directus
- [ ] Configure fields as specified above
- [ ] Set up permissions for API access

### Phase 3: Worker Integration
- [ ] Update imagen worker to upload to Directus after generation
- [ ] Create shibc_images record with draft status
- [ ] Include proper metadata (prompt, model, cost, tags)

### Phase 4: Qdrant Index
- [ ] Add image indexing to RAG system
- [ ] Implement image search before generation
- [ ] Add "existing image found" to CMO context

### Phase 5: CI Guidelines
- [ ] Add CI section to CMO profile
- [ ] Include color palette in imagen prompts
- [ ] Standardize branding across all generated images

---

## 6. Example Worker Flow

```
1. CMO Loop: "Create Christmas announcement banner"

2. Check Qdrant: "Do we have a Christmas banner?"
   -> Not found (or only drafts)

3. Spawn imagen worker:
   {
     "type": "spawn_worker",
     "task": "Generate Christmas banner with CI guidelines...",
     "servers": ["imagen", "filesystem", "directus"]
   }

4. Worker executes:
   a. imagen_check_quota()
   b. imagen_generate_image(prompt_with_CI)
   c. imagen_apply_branding("logo-watermark")
   d. filesystem_write("/app/workspace/images/christmas-2025.jpg")
   e. directus_upload_file(image_bytes)
   f. directus_create_item("shibc_images", {
        title: "Christmas 2025 Announcement",
        status: "draft",
        prompt_used: "...",
        model_used: "imagen-4.0-generate-001",
        ...
      })

5. Return result with Directus ID

6. Human reviews in Directus -> publishes

7. Published image indexed in Qdrant for future searches
```
