# SHIBC TypeScript API Template

Fastify-based REST API mit PostgreSQL, vollständig typisiert mit Zod-Validierung.

## Features

- Fastify 5.x mit TypeScript
- PostgreSQL + Drizzle ORM
- Zod Schema Validation
- OpenAPI/Swagger Documentation
- Docker Multi-Stage Build
- Woodpecker CI Pipeline
- Security Headers (Helmet)
- Rate Limiting
- Structured Logging (Pino)

## Quick Start

```bash
# Dependencies installieren
npm install

# Development Server starten
npm run dev

# Mit Docker Compose
docker compose up -d
```

## Environment Variables

```bash
# Server
PORT=3000
NODE_ENV=development
API_BASE_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://shibc:shibc@localhost:5432/shibc_api

# CORS
CORS_ORIGINS=http://localhost:3000

# Logging
LOG_LEVEL=info
```

## Scripts

| Script | Beschreibung |
|--------|-------------|
| `npm run dev` | Development mit Hot Reload |
| `npm run build` | Production Build |
| `npm run start` | Production Server starten |
| `npm run test` | Tests ausführen |
| `npm run test:coverage` | Tests mit Coverage |
| `npm run lint` | ESLint Check |
| `npm run typecheck` | TypeScript Check |
| `npm run db:migrate` | Migrations ausführen |
| `npm run db:generate` | Migrations generieren |

## Project Structure

```
src/
├── config/         # Configuration loaders
├── lib/            # Shared utilities
│   ├── db/         # Database access
│   └── logger.ts   # Pino logger
├── routes/         # API route handlers
│   ├── health.ts   # Health checks
│   └── api.ts      # Main API routes
├── services/       # Business logic
├── types/          # TypeScript types
└── index.ts        # Entry point
```

## API Documentation

Nach dem Start verfügbar unter: `http://localhost:3000/docs`

## Deployment

1. Build Docker Image:
   ```bash
   docker build -t shibc-api .
   ```

2. Deploy via Portainer Webhook oder Woodpecker CI

## CI/CD Pipeline

Die `.woodpecker.yml` enthält:
- Type Checking
- Linting
- Unit Tests
- Security Audit
- Docker Build
- Auto-Deploy zu Staging (develop) und Production (main)

## Security

- Helmet für Security Headers
- Rate Limiting (100 req/min)
- Input Validation mit Zod
- Secrets über Environment Variables
- Non-root Docker User

## License

MIT - Shiba Classic Project
