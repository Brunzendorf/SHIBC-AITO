# TASK-070: C-Level Manager Profilbilder

**Status:** IN PROGRESS
**Priorität:** HIGH
**Erstellt:** 2025-12-24
**Assignee:** Designer Agent / Manual

---

## Ziel

Professionelle, konsistente Profilbilder für alle 6 C-Level Manager erstellen.
Einheitliches "Corporate Shooting" Konzept mit 5 Bildern pro Person in verschiedenen Situationen.

---

## Technologie-Entscheidung

### Gewählt: **Gemini 2.5 Flash Image (Nano Banana Pro)**

**Warum:**
- Character Consistency für bis zu 5 Personen gleichzeitig
- Bis zu 14 Reference Images möglich
- Speziell für Storytelling und Branding optimiert
- "Character DNA" bleibt über mehrere Generierungen erhalten

**Quellen:**
- [Google Developers Blog - Gemini 2.5 Flash Image](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/)
- [Towards Data Science - Consistent Imagery with Gemini](https://towardsdatascience.com/generating-consistent-imagery-with-gemini/)
- [Character Consistency Guide](https://aifacefy.com/blog/detail/How-to-Generate-Consistent-Characters-with-Nano-Banana-Gemini-2-5-Flash-f04e03416688/)

---

## C-Level Manager Charaktere

| Role | Name | Gender | Ethnicity | Style | Alter |
|------|------|--------|-----------|-------|-------|
| **CEO** | Marcus Chen | Male | Mixed (Asian-European) | Authoritative, Visionary | 45-50 |
| **CFO** | Dr. Sarah Goldstein | Female | European | Precise, Analytical | 40-45 |
| **CMO** | Yuki Tanaka | Female | Asian (Japanese) | Elegant, Model-like | 30-35 |
| **CTO** | Viktor "Vik" Kowalski | Male | Eastern European | Creative, Eccentric | 35-40 |
| **COO** | James Wilson | Male | African-American | Calm, Organized | 45-50 |
| **CCO** | Elena Vasquez | Female | Hispanic | Professional, Sharp | 40-45 |

**Gender Balance:** 3 Male, 3 Female

---

## Shooting-Konzept: "The Boardroom Series"

Einheitlicher Look für alle Manager:
- **Lighting:** Soft, professional studio lighting
- **Background:** Clean, modern office / neutral gradient
- **Style:** Corporate but approachable, slight Shiba Classic branding (subtle orange accents)
- **Resolution:** 1024x1024 (portrait format)

---

## 5 Szenarien pro Person

| # | Szenario | Beschreibung | Outfit |
|---|----------|--------------|--------|
| 1 | **Headshot** | Klassisches Profilbild, direkter Blickkontakt | Business formal |
| 2 | **At Work** | Am Schreibtisch/Computer, konzentriert | Business casual |
| 3 | **Presentation** | Vor Whiteboard/Screen, erklärend | Business formal |
| 4 | **Team Meeting** | Im Gespräch, freundlich, nahbar | Smart casual |
| 5 | **Casual Friday** | Entspannt, mit Kaffee/Laptop | Casual with branded element |

---

## Workflow

### Phase 1: Character DNA erstellen (Pro Person)
```
1. Generiere "Hero Image" mit detailliertem Prompt
2. Verfeinere bis Charakter perfekt ist
3. Speichere als Reference Image
4. Teste Konsistenz mit 2-3 Variationen
```

### Phase 2: Szenarien generieren
```
1. Lade Reference Image
2. Generiere Szenario 1-5 mit Reference
3. Qualitätskontrolle (Face Match)
4. Regeneriere bei Inkonsistenz
```

### Phase 3: Post-Processing
```
1. Einheitliche Farbkorrektur
2. Subtle Shiba Classic Branding (optional)
3. Resize/Crop für verschiedene Formate
```

### Phase 4: Telegram Posting
```
1. Pro Manager: 1 Post mit allen 5 Bildern
2. Caption mit Name, Rolle, kurze Bio
3. Hashtags: #SHIBC #AITeam #Leadership
```

---

## Prompt Templates

### Base Character Prompt (Example: CMO)
```
Professional corporate portrait photo of Yuki Tanaka, 32 years old,
Japanese woman, elegant model-like appearance, high cheekbones,
long black hair styled professionally, warm brown eyes,
confident subtle smile, wearing navy blue blazer with subtle
orange pocket square (Shiba Classic brand color),
soft professional studio lighting, clean gradient background,
8k quality, photorealistic, magazine cover quality
```

### Scenario Variation (Example: At Work)
```
[Use reference image of Yuki Tanaka]
Same person at modern minimalist desk, working on MacBook Pro,
focused expression, hair slightly different angle,
natural office lighting from window, wearing white silk blouse,
coffee cup visible, contemporary office background,
maintain exact facial features from reference
```

---

## Telegram Post Format

```markdown
🎯 **Meet Our CMO**

**Yuki Tanaka** | Chief Marketing Officer
@YukiTanaka_SHIBC

📍 Tokyo → Crypto World
🎓 Waseda University, MBA Stanford
💼 Ex-Head of Marketing at Binance Japan

"Building bridges between traditional finance and DeFi,
one community at a time."

🔸 Brand Strategy
🔸 Community Growth
🔸 Global Partnerships

#SHIBC #AITeam #Leadership #CMO
```

---

## Deliverables

- [ ] 6 Character Reference Images (DNA)
- [ ] 30 Szenario-Bilder (6 x 5)
- [ ] 6 Telegram Posts (gepostet)
- [ ] Bilder im Workspace gespeichert: `/workspace/assets/team/`

---

## API/Tool Requirements

### Aktueller Stand: imagen-mcp v1.1.0
Unser imagen-mcp Server unterstützt:
- `imagen-4.0-generate-001` ($0.04/image)
- `gemini-2.5-flash-image` (kostenlos!)

**Problem:** Keine Reference Image Unterstützung für Character Consistency.

### Lösung: imagen-mcp v1.2.0 Erweiterung (TASK-070a)

```typescript
// Neues Tool: imagen_generate_with_reference
{
  name: 'imagen_generate_with_reference',
  description: 'Generate image with character consistency using reference image',
  inputSchema: {
    properties: {
      prompt: { type: 'string' },
      referenceImageBase64: { type: 'string', description: 'Reference image for character consistency' },
      referenceStrength: { type: 'number', description: '0.0-1.0, how closely to match reference' },
      // ... other params
    }
  }
}
```

### Gemini API für Reference Images
```typescript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Generate with reference image (Gemini 2.0 Flash)
const result = await ai.models.generateContent({
  model: 'gemini-2.0-flash-exp',
  contents: [
    {
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: referenceImageBase64 } },
        { text: 'Generate a new image of this same person in a different setting: ...' }
      ]
    }
  ],
  generationConfig: {
    responseModalities: ['image', 'text']
  }
});
```

### Alternativer Workflow (ohne Code-Änderung)

**AI Studio manuell:**
1. https://aistudio.google.com/
2. Gemini 2.0 Flash mit Image Upload
3. Prompt: "Keep the exact same person, change setting to..."
4. Download und via imagen-mcp branding hinzufügen

---

## Zeitplan

| Phase | Dauer | Status |
|-------|-------|--------|
| Character DNA (6x) | 2-3h | PENDING |
| Szenarien (30x) | 4-6h | PENDING |
| QA & Fixes | 1-2h | PENDING |
| Telegram Posts | 1h | PENDING |
| **Gesamt** | ~10h | PENDING |

---

## Notizen

- CTO Viktor soll "verrückt" aussehen: wilde Frisur, bunte Socken sichtbar,
  vielleicht Kopfhörer um den Hals, Energie-Drink statt Kaffee
- CMO Yuki: Eleganz ist Key, könnte auf Fashion Week sein
- CEO Marcus: Der "Vater" der Gruppe, weise aber nahbar
- Alle tragen subtile Orange-Akzente (Shiba Classic Brand Color)

---

## Related Tasks

- TASK-071: Team Page auf Website (nutzt diese Bilder)
- TASK-072: Social Media Avatars (Cropped Headshots)
