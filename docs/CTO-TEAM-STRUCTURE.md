# CTO Team Structure - Complete Agent Roles

## Status: PLANNING - 2025-12-23

> **Basierend auf:** Industry Best Practices für DevOps & Agile Teams
>
> **Quellen:**
> - [Splunk: DevOps Roles and Responsibilities](https://www.splunk.com/en_us/blog/learn/devops-roles-responsibilities.html)
> - [Atlassian: Agile Scrum Roles](https://www.atlassian.com/agile/scrum/roles)
> - [Vention: DevOps Team Guide](https://ventionteams.com/blog/devops-team)
> - [ClickIT: DevOps Team 2026](https://www.clickittech.com/devops/devops-team/)
> - [Microsoft: Playwright MCP](https://github.com/microsoft/playwright-mcp)

---

## Team Übersicht

```
                              ┌─────────────────┐
                              │       CTO       │
                              │  SHIBC-CTO-001  │
                              │  (Team Lead)    │
                              └────────┬────────┘
                                       │
       ┌───────────────────────────────┼───────────────────────────────┐
       │                               │                               │
┌──────┴──────┐                ┌───────┴───────┐               ┌───────┴───────┐
│  PLANNING   │                │  DEVELOPMENT  │               │  OPERATIONS   │
└──────┬──────┘                └───────┬───────┘               └───────┬───────┘
       │                               │                               │
┌──────┴──────┐                ┌───────┴───────┐               ┌───────┴───────┐
│ Architect   │                │  Developer    │               │    DevOps     │
│ CTO-ARCH-01 │                │  CTO-DEV-01   │               │  CTO-OPS-01   │
└─────────────┘                └───────┬───────┘               └───────┬───────┘
                                       │                               │
                               ┌───────┴───────┐               ┌───────┴───────┐
                               │   Frontend    │               │     SRE       │
                               │  CTO-FE-01    │               │  CTO-SRE-01   │
                               └───────────────┘               └───────────────┘

       ┌───────────────────────────────┼───────────────────────────────┐
       │                               │                               │
┌──────┴──────┐                ┌───────┴───────┐               ┌───────┴───────┐
│   QUALITY   │                │   SECURITY    │               │  COORDINATION │
└──────┬──────┘                └───────┬───────┘               └───────┬───────┘
       │                               │                               │
┌──────┴──────┐                ┌───────┴───────┐               ┌───────┴───────┐
│     QA      │                │   SecOps      │               │Release Manager│
│  CTO-QA-01  │                │  CTO-SEC-01   │               │  CTO-RM-01    │
└─────────────┘                └───────────────┘               └───────────────┘
```

---

## Alle Agent Rollen im Detail

### 1. Software Architect (CTO-ARCH-01)

**Codename:** SHIBC-ARCH-001
**Reports To:** CTO
**Mission:** System Design und technische Entscheidungen

#### Responsibilities
- Requirements in technische Spezifikationen übersetzen
- System-Architektur designen (Microservices, Monolith, etc.)
- Tech Stack Entscheidungen treffen
- API Design (REST, GraphQL, gRPC)
- Datenbank-Schema Design
- Architecture Decision Records (ADRs) dokumentieren
- Technische Machbarkeit bewerten
- Performance-Anforderungen definieren

#### MCP Server
| Server | Verwendung |
|--------|------------|
| `filesystem` | Architektur-Dokumente schreiben |
| `github` | ADRs, Design Docs |
| `qdrant` | Ähnliche Architekturen finden |
| `fetch` | Tech Research |

#### Decision Authority
- **Alleine:** Tech Stack für kleine Projekte, Library-Auswahl
- **Mit CTO:** Größere Architektur-Entscheidungen, neue Frameworks
- **Mit CEO:** Breaking Changes, Major Refactoring

---

### 2. Backend Developer (CTO-DEV-01)

**Codename:** SHIBC-DEV-001
**Reports To:** Architect / CTO
**Mission:** Server-seitige Implementation

#### Responsibilities
- Backend Code schreiben (APIs, Services, Workers)
- Unit Tests implementieren
- Database Queries optimieren
- API Endpoints implementieren
- Integrations mit externen Services
- Code Reviews (für andere Developer)
- Dokumentation schreiben

#### MCP Server
| Server | Verwendung |
|--------|------------|
| `github` | Repos, PRs, Commits |
| `git` | Lokale Git Operationen |
| `filesystem` | Code schreiben |
| `shell` | npm, build, test |
| `woodpecker` | Build Status prüfen |

#### Tech Stack Expertise
- TypeScript / Node.js
- Fastify / Express
- PostgreSQL / Redis
- Docker
- REST API Design

---

### 3. Frontend Developer (CTO-FE-01)

**Codename:** SHIBC-FE-001
**Reports To:** Developer / CTO
**Mission:** Client-seitige Implementation

#### Responsibilities
- Frontend Code schreiben (React, Next.js)
- UI Components entwickeln
- State Management implementieren
- API Integration
- Responsive Design
- Accessibility (a11y)
- Performance Optimization (Core Web Vitals)

#### MCP Server
| Server | Verwendung |
|--------|------------|
| `github` | Repos, PRs |
| `git` | Lokale Git Operationen |
| `filesystem` | Code schreiben |
| `shell` | npm, build |
| `playwright` | E2E Tests, Visual Testing |

#### Tech Stack Expertise
- TypeScript / React
- Next.js (App Router)
- MUI / Tailwind CSS
- State Management (Zustand, React Query)

---

### 4. DevOps Engineer (CTO-OPS-01)

**Codename:** SHIBC-OPS-001
**Reports To:** CTO
**Mission:** Infrastructure und Deployment Automation

> *"DevOps engineers integrate development and IT operations to reduce development
> time and make software delivery more efficient."*
> — [Splunk DevOps Guide](https://www.splunk.com/en_us/blog/learn/devops-roles-responsibilities.html)

#### Responsibilities
- CI/CD Pipeline Setup (Woodpecker)
- Container Orchestration (Portainer)
- Infrastructure as Code
- Subdomain/DNS Konfiguration
- SSL-Zertifikate (Let's Encrypt)
- nginx Reverse Proxy
- Monitoring Setup
- Backup Automation

#### MCP Server
| Server | Verwendung |
|--------|------------|
| `portainer` | Container Management |
| `woodpecker` | CI/CD Pipelines |
| `nginx` | Reverse Proxy Config |
| `certbot` | SSL Zertifikate |
| `dns` | Subdomain Management |
| `n8n` | Automation Workflows |
| `shell` | System Commands |

#### Key Metrics
- Deployment Frequency
- Lead Time for Changes
- Change Failure Rate
- Mean Time to Recovery (MTTR)

---

### 5. Site Reliability Engineer (CTO-SRE-01)

**Codename:** SHIBC-SRE-001
**Reports To:** DevOps / CTO
**Mission:** System Reliability und Incident Response

> *"SRE engineers automate log analysis, testing production environments,
> and incident response. They monitor and measure system reliability."*
> — [DevOps Roles](https://ventionteams.com/blog/devops-team)

#### Responsibilities
- Monitoring und Alerting
- Incident Response
- Performance Optimization
- Capacity Planning
- SLI/SLO/SLA Definition
- Error Budget Management
- Post-Mortem Analysis
- On-Call Rotation

#### MCP Server
| Server | Verwendung |
|--------|------------|
| `portainer` | Container Health |
| `fetch` | Health Checks |
| `n8n` | Alert Workflows |
| `qdrant` | Error Pattern Analysis |
| `github` | Incident Issues |

#### Key Metrics
- Uptime (SLO: 99.9%)
- Error Rate
- Latency (p50, p95, p99)
- MTTR (Mean Time to Recovery)

---

### 6. QA Engineer (CTO-QA-01)

**Codename:** SHIBC-QA-001
**Reports To:** CTO
**Mission:** Qualitätssicherung und Testing

> *"The Experience Assurance Expert is responsible for creating a smooth
> user experience. Think of the XA as an advocate for the customer."*
> — [PagerDuty DevOps Roles](https://www.pagerduty.com/resources/devops/learn/essential-devops-roles/)

#### Responsibilities
- Test Strategy entwickeln
- Unit/Integration/E2E Tests schreiben
- Code Reviews (Qualitätsperspektive)
- Test Coverage sicherstellen (min. 80%)
- Performance Testing
- Accessibility Testing
- Bug Reports erstellen
- Regression Testing

#### MCP Server
| Server | Verwendung |
|--------|------------|
| `playwright` | **Browser Testing** (KRITISCH!) |
| `puppeteer` | Alternative Browser Automation |
| `woodpecker` | Test Pipeline triggern |
| `github` | Bug Issues erstellen |
| `filesystem` | Test Reports lesen |
| `shell` | Tests ausführen |

#### Browser Testing Tools

**Playwright MCP (Microsoft Official)**
```json
{
  "playwright": {
    "command": "npx",
    "args": ["-y", "@anthropic-ai/mcp-server-playwright", "--headless"],
    "description": "Browser automation for testing"
  }
}
```
> *"Playwright MCP enables LLMs to interact with web pages through structured
> accessibility snapshots, bypassing the need for screenshots."*
> — [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp)

**Puppeteer MCP (Anthropic Official)**
```json
{
  "puppeteer": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
    "description": "Browser automation and screenshots"
  }
}
```
> — [NPM: server-puppeteer](https://www.npmjs.com/package/@modelcontextprotocol/server-puppeteer)

#### Test Types
| Test Type | Tool | Coverage |
|-----------|------|----------|
| Unit Tests | Vitest | 80%+ |
| Integration | Vitest + Supertest | 70%+ |
| E2E | Playwright | Critical Paths |
| Visual | Playwright Screenshots | UI Components |
| Accessibility | Playwright a11y | WCAG 2.1 AA |
| Performance | Lighthouse | Core Web Vitals |

---

### 7. Security Engineer (CTO-SEC-01)

**Codename:** SHIBC-SEC-001
**Reports To:** CTO
**Mission:** Security und Compliance

> *"Security is number one among top IT investment priorities.
> DevOps teams bake security into their workflows (DevSecOps)."*
> — [GitLab DevSecOps Report 2024](https://www.splunk.com/en_us/blog/learn/devops-roles-responsibilities.html)

#### Responsibilities
- Security Code Reviews
- Dependency Audits (npm audit, Snyk)
- OWASP Top 10 Checks
- Secret Scanning
- Penetration Test Koordination
- Security Incident Response
- Vulnerability Management
- Compliance (GDPR, etc.)

#### MCP Server
| Server | Verwendung |
|--------|------------|
| `woodpecker` | Security Pipeline |
| `github` | Security Issues |
| `shell` | npm audit, security tools |
| `qdrant` | Vulnerability Patterns |
| `fetch` | CVE Database |

#### Security Checks
| Check | Tool | Frequency |
|-------|------|-----------|
| Dependency Audit | npm audit | Every Build |
| Secret Scanning | gitleaks | Every Commit |
| SAST | ESLint Security | Every PR |
| Container Scan | Trivy | Every Image |
| DAST | OWASP ZAP | Weekly |

---

### 8. Release Manager (CTO-RM-01)

**Codename:** SHIBC-RM-001
**Reports To:** CTO
**Mission:** Release Coordination und Deployment

> *"The Code Release Manager must have the technical knowledge to run
> and maintain the process of product and application development and delivery."*
> — [Splunk DevOps Roles](https://www.splunk.com/en_us/blog/learn/devops-roles-responsibilities.html)

#### Responsibilities
- Release Planning
- Version Management (SemVer)
- Changelog Maintenance
- Deployment Coordination
- Rollback Decisions
- Hotfix Coordination
- Feature Flags Management
- Release Notes

#### MCP Server
| Server | Verwendung |
|--------|------------|
| `github` | Releases, Tags |
| `woodpecker` | Deploy Pipelines |
| `portainer` | Deployment Status |
| `n8n` | Release Workflows |

#### Release Process
```
1. Feature Complete → QA Sign-off
2. Create Release Branch (release/v1.2.0)
3. Run Full Test Suite
4. Security Scan
5. Deploy to Staging
6. Smoke Tests
7. CEO/CTO Approval
8. Deploy to Production
9. Monitor for 24h
10. Tag Release in Git
```

---

## Agile/Scrum Integration

### Scrum Roles Mapping

> *"A Scrum team consists of three core roles: product owner,
> Scrum master, and development team."*
> — [Atlassian Scrum Roles](https://www.atlassian.com/agile/scrum/roles)

| Scrum Role | AITO Agent | Responsibilities |
|------------|------------|------------------|
| **Product Owner** | CEO | Requirements, Prioritization |
| **Scrum Master** | CTO | Process, Blockers, Coordination |
| **Development Team** | All CTO Sub-Agents | Implementation |

### Sprint Workflow

```
1. Sprint Planning (CEO + CTO)
   └─► CEO definiert User Stories
   └─► CTO schätzt Aufwand
   └─► Architect erstellt technische Tasks

2. Sprint Execution (CTO Team)
   └─► Developer implementieren
   └─► QA testet kontinuierlich
   └─► DevOps deployt zu DEV

3. Sprint Review (Alle)
   └─► Demo der Features
   └─► Feedback sammeln

4. Sprint Retrospective (CTO Team)
   └─► Was lief gut/schlecht?
   └─► Verbesserungen identifizieren
```

---

## Browser Testing MCP - Details

### Warum Browser Testing kritisch ist

Der QA Agent muss:
1. Deployments verifizieren (ist die Website erreichbar?)
2. UI-Funktionen testen (Login, Formulare, etc.)
3. Visual Regression erkennen
4. Accessibility prüfen
5. Performance messen

### Playwright MCP (Empfohlen)

```json
{
  "playwright": {
    "command": "npx",
    "args": [
      "-y",
      "@anthropic-ai/mcp-server-playwright",
      "--headless"
    ],
    "env": {
      "PLAYWRIGHT_BROWSERS_PATH": "/app/browsers"
    }
  }
}
```

**Tools verfügbar:**
- `playwright_navigate` - URL öffnen
- `playwright_screenshot` - Screenshot machen
- `playwright_click` - Element klicken
- `playwright_fill` - Formular ausfüllen
- `playwright_get_text` - Text extrahieren
- `playwright_wait` - Auf Element warten
- `playwright_evaluate` - JavaScript ausführen

**Beispiel: Deployment Verification**
```json
{
  "type": "spawn_worker",
  "task": "Verify deployment of treasury-bot.shibaclassic.io: 1. Navigate to URL 2. Check if page loads 3. Take screenshot 4. Verify expected text 'Treasury Bot' exists",
  "servers": ["playwright"],
  "timeout": 60000
}
```

### Puppeteer MCP (Alternative)

```json
{
  "puppeteer": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
  }
}
```

**Tools verfügbar:**
- `puppeteer_navigate` - Navigate to URL
- `puppeteer_screenshot` - Capture page screenshot
- `puppeteer_click` - Click element
- `puppeteer_fill` - Fill input field
- `puppeteer_select` - Select dropdown option
- `puppeteer_hover` - Hover over element
- `puppeteer_evaluate` - Execute JavaScript

---

## Vollständige MCP Server Liste (Updated)

### Bereits vorhanden
| MCP | Status | Beschreibung |
|-----|--------|--------------|
| `telegram` | ✅ | Bot API |
| `fetch` | ✅ | HTTP Requests |
| `filesystem` | ✅ | Dateizugriff |
| `directus` | ✅ | CMS |
| `etherscan` | ✅ | Blockchain |
| `imagen` | ✅ | Bildgenerierung |

### Neu benötigt - KRITISCH
| MCP | Prio | Aufwand | Beschreibung |
|-----|------|---------|--------------|
| `portainer` | 🔴 | 24h | Container Management |
| `woodpecker` | 🔴 | 24h | CI/CD Pipelines |
| `github` | 🔴 | 8h | NPM Package (API) |
| `git` | 🔴 | 16h | Lokale Git Ops |
| `shell` | 🔴 | 16h | Command Execution |
| `playwright` | 🔴 | 4h | Browser Testing (NPM!) |

### Neu benötigt - HOCH
| MCP | Prio | Aufwand | Beschreibung |
|-----|------|---------|--------------|
| `nginx` | 🟠 | 16h | Reverse Proxy |
| `certbot` | 🟠 | 8h | SSL Certs |
| `qdrant` | 🟠 | 16h | Vector Search |
| `n8n` | 🟠 | 16h | Workflows |

### Neu benötigt - MITTEL
| MCP | Prio | Aufwand | Beschreibung |
|-----|------|---------|--------------|
| `dns` | 🟡 | 8h | DNS Management |
| `puppeteer` | 🟡 | 4h | Alternative Browser (NPM!) |
| `postgres` | 🟡 | 8h | DB Management |

---

## Agent Profile Templates

Alle Sub-Agent Profiles folgen dem gleichen Schema wie die C-Level Agents:

```markdown
# [Role] Agent Profile

> **INHERITS FROM:** [base.md](./base.md)

## Identity
**Role:** [Title]
**Codename:** SHIBC-[CODE]-001
**Department:** Technology (CTO Team)
**Reports To:** CTO Agent

## Mission Statement
[Clear mission in 2-3 sentences]

## Core Responsibilities
[5-8 main responsibilities]

## Decision Authority
### Kann alleine entscheiden
### Braucht CTO Approval
### Braucht CEO Approval

## MCP Server
[Table of available servers]

## Loop Schedule
[When/how often does this agent run]

## Key Metrics
[What does this agent measure]
```

---

## Nächste Schritte

1. **Profile erstellen** für jeden Sub-Agent
2. **MCP Server** implementieren (Playwright ist NPM ready!)
3. **Coding Guidelines** Dokument finalisieren
4. **TASK-BACKLOG** mit allen Tasks erweitern
5. **Integration Test** - Ein komplettes Projekt durchspielen

---

## Zusammenfassung

| Agent | Hauptaufgabe | Kritische MCPs |
|-------|--------------|----------------|
| Architect | Design | qdrant, github |
| Developer | Code | git, github, shell |
| Frontend | UI | git, playwright |
| DevOps | Infra | portainer, woodpecker, nginx |
| SRE | Reliability | portainer, n8n |
| QA | Testing | **playwright**, woodpecker |
| Security | SecOps | shell, woodpecker |
| Release Mgr | Releases | github, portainer |

**Total: 8 Sub-Agents + CTO als Lead = 9 Agents für vollständige Autonomie**
