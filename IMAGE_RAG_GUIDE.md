# Image RAG System - Complete Guide

## 🎯 Was ist Image-RAG?

**Retrieval-Augmented Generation für Bilder** - Ermöglicht visuelle Ähnlichkeitssuche und intelligentes Bild-Management durch:
- ✅ Vision Model Embeddings (LLaVA via Ollama)
- ✅ Vector Storage (Qdrant)
- ✅ Visuelle Ähnlichkeitssuche
- ✅ Text-to-Image Search
- ✅ Duplikat-Erkennung

---

## 🚀 Features

### 1. Visuelle Ähnlichkeitssuche
```typescript
import { searchSimilarImages } from './lib/image-rag.js';

// Finde Bilder, die diesem Bild ähnlich sind
const similar = await searchSimilarImages('./my-image.jpg', {
  limit: 5,
  filter: {
    eventType: 'price-milestone',
    minScore: 0.7  // Nur ähnliche Bilder (>70%)
  }
});

// Ergebnis:
// [
//   { metadata: {...}, score: 0.92, distance: 0.08 },
//   { metadata: {...}, score: 0.85, distance: 0.15 },
//   ...
// ]
```

### 2. Text-to-Image Search
```typescript
import { searchImagesByText } from './lib/image-rag.js';

// Finde Bilder basierend auf Textbeschreibung
const results = await searchImagesByText(
  'celebration with rockets and green charts',
  {
    limit: 10,
    filter: { agentRole: 'cmo' }
  }
);

// Findet z.B. alle "Price Up" Celebration Images
```

### 3. Automatisches Indexing
```typescript
import { indexImage, indexWorkspaceImages } from './lib/image-rag.js';

// Einzelnes Bild indexieren
await indexImage('./workspace/images/shibc-banner.jpg', {
  filepath: './workspace/images/shibc-banner.jpg',
  filename: 'shibc-banner.jpg',
  agentRole: 'cmo',
  template: 'marketing-banner',
  eventType: 'partnership',
  tags: ['official', 'announcement', 'premium'],
  description: 'Partnership announcement banner',
  brandingType: 'logo-and-text',
  createdAt: Date.now(),
});

// Alle Bilder im Workspace indexieren
const stats = await indexWorkspaceImages('./workspace');
// { indexed: 15, failed: 0, skipped: 3 }
```

---

## 🔧 Technische Details

### Vision Model: LLaVA (via Ollama)
- **Model:** `llava` (multimodal vision-language model)
- **Embedding Size:** 4096 dimensions
- **Capabilities:**
  - Image understanding
  - Text-to-image alignment
  - Visual feature extraction

### Vector Database: Qdrant
- **Collection:** `aito_images`
- **Distance Metric:** Cosine similarity
- **Indexing:** Optimized for 10k+ images

### Metadata Schema
```typescript
{
  filepath: string;       // Full path to image
  filename: string;       // Filename only
  agentRole: string;      // 'cmo', 'ceo', etc.
  template?: string;      // 'twitter-post', 'marketing-banner'
  eventType?: string;     // 'price-milestone', 'partnership'
  tags?: string[];        // ['celebration', 'official']
  description?: string;   // Human-readable description
  brandingType?: string;  // 'logo-watermark', 'text-footer'
  createdAt: number;      // Unix timestamp
  imageHash?: string;     // For duplicate detection
}
```

---

## 🔄 Integration mit Image Workflow

### Neuer Workflow mit RAG:

```
1. Agent will Bild erstellen
   ↓
2. ✅ Check Quota (Limit noch nicht erreicht?)
   ↓
3. 🔍 RAG: Search visually similar images
   - Input: Text description oder reference image
   - Output: Top 5 similar images mit scores
   ↓
4a. Score >0.85? → ✅ Reuse existing (sehr ähnlich)
4b. Score 0.70-0.85? → 💡 Show to agent for decision
4c. Score <0.70? → ❌ Generate new image
   ↓
5. 📝 Add Text Overlay
   ↓
6. 🎨 Add Branding
   ↓
7. 💾 Save Image
   ↓
8. 📊 Index in RAG + Update Quota
```

---

## 💡 Use Cases

### 1. Duplikat-Vermeidung
```typescript
// Vor Generierung: Prüfe ob ähnliches Bild schon existiert
const existing = await searchImagesByText(
  'SHIBC price celebration with green chart',
  { filter: { eventType: 'price-milestone' }, limit: 1 }
);

if (existing.length > 0 && existing[0].score > 0.85) {
  console.log('Very similar image exists, reusing...');
  return existing[0].metadata.filepath;
}
```

