# Project Architecture

> Best practices for structuring an Azure-centric project with built-in testability.

---

## Core Principles

1. **Service boundary isolation** — Every Azure service behind dedicated module with interface. Never scatter SDK calls across handlers.
2. **Dependency injection** — Services injectable. Handlers receive deps, not import singletons. Swap real for mocks in tests.
3. **Environment-driven config** — Same code for mocks, emulators, Azure — switched by env vars.
4. **Monorepo by default** — Frontend, backend, shared types in one repo with clear boundaries.
5. **Contracts first** — Shared types/schemas in `shared/` dir. API contracts defined before implementation.
6. **One function per file** — File name matches function name. Each independently testable.
7. **Tests next to source** — Test directory mirrors source structure.

---

## Canonical Project Structures

> **📁 Naming the service folders.** The folder names in the trees below (`functions`, `web`) are **role placeholders**. When the project has a clear product name, **prefer domain-specific names for the deployable apps** — derive a kebab-case slug from the product name and add a role suffix:
>
> - **Functions backend** → `<project>-api` (e.g. `office-compliance-api`)
> - **Frontend** → `<project>-<type>`, where `<type>` fits the app — `-portal`, `-app`, or `-web` (e.g. `office-compliance-portal`)
> - **Shared package** → keep the generic `shared/` (it is internal, never a deployed app)
>
> This is a **SHOULD**, not a mandate: fall back to the generic `functions`/`web` only when there is no clear project name (e.g. generic internal tooling), or when the workspace already has a structure to follow. Whatever names you pick, apply them **consistently everywhere** — npm `workspaces`, `cd` commands, tsconfig `rootDir`, and the computed `main` field (e.g. with `rootDir: ".."`, `<project>-api` handlers compile to `dist/<project>-api/src/functions/*.js`). Imports of the shared package stay `../shared/...`. The plan's Project Structure section is the source of truth; the trees below use generic names purely as illustration.

> **📁 Naming the service folders.** The folder names in the trees below (`functions`, `web`) are **role placeholders**. When the project has a clear product name, **prefer domain-specific names for the deployable apps** — derive a kebab-case slug from the product name and add a role suffix:
>
> - **Functions backend** → `<project>-api` (e.g. `office-compliance-api`)
> - **Frontend** → `<project>-<type>`, where `<type>` fits the app — `-portal`, `-app`, or `-web` (e.g. `office-compliance-portal`)
> - **Shared package** → keep the generic `shared/` (it is internal, never a deployed app)
>
> This is a **SHOULD**, not a mandate: fall back to the generic `functions`/`web` only when there is no clear project name (e.g. generic internal tooling), or when the workspace already has a structure to follow. Whatever names you pick, apply them **consistently everywhere** — npm `workspaces`, `cd` commands, tsconfig `rootDir`, and the computed `main` field (e.g. with `rootDir: ".."`, `<project>-api` handlers compile to `dist/<project>-api/src/functions/*.js`). Imports of the shared package stay `../shared/...`. The plan's Project Structure section is the source of truth; the trees below use generic names purely as illustration.

### TypeScript — SPA + Azure Functions

