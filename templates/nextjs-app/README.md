# SHIBC Next.js App Template

Next.js 15 mit App Router, Tailwind CSS, und TypeScript.

## Features

- Next.js 15 App Router
- React 19 mit TypeScript
- Tailwind CSS
- Zustand State Management
- Vitest Unit Tests
- Playwright E2E Tests
- Docker Multi-Stage Build
- Woodpecker CI Pipeline
- Standalone Output für Container

## Quick Start

```bash
# Dependencies installieren
npm install

# Development Server starten
npm run dev
```

## Environment Variables

```bash
NEXT_PUBLIC_API_URL=http://localhost:8080
```

## Project Structure

```
src/
├── app/              # App Router pages
│   ├── api/          # API routes
│   ├── layout.tsx    # Root layout
│   └── page.tsx      # Homepage
├── components/       # React components
│   ├── ui/           # Base UI components
│   └── features/     # Feature components
├── lib/              # Utilities
└── store/            # Zustand stores
```

## Scripts

| Script | Beschreibung |
|--------|-------------|
| `npm run dev` | Development mit Hot Reload |
| `npm run build` | Production Build |
| `npm run start` | Production Server |
| `npm run test` | Unit Tests |
| `npm run test:e2e` | E2E Tests (Playwright) |
| `npm run lint` | ESLint Check |

## License

MIT - Shiba Classic Project
