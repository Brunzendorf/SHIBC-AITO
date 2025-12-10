# Container Management Architecture

## Decision Record: Portainer API statt Docker Socket

**Datum:** 2025-12-10
**Status:** Accepted

### Kontext

Der AITO Orchestrator muss Agent-Container on-demand starten/stoppen um Ressourcen zu sparen. Initial war geplant, den Docker Socket (`/var/run/docker.sock`) direkt zu mounten.

### Problem

Docker Socket Mounting hat mehrere Probleme:

1. **Permission Issues (Docker Desktop 4.28+)**
   - Enhanced Container Isolation (ECI) blockiert Socket-Zugriff
   - Socket ownership: `root:root` statt `root:docker`
   - Non-root Container können nicht zugreifen

2. **Security Risks**
   - Docker Socket = Root-Zugriff auf Host
   - Container Escape möglich
   - Nicht empfohlen für Production

3. **Plattform-Unterschiede**
   - Windows: `/var/run/docker.sock` funktioniert anders
   - macOS: Permissions anders als Linux
   - Nicht portabel

### Lösung: Portainer REST API

Statt direktem Docker Socket Zugriff nutzen wir die **Portainer API**:

```
┌─────────────────────────────────────────────────────────────────┐
│                         PORTAINER                                │
│                    (CE oder BE Edition)                          │
│                      REST API Port 9443                          │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS + API Key
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR                                │
│   - HTTP Calls statt Docker Socket                              │
│   - API Key Authentication                                       │
│   - Container Start/Stop/Status via REST                        │
└─────────────────────────────────────────────────────────────────┘
```

### API Endpoints

```bash
# Authentication
POST /api/auth
{"Username": "admin", "Password": "xxx"}
# Returns: {"jwt": "eyJ..."}

# Oder mit API Key (empfohlen):
X-API-Key: ptr_xxxxxxxxxxxx

# Container auflisten
GET /api/endpoints/{envId}/docker/containers/json?all=true

# Container starten
POST /api/endpoints/{envId}/docker/containers/{id}/start

# Container stoppen
POST /api/endpoints/{envId}/docker/containers/{id}/stop

# Container erstellen
POST /api/endpoints/{envId}/docker/containers/create
```

### Vorteile

| Aspekt | Docker Socket | Portainer API |
|--------|--------------|---------------|
| Security | Root-Zugriff nötig | API Key (rotierbar) |
| Windows | Permission Issues | ✅ Funktioniert |
| macOS | Permission Issues | ✅ Funktioniert |
| Linux Server | Funktioniert | ✅ Funktioniert |
| Audit Log | Selbst bauen | ✅ Built-in |
| UI | Selbst bauen | ✅ Gratis dabei |
| RBAC | Nicht möglich | ✅ (BE Edition) |

### Konfiguration

```env
# .env
PORTAINER_URL=https://localhost:9443
PORTAINER_API_KEY=ptr_xxxxxxxxxxxxxxxxxxxxxx
PORTAINER_ENV_ID=2
```

### Lokale Entwicklung

Portainer als Container starten:

```bash
# Portainer CE lokal starten
docker volume create portainer_data

docker run -d \
  --name portainer \
  --restart=unless-stopped \
  -p 9000:9000 \
  -p 9443:9443 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:latest

# Öffne https://localhost:9443
# Erstelle Admin Account
# Generiere API Key: User Settings > Access Tokens > Add
```

### Production (Server)

Portainer ist bereits auf dem Plesk Server installiert. Nur API Key generieren:

1. Login: https://portainer.shibaclassic.io
2. User Settings > Access Tokens
3. "Add access token" > Copy Key
4. In `.env` eintragen

### Fallback ohne Portainer

Für Unit Tests und CI/CD wo kein Portainer verfügbar ist:

```typescript
// container.ts
if (!config.PORTAINER_URL) {
  logger.warn('No Portainer URL configured - container management disabled');
  return { mock: true };
}
```

### Referenzen

- [Portainer API Documentation](https://docs.portainer.io/api/docs)
- [Portainer API Examples](https://docs.portainer.io/api/examples)
- [Docker Desktop ECI](https://www.docker.com/blog/docker-desktop-4-29/)
- [GitHub Issue #13969](https://github.com/docker/for-win/issues/13969)