```
project-root/
├── .azure/
│   └── project-plan.md             ← Project plan (source of truth)
├── .env.example                    ← Connection string template (checked in)
├── .env                            ← Actual values (gitignored)
├── .gitignore
├── package.json                    ← Root workspace config
├── services/
│   ├── functions/                  ← Azure Functions project
│   │   ├── host.json
│   │   ├── local.settings.json     ← Functions env config (gitignored)
│   │   ├── package.json            ← Backend dependencies
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts        ← Test runner config
│   │   ├── openapi.yaml            ← API contract
│   │   ├── src/
│   │   │   ├── functions/          ← Function handlers (one per file)
│   │   │   │   ├── getItems.ts
│   │   │   │   ├── createItem.ts
│   │   │   │   ├── getItemById.ts
│   │   │   │   ├── updateItem.ts
│   │   │   │   ├── deleteItem.ts
│   │   │   │   ├── health.ts
│   │   │   │   └── openapi.ts
│   │   │   ├── services/           ← Service abstraction layer
│   │   │   │   ├── interfaces/
│   │   │   │   │   ├── IStorageService.ts
│   │   │   │   │   ├── IDatabaseService.ts
│   │   │   │   │   └── ICacheService.ts
│   │   │   │   ├── storage.ts
│   │   │   │   ├── database.ts
│   │   │   │   ├── cache.ts
│   │   │   │   ├── config.ts       ← Config loader + env validation
│   │   │   │   └── registry.ts     ← Service factory / DI registry
│   │   │   ├── errors/
│   │   │   │   ├── AppError.ts     ← Base error class
│   │   │   │   ├── errorTypes.ts   ← NotFoundError, ValidationError, etc.
│   │   │   │   └── errorHandler.ts ← Global error handler
│   │   │   ├── middleware/
│   │   │   │   ├── requestLogger.ts
│   │   │   │   └── validateRequest.ts
│   │   │   └── logger.ts           ← Structured logger (pino)
│   │   ├── tests/
│   │   │   ├── fixtures/           ← Mock data (JSON files)
│   │   │   │   ├── items.json
│   │   │   │   └── users.json
│   │   │   ├── mocks/              ← Mock service implementations
│   │   │   │   ├── mockStorage.ts
│   │   │   │   ├── mockDatabase.ts
│   │   │   │   └── mockCache.ts
│   │   │   ├── services/
│   │   │   │   ├── config.test.ts
│   │   │   │   ├── storage.test.ts
│   │   │   │   ├── database.test.ts
│   │   │   │   └── registry.test.ts
│   │   │   ├── functions/
│   │   │   │   ├── getItems.test.ts
│   │   │   │   ├── createItem.test.ts
│   │   │   │   ├── getItemById.test.ts
│   │   │   │   ├── health.test.ts
│   │   │   │   └── openapi.test.ts
│   │   │   ├── errors/
│   │   │   │   └── errorHandler.test.ts
│   │   │   └── validation/
│   │   │       └── itemSchema.test.ts
│   ├── web/                        ← Frontend application
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts          ← Dev proxy to Functions
│   │   ├── index.html
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── main.tsx
│   │       ├── api/
│   │       │   └── client.ts       ← Typed API client
│   │       ├── components/
│   │       ├── pages/
│   │       └── hooks/
│   └── shared/                     ← Shared types and schemas
│       ├── package.json
│       ├── types/
│       │   ├── index.ts
│       │   ├── entities.ts         ← Entity types (shared FE + BE)
│       │   └── api.ts              ← Response contracts + ErrorCode union
│       └── schemas/
│           └── validation.ts       ← Zod schemas + inferred request types
└── data/                           ← Docker volume mounts (gitignored)
```

### Shared Types — Single Source of Truth for Request Types

> ⚠️ **CRITICAL: Do NOT define request types in BOTH `types/api.ts` AND `schemas/validation.ts`.** Causes duplicate export errors.
>
> With Zod, `z.infer<typeof schema>` types ARE canonical request types:
>
> | File | Contains | Does NOT contain |
> |------|----------|-----------------|
> | `types/entities.ts` | Entity interfaces (User, Photo, etc.) | — |
> | `types/api.ts` | Response types, `ErrorCode` union, `ErrorResponse` | Request types (LoginRequest, etc.) |
> | `schemas/validation.ts` | Zod schemas + `z.infer` request types | Response types |
> | `index.ts` | `export * from` all three files | — |
>
> This ensures `export * from './types/api.js'` and `export * from './schemas/validation.js'` never export the same name.

### TypeScript — API Only

