# Project Plan

**Status**: Integrating
**Created**: 2026-07-21
**Mode**: NEW

---

## 1. Project Overview

**Goal**: A shared photo scrapbook app where users pair with another individual and share special moments via photos with AI-generated labels, plus a background cleanup worker for retention-based photo deletion. The project is designed so that every module is independently testable.

**App Type**: SPA + API

**Mode**: NEW

**Deployment Plan**: No deployment plan found

---

## 2. Backend — Scrapbook API

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Runtime** | Node |
| **Package Manager** | npm |
| **Test Runner** | vitest |
| **Mocking Library** | vi.mock |
| **Test Command** | npm test |
| **Orchestration** | docker-compose |

---

## 3. Frontend — Scrapbook Web

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Framework** | React + Vite |
| **Package Manager** | npm |
| **Test Runner** | vitest |
| **Mocking Library** | vi.mock |
| **Test Command** | npm test |

---

## 4. Worker — Cleanup Worker

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript |
| **Runtime** | Node |
| **Package Manager** | npm |
| **Test Runner** | vitest |
| **Mocking Library** | vi.mock |
| **Test Command** | npm test |
| **Orchestration** | docker-compose |

---

## 5. Services Required

| Azure Service | Role in App | Environment Variable | Default Value (Local) | Classification |
|---------------|------------|---------------------|----------------------|----------------|
| Blob Storage | Store uploaded photos and serve images | STORAGE_CONNECTION_STRING | UseDevelopmentStorage=true | Essential |
| PostgreSQL | Primary data store for user pairs, photo metadata, and retention policies | DATABASE_URL | postgresql://localdev:localdevpassword@localhost:5432/scrapbookdb | Essential |

---

## 6. Prerequisites

### Run

| Tool | Service(s) | Installed | Version | Install |
|------|-----------|-----------|---------|---------|
| Node.js | * | ✅ | v24.18.0 | `brew install node` |
| npm | * | ✅ | 11.16.0 | Bundled with Node.js |
| Azure Functions Core Tools | scrapbook-api, cleanup-worker | ✅ | 4.12.1 | `brew install azure-functions-core-tools@4` |

### Debug

| Tool | Service(s) | Installed | Version | Install |
|------|-----------|-----------|---------|---------|
| Docker | scrapbook-api, cleanup-worker | ✅ | 29.3.1 | https://docs.docker.com/desktop/install/mac-install/ |
| Docker Compose | scrapbook-api, cleanup-worker | ❓ | — | Bundled with Docker Desktop |
| Chrome | scrapbook-web | ✅ | — | https://www.google.com/chrome/ |
| `ms-azuretools.vscode-azurefunctions` | scrapbook-api, cleanup-worker | ❓ | — | Install from VS Code Marketplace |

---

## 7. Design System & UI

**Component Library**: Fluent UI v9
**Style Direction**: Warm, friendly photo-sharing app with soft shadows, rounded 12px corners, and emphasis on photo content — approachable and intimate for personal scrapbook moments.
**Typography**: Inter, system-ui

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#E06B50` | Warm coral — primary buttons, active nav, upload CTA |
| `accent`  | `#6C63FF` | Soft violet — AI-generated label badges, magic features |
| `surface` | `#FDFBF9` | Warm off-white page and card backgrounds |
| `text`    | `#2D2A26` | Warm dark body text and headings |
| `muted`   | `#8C8680` | Photo captions, timestamps, secondary text |
| `border`  | `#E8E3DE` | Card borders, dividers, input outlines |

### Pages

| Page | Route | Purpose | Layout |
|------|-------|---------|--------|
| Scrapbook | `/` | Shared photo gallery with AI-generated labels — the main feed | `header, nav, grid` |
| Upload | `/upload` | Capture and upload a photo with optional caption | `header, nav, form, action-bar` |
| Pairing | `/pairing` | Pair with another person to start sharing moments | `header, nav, hero, card-list` |
| Timeline | `/timeline` | Chronological view of shared memories by date | `header, nav, list` |

### Sample Content

Scrapbook — photos:
| Photo | AI Label | Uploaded by | Date |
| Beach sunset golden hour | Golden Hour, Beach | Alex | Jul 15, 2026 |
| Coffee shop morning ritual | Morning Coffee, Ritual | Jordan | Jul 14, 2026 |
| Park autumn leaves walk | Autumn Walk, Nature | Alex | Jul 12, 2026 |
| Kitchen cookie baking together | Baking Day, Together | Jordan | Jul 10, 2026 |
| Rooftop city view night | City Lights, Night | Alex | Jul 8, 2026 |