### 2. Style-Konsistenz
```typescript
// Finde Bilder im gleichen Visual Style
const styleReference = await searchSimilarImages('./reference-banner.jpg', {
  limit: 10,
  filter: { template: 'marketing-banner' }
});

// Nutze ähnliche Bilder als Style-Referenz für neue Generierung
```

### 3. Content-basierte Archiv-Suche
```typescript
// Agent: "Zeig mir alle Partnership Announcements"
const partnerships = await searchImagesByText('partnership announcement', {
  limit: 20,
  filter: { eventType: 'partnership' }
});

// Agent: "Finde alle grünen Chart Celebrations"
const celebrations = await searchImagesByText('green chart celebration rockets', {
  limit: 15,
  filter: { tags: ['celebration'] }
});
```

### 4. Duplicate Detection
```typescript
// Beim Upload: Prüfe ob Bild bereits existiert
const duplicates = await searchSimilarImages(newImagePath, {
  limit: 1,
  filter: { minScore: 0.95 }  // 95% ähnlich = wahrscheinlich Duplikat
});

if (duplicates.length > 0) {
  console.warn('Possible duplicate detected!');
}
```

---

## 📊 Performance

### Embedding Generation
- **Speed:** ~2-5 Sekunden pro Bild (je nach Größe)
- **Model Size:** ~4-5 GB (LLaVA)
- **GPU:** Empfohlen für Production

### Search Performance
- **Small DB (<1000 images):** <100ms
- **Medium DB (1000-10000 images):** <300ms
- **Large DB (>10000 images):** <500ms

### Storage
- **Embedding:** ~16 KB pro Bild (4096 dims × 4 bytes)
- **Metadata:** ~1-2 KB pro Bild
- **Total:** ~17-18 KB pro Bild in Qdrant

---

## 🔌 Setup

### 1. Install Ollama Vision Model
```bash
# Download LLaVA model
ollama pull llava

# Test it
ollama run llava "Describe this image" --image ./test.jpg
```

### 2. Initialize Qdrant Collection
```typescript
import { initImageCollection } from './lib/image-rag.js';

await initImageCollection();
// Creates 'aito_images' collection with 4096-dim vectors
```

### 3. Index Existing Images
```bash
npm run index-images
# Or via code:
```
```typescript
import { indexWorkspaceImages } from './lib/image-rag.js';

const stats = await indexWorkspaceImages();
console.log(`Indexed ${stats.indexed} images`);
```

---

## 🎯 Next Steps

### Integrate with Existing Systems

**1. Update `image-cache.ts`** to use RAG:
```typescript
// In checkExistingImage()
const ragResults = await searchImagesByText(description, {
  filter: { eventType, agentRole },
  limit: 5
});

if (ragResults.length > 0 && ragResults[0].score > 0.8) {
  return { exists: true, image: ragResults[0].metadata };
}
```

**2. Update `brand-image-generator.ts`** to auto-index:
```typescript
// After image generation
await indexImage(filepath, {
  ...metadata,
  createdAt: Date.now(),
});
```

**3. Add to Agent Workflows:**
```typescript
// CMO Agent before generating:
const similar = await searchImagesByText(
  'SHIBC price up celebration',
  { filter: { agentRole: 'cmo', eventType: 'price-milestone' } }
);

if (similar.length > 0) {
  console.log(`Found ${similar.length} similar images, reusing best match`);
}
```

---

## 🚨 Important Notes

1. **GPU Recommended:** Vision models work best with GPU
2. **First Run is Slow:** Ollama downloads model (~5GB)
3. **Storage:** Plan for ~18KB per image in Qdrant
4. **Indexing:** Can be done async in background
5. **Updates:** Re-index if image metadata changes

---

## 📈 Benefits

✅ **Kosten-Sparend:** Vermeidet doppelte Generierungen
✅ **Intelligent:** Findet ähnliche Bilder automatisch
✅ **Schnell:** Vector search in <500ms
✅ **Flexibel:** Text- oder Bild-basierte Suche
✅ **Skalierbar:** Wächst mit Bild-Archiv

---

## 🔗 Resources

- Ollama LLaVA: https://ollama.ai/library/llava
- Qdrant Docs: https://qdrant.tech/documentation/
- CLIP Paper: https://arxiv.org/abs/2103.00020