```
project-root/
├── .azure/
│   └── project-plan.md
├── .env.example
├── .gitignore
├── package.json
├── services/
│   ├── functions/
│   │   ├── host.json
│   │   ├── local.settings.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── openapi.yaml
│   │   ├── src/
│   │   │   ├── functions/
│   │   │   ├── services/
│   │   │   ├── errors/
│   │   │   ├── middleware/
│   │   │   └── logger.ts
│   │   ├── tests/
│   │   │   ├── fixtures/
│   │   │   ├── mocks/
│   │   │   ├── services/
│   │   │   ├── functions/
│   │   │   └── errors/
│   └── shared/
│       ├── types/
│       └── schemas/
└── data/
```

### Python — SPA + Azure Functions

```
project-root/
├── .azure/
│   └── project-plan.md
├── .env.example
├── .gitignore
├── services/
│   ├── functions/                  ← Azure Functions Python project
│   │   ├── host.json
│   │   ├── local.settings.json
│   │   ├── pyproject.toml          ← Python project config
│   │   ├── pytest.ini              ← Test config
│   │   ├── openapi.yaml
│   │   ├── function_app.py         ← Function registration
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── interfaces.py       ← ABC / Protocol definitions
│   │   │   ├── storage.py
│   │   │   ├── database.py
│   │   │   ├── cache.py
│   │   │   ├── config.py           ← Config loader + validation
│   │   │   └── registry.py         ← Service factory
│   │   ├── errors/
│   │   │   ├── __init__.py
│   │   │   ├── app_error.py
│   │   │   ├── error_types.py
│   │   │   └── error_handler.py
│   │   ├── middleware/
│   │   │   ├── __init__.py
│   │   │   ├── request_logger.py
│   │   │   └── validate_request.py
│   │   ├── logger.py               ← structlog setup
│   │   └── tests/
│   │       ├── conftest.py          ← Pytest fixtures (mock services)
│   │       ├── fixtures/
│   │       │   ├── items.json
│   │       │   └── users.json
│   │       ├── test_config.py
│   │       ├── test_storage.py
│   │       ├── test_database.py
│   │       ├── test_get_items.py
│   │       ├── test_create_item.py
│   │       ├── test_error_handler.py
│   │       ├── test_health.py
│   │       └── test_validation.py
│   ├── web/                        ← Frontend
│   │   └── (same as TypeScript)
│   └── shared/
│       ├── types.py                ← Pydantic models
│       └── validation.py           ← Validation schemas
└── data/
```

### C# (.NET 10) — SPA + Azure Functions

```
project-root/
├── .azure/
│   └── project-plan.md
├── .env.example
├── .gitignore
├── ProjectName.sln
├── services/
│   ├── Functions/                  ← Azure Functions isolated worker
│   │   ├── Functions.csproj
│   │   ├── host.json
│   │   ├── local.settings.json
│   │   ├── Program.cs              ← DI registration + startup
│   │   ├── openapi.yaml
│   │   ├── Functions/              ← Function handlers
│   │   │   ├── GetItems.cs
│   │   │   ├── CreateItem.cs
│   │   │   ├── GetItemById.cs
│   │   │   ├── Health.cs
│   │   │   └── OpenApi.cs
│   │   ├── Services/
│   │   │   ├── Interfaces/
│   │   │   │   ├── IStorageService.cs
│   │   │   │   ├── IDatabaseService.cs
│   │   │   │   └── ICacheService.cs
│   │   │   ├── StorageService.cs
│   │   │   ├── DatabaseService.cs
│   │   │   ├── CacheService.cs
│   │   │   └── Config.cs
│   │   ├── Errors/
│   │   │   ├── AppException.cs
│   │   │   ├── ErrorTypes.cs
│   │   │   └── ErrorHandler.cs
│   │   ├── Middleware/
│   │   │   ├── RequestLogger.cs
│   │   │   └── ValidateRequest.cs
│   ├── Functions.Tests/            ← xUnit test project
│   │   ├── Functions.Tests.csproj
│   │   ├── Fixtures/
│   │   │   └── ItemFixtures.cs
│   │   ├── Mocks/
│   │   │   ├── MockStorageService.cs
│   │   │   ├── MockDatabaseService.cs
│   │   │   └── MockCacheService.cs
│   │   ├── Services/
│   │   │   ├── ConfigTests.cs
│   │   │   └── StorageTests.cs
│   │   ├── Functions/
│   │   │   ├── GetItemsTests.cs
│   │   │   ├── CreateItemTests.cs
│   │   │   └── HealthTests.cs
│   │   ├── Errors/
│   │   │   └── ErrorHandlerTests.cs
│   │   └── Validation/
│   │       └── ItemValidatorTests.cs
│   ├── Shared/
│   │   ├── Shared.csproj
│   │   ├── Models/
│   │   │   ├── Item.cs
│   │   │   └── ApiContracts.cs
│   │   └── Validators/
│   │       └── ItemValidator.cs    ← FluentValidation
│   └── Web/                        ← Frontend
│       └── (same as TypeScript)
└── data/
```