Upload — fields: Photo file · Caption (optional) · Date (auto-detected)

Pairing — pairs:
| Pair Name | Partner | Status | Since |
| Our Adventures | Jordan | Connected | Jan 2026 |
| Pending invite from Riley | Riley | Pending | — |

Timeline — moments:
| Date | Photo | AI Label | By |
| Jul 15 | Beach sunset | Golden Hour | Alex |
| Jul 14 | Coffee shop | Morning Coffee | Jordan |
| Jul 12 | Park autumn leaves | Autumn Walk | Alex |
| Jul 10 | Kitchen cookies | Baking Day | Jordan |
| Jul 8 | Rooftop city view | City Lights | Alex |

---

## 8. Project Structure

```
project-root/
├── .azure/
│   └── project-plan.md
├── .env.example
├── .gitignore
├── package.json                        ← Root workspace config
├── services/
│   ├── scrapbook-api/                  ← Azure Functions — Scrapbook API
│   │   ├── host.json
│   │   ├── local.settings.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── functions/              ← One handler per file
│   │   │   ├── services/
│   │   │   │   ├── interfaces/
│   │   │   │   ├── config.ts
│   │   │   │   └── registry.ts
│   │   │   ├── errors/
│   │   │   └── middleware/
│   │   ├── tests/
│   │   │   ├── fixtures/
│   │   │   ├── mocks/
│   │   │   ├── services/
│   │   │   ├── functions/
│   │   │   └── validation/
│   │   └── seeds/
│   ├── scrapbook-web/                  ← Frontend — React + Vite
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── api/client.ts
│   │       ├── components/
│   │       ├── pages/
│   │       └── hooks/
│   ├── cleanup-worker/                 ← Azure Functions — Cleanup Worker
│   │   ├── host.json
│   │   ├── local.settings.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── functions/
│   │   │   ├── services/
│   │   │   │   ├── interfaces/
│   │   │   │   ├── config.ts
│   │   │   │   └── registry.ts
│   │   │   └── errors/
│   │   └── tests/
│   └── shared/                         ← Shared types and schemas
│       ├── package.json
│       ├── types/
│       │   ├── entities.ts
│       │   └── api.ts
│       └── schemas/
│           └── validation.ts
```

---

## 9. Route Definitions

| # | Method | Path | Description | Request Body | Response Body | Auth | Status Codes |
|---|--------|------|-------------|-------------|--------------|------|-------------|
| 1 | GET | `/api/health` | Health check | — | `{ status, services }` | None | 200, 503 |
| 2 | POST | `/api/pairs` | Create a pairing invitation | `{ partnerId }` | `{ pair }` | Mock | 201, 409, 422 |
| 3 | GET | `/api/pairs` | List user's pairs | — | `{ pairs[] }` | Mock | 200 |
| 4 | PATCH | `/api/pairs/:id/accept` | Accept a pairing invitation | — | `{ pair }` | Mock | 200, 404, 403 |
| 5 | DELETE | `/api/pairs/:id` | Remove a pairing | — | `{ success }` | Mock | 200, 404, 403 |
| 6 | POST | `/api/photos` | Upload a photo (multipart) | `{ file, caption?, pairId }` | `{ photo }` | Mock | 201, 422 |
| 7 | GET | `/api/photos` | List photos in a pair's scrapbook | `?pairId=` | `{ photos[] }` | Mock | 200, 403 |
| 8 | GET | `/api/photos/:id` | Get single photo with metadata and AI labels | — | `{ photo, labels }` | Mock | 200, 404 |
| 9 | PATCH | `/api/photos/:id` | Update photo caption | `{ caption }` | `{ photo }` | Mock | 200, 404, 422 |
| 10 | DELETE | `/api/photos/:id` | Delete a photo | — | `{ success }` | Mock | 200, 404, 403 |
| 11 | GET | `/api/photos/timeline` | Photos grouped by date for timeline view | `?pairId=` | `{ groups[] }` | Mock | 200 |

---

## 10. Next Steps

1. Run **azure-project-scaffold** to execute this plan
2. Run **azure-project-integrate** to wire the frontend to live data, smoke-test the backend, and create the migrations
3. Run **azure-debug-plan** → **azure-debug-generate** for Docker emulators and VS Code debugging
4. Run **azure-prepare** → **azure-deploy** when ready to deploy
