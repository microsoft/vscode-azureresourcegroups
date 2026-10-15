# Integration Plan

## Backend — Scrapbook API

| Field | Value |
|-------|-------|
| Folder | `services/scrapbook-api/` |
| Build command | `npm run build` |
| Run command | `func start` |
| Port | 7071 |
| Health endpoint | `GET /api/health` |

## Backend — Cleanup Worker

| Field | Value |
|-------|-------|
| Folder | `services/cleanup-worker/` |
| Build command | `npm run build` |
| Run command | `func start` |
| Port | 7072 |

## Frontend

| Field | Value |
|-------|-------|
| Folder | `services/scrapbook-web/` |
| Build command | `npm run build` |
| Dev command | `npm run dev` |
| API seam file | `src/api/index.ts` — swap `mockClient` import to `liveClient` |
| Mock files to delete | `src/api/mockClient.ts`, `src/mocks/photos.ts`, `src/mocks/pairs.ts`, `src/mocks/labels.ts`, `src/api/previewState.tsx` |

## API Routes (full inventory)

| # | Method | Path |
|---|--------|------|
| 1 | GET | `/api/health` |
| 2 | POST | `/api/pairs` |
| 3 | GET | `/api/pairs` |
| 4 | PATCH | `/api/pairs/{id}/accept` |
| 5 | DELETE | `/api/pairs/{id}` |
| 6 | POST | `/api/photos` |
| 7 | GET | `/api/photos` |
| 8 | GET | `/api/photos/{id}` |
| 9 | PATCH | `/api/photos/{id}` |
| 10 | DELETE | `/api/photos/{id}` |
| 11 | GET | `/api/photos/timeline` |
| 12 | GET | `/api/openapi.json` |

## Database

| Field | Value |
|-------|-------|
| Type | PostgreSQL |
| Migration tool | knex |
| Migration directory | `services/scrapbook-api/migrations/` |
| Connection env var | `DATABASE_URL` |
| Default local value | `postgresql://localdev:localdevpassword@localhost:5432/scrapbookdb` |
| **NO seed data** | Migrations only — do NOT create seed scripts |

### Table mapping

| Collection name | SQL table |
|-----------------|-----------|
| `pair` | `pairs` |
| `photo` | `photos` |
| `photoLabel` | `photo_labels` |
| `user` | `users` |

## Shared Types

| Field | Value |
|-------|-------|
| Package | `services/shared/` (npm name: `scrapbook-shared`) |
| Import alias | Relative `../shared/` from backend services |
| Frontend types | Inlined in `services/scrapbook-web/src/api/types.ts` (mirrors shared) |

## Services

| Service | Classification | Env Var |
|---------|---------------|---------|
| PostgreSQL (database) | Essential | `DATABASE_URL` |
| Azure Blob Storage | Essential | `STORAGE_CONNECTION_STRING` |

## Workload Quality Contract

| Field | Value |
|---|---|
| Operating Profile | Standard Production |
| Data Classification | Confidential / Personal |
| Traffic Profile | Bursty |
| Optimization Priority | Balanced |

### Application Controls

| ID | Pillar | Control | Evidence | Integration Validation |
|---|---|---|---|---|
| `REL-DEGRADE-01` | Reliability | AI labeling degrades without failing photo persistence | caption service boundary and upload handler | `npm test --workspace=scrapbook-api` |
| `SEC-LOG-01` | Security | Photo and pairing values are absent from logs | request logger and authorization middleware | `npm test --workspace=scrapbook-api` |
| `COST-SCOPE-01` | Cost Optimization | AI work runs only for the enabled enhancement | service registry | `npm run build --workspace=scrapbook-api` |
| `OE-CORRELATION-01` | Operational Excellence | Upload and cleanup logs carry correlation IDs | request/job logging middleware | `npm test --workspace=scrapbook-api` |
| `PE-BOUNDS-01` | Performance Efficiency | Upload size, list pagination, and cleanup batches are bounded | shared validation and cleanup configuration | `npm test --workspace=scrapbook-api` |

### Dependency Access

| Dependency | Operation | Deployed identity | Required permission | Local equivalent |
|---|---|---|---|---|
| PostgreSQL (database) | `SELECT 1` health probe and scrapbook CRUD | API app system-assigned managed identity | Database principal created with `pgaadauth_create_principal`, granted table/sequence privileges | `DATABASE_URL` against the Compose PostgreSQL container |
| Azure Blob Storage | List containers, one page, as the health probe; upload/read page images | API app system-assigned managed identity | Storage Blob Data Contributor (`containers/read` and `containers/blobs/*` are `dataActions`) | `STORAGE_CONNECTION_STRING` against Azurite |

### Deferred Risks

- Recovery targets, alert routing, private networking, and numeric burst throughput are resolved during deployment planning.