---

## Service Abstraction Layer

The `services/` directory is the **critical architectural component** for testability. Each file wraps one Azure service behind interface. Handlers receive services via DI — never import SDKs directly.

> Full service abstraction architecture: see [service-abstraction.md](.github/agents/shared-references/service-abstraction.md).

---

## Function Organization

### One Function Per File (Required)

```
services/functions/src/functions/
├── getItems.ts         ← HTTP GET /api/items
├── createItem.ts       ← HTTP POST /api/items
├── getItemById.ts      ← HTTP GET /api/items/{id}
├── updateItem.ts       ← HTTP PUT /api/items/{id}
├── deleteItem.ts       ← HTTP DELETE /api/items/{id}
├── health.ts           ← HTTP GET /api/health
└── openapi.ts          ← HTTP GET /api/openapi.json
```

Each function receives deps via service registry:

```typescript
// Example: clean handler with injected services
import { app } from "@azure/functions";
import { getServices } from "../services/registry";

app.http("getItems", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "items",
  handler: async (request, context) => {
    const { database } = getServices();
    const items = await database.findAll("items");
    return { jsonBody: { items } };
  }
});
```

### Shared Handler Utilities (Required — DRY Enforcement)

When same helper needed in 3+ handlers, extract to `services/functions/src/utils/` — do NOT duplicate inline.

**Common examples:**

```typescript
// services/functions/src/utils/toPublicUser.ts
import type { User, PublicUser } from '../../../shared/types/entities.js';

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    coupleId: user.coupleId,
    createdAt: user.createdAt,
  };
}
```

```typescript
// Usage in handler — import, don't redefine
import { toPublicUser } from '../utils/toPublicUser.js';
```

**Detection**: After Step 6, grep for repeated helper names across handlers. If 3+ files, extract.

**Enforcement**: Step 12 MUST check for duplicated helpers and extract before finalization.

---

## Frontend Dev Server Configuration (proxy + preview compatibility)

When a frontend is included, its dev server must (a) proxy `/api` to the Functions host **and** (b) be embeddable in the scaffold's **Approve UI** preview, which starts this dev server and renders it inside a **VS Code webview iframe** (forwarding the port in remote / Codespaces / Dev Container / SSH sessions). Miss (b) and the preview hangs on "Starting…" or renders blank even though the app opens fine in a normal browser — the user is then **stuck at the approval gate**.

### Vite (React, Vue, Svelte)

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    // (b) Preview compatibility — let the webview iframe / forwarded host load the app.
    host: true,          // bind 0.0.0.0 so the webview / port-forwarder can reach it
    allowedHosts: true,  // dev-only: don't 403-block the webview / forwarded origin
    strictPort: false,   // let the preview bind a free port if the default is taken
    // (a) Proxy /api to the Functions host.
    proxy: {
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true
      }
    }
  }
});
```

### Angular

```json
// proxy.conf.json
{
  "/api": {
    "target": "http://localhost:7071",
    "secure": false
  }
}
```

> For Angular, also serve with host binding + host-check disabled so the preview iframe can load it (`ng serve --host 0.0.0.0 --disable-host-check`, or the equivalent `serve` options in `angular.json`). For Next.js, bind all interfaces (`next dev -H 0.0.0.0`). The goal is identical to Vite's `host: true` + `allowedHosts: true`.

> **Do NOT frame-bust the dev server.** Never send `X-Frame-Options` from the dev server and never add a `<meta http-equiv="Content-Security-Policy" content="… frame-ancestors …">` to `index.html`. Those let a normal browser tab load the app but block it from being embedded in the preview's webview iframe — the exact "works in my browser, blank in the preview" trap.

---

## Monorepo Package Management

### npm Workspaces (TypeScript)

```json
{
  "private": true,
  "workspaces": ["services/functions", "services/web", "services/shared"],
  "scripts": {
    "test": "npm test --workspaces",
    "test:functions": "cd services/functions && npm test",
    "test:web": "cd services/web && npm test",
    "build": "npm run build --workspaces"
  }
}
```

### TypeScript Cross-Workspace Import Configuration

When Functions imports from `../shared/`, `tsconfig.json` must set `rootDir` to reach outside workspace:

```jsonc
// services/functions/tsconfig.json
{
  "compilerOptions": {
    "rootDir": "..",        // ← Parent of functions dir (i.e., services/)
    "outDir": "dist",
    // ... other options
  },
  "include": ["src/**/*.ts", "../shared/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

> ⚠️ **Build output nesting — `main` MUST match actual dist/ output (Rule 14)**
>
> When `rootDir` is parent dir, `tsc` mirrors full structure under `dist/`. `main` in `package.json` MUST be computed from actual output — never hardcoded.
>
> | `rootDir` value | `services/functions/src/functions/register.ts` compiles to | Correct `main` field |
> |-----------------|-------------------------------------------------------|---------------------|
> | `"."` | `dist/src/functions/register.js` | `"dist/src/functions/*.js"` |
> | `".."` (= `services/`) | `dist/functions/src/functions/register.js` | `"dist/functions/src/functions/*.js"` |
> | `"../.."` (= project root) | `dist/services/functions/src/functions/register.js` | `"dist/services/functions/src/functions/*.js"` |
>
> **Verification (MANDATORY after every `tsc` build):**
> 1. Run `tsc` in functions workspace
> 2. List `dist/` — find compiled handler `.js` files
> 3. Construct matching glob
> 4. Set `main` to that glob
> 5. `func start` — verify functions register. "Found zero files" = wrong `main`.
>
> **#1 cause of "tests pass but app won't start".** Tests use vitest/ts-node (transpile on fly, never read `main`). Only `func start` uses `main` to discover handlers.

### Python (Poetry)

```toml
# pyproject.toml at project root
[tool.poetry]
packages = [
    { include = "services", from = "services/functions" },
    { include = "shared", from = "services" },
]
```

### .NET (Solution)

```xml
<!-- ProjectName.sln references -->
<!-- services/Functions/Functions.csproj -->
<!-- services/Functions.Tests/Functions.Tests.csproj -->
<!-- services/Shared/Shared.csproj -->
```

---

## .gitignore Additions

```gitignore
# Environment
.env
local.settings.json

# Data volumes
data/

# Build output
dist/
bin/
obj/
.vite/

# Runtime
node_modules/
__pycache__/
.python_packages/

# Test output
coverage/
.pytest_cache/
TestResults/

# IDE
.vs/
```

---

## Port Allocation Convention

| Service | Port | Notes |
|---------|------|-------|
| Azure Functions host | 7071 | Default `func start` port |
| Frontend dev server (Vite) | 5173 | Default Vite port |
| Frontend dev server (Angular) | 4200 | Default Angular port |
| Azurite Blob | 10000 | |
| Azurite Queue | 10001 | |
| Azurite Table | 10002 | |
| PostgreSQL | 5432 | |
| CosmosDB Emulator | 8081 | |
| Redis | 6379 | |
| Azure SQL Edge | 1433 | |
