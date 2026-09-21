# Project Architecture

> Testable Azure-centric project structure.

---

## Core Principles

1. **Service boundary isolation** — Put every Azure service behind dedicated module + interface. Never scatter SDK calls across handlers.
2. **Dependency injection** — Inject services. Handlers receive deps, never import singletons. Swap real services for mocks in tests.
3. **Environment-driven config** — Use same code for mocks, emulators, Azure; switch via env vars.
4. **Monorepo by default** — Frontend, backend, shared types in one repo with clear boundaries.
5. **Contracts first** — Put shared types/schemas in `shared/`; define API contracts before implementation.
6. **One function per file** — Match file and function names; test each independently.
7. **Tests next to source** — Test directory mirrors source structure.

---

## Canonical Project Structures

> **📁 Naming the service folders.** The folder names in the trees below (`functions`, `web`) are **role placeholders**. When the project has a clear product name, **prefer domain-specific names for the deployable apps** — derive a kebab-case slug from the product name and add a role suffix:
>
> - **Functions backend** → `<project>-api` (e.g. `office-compliance-api`)
> - **Frontend** → `<project>-<type>`, where `<type>` fits the app — `-portal`, `-app`, or `-web` (e.g. `office-compliance-portal`)
> - **Shared package** → keep the generic `shared/` (it is internal, never a deployed app)
>
> This is a **SHOULD**, not a mandate. Use generic `functions`/`web` only without a clear project name (e.g. generic internal tooling) or when following existing workspace structure. Apply names **consistently everywhere**: npm `workspaces`, `cd` commands, tsconfig `rootDir`, computed `main` field (e.g. with `rootDir: ".."`, `<project>-api` handlers compile to `dist/<project>-api/src/functions/*.js`). Shared package imports stay `../shared/...`. Plan's Project Structure is source of truth; trees below use generic names only as examples.

> **📁 Naming the service folders.** The folder names in the trees below (`functions`, `web`) are **role placeholders**. When the project has a clear product name, **prefer domain-specific names for the deployable apps** — derive a kebab-case slug from the product name and add a role suffix:
>
> - **Functions backend** → `<project>-api` (e.g. `office-compliance-api`)
> - **Frontend** → `<project>-<type>`, where `<type>` fits the app — `-portal`, `-app`, or `-web` (e.g. `office-compliance-portal`)
> - **Shared package** → keep the generic `shared/` (it is internal, never a deployed app)
>
> This is a **SHOULD**, not a mandate. Use generic `functions`/`web` only without a clear project name (e.g. generic internal tooling) or when following existing workspace structure. Apply names **consistently everywhere**: npm `workspaces`, `cd` commands, tsconfig `rootDir`, computed `main` field (e.g. with `rootDir: ".."`, `<project>-api` handlers compile to `dist/<project>-api/src/functions/*.js`). Shared package imports stay `../shared/...`. Plan's Project Structure is source of truth; trees below use generic names only as examples.

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
> Thus `export * from './types/api.js'` and `export * from './schemas/validation.js'` never export the same name.

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

The `services/` directory is **critical** for testability. Each file wraps one Azure service behind an interface. Handlers receive services via DI; never import SDKs directly.

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

Each function receives deps through service registry:

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

When 3+ handlers need same helper, extract it to `services/functions/src/utils/`; do NOT duplicate inline.

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

**Detection**: After Step 6, grep handlers for repeated helper names. Extract when found in 3+ files.

**Enforcement**: Step 12 MUST check for duplicated helpers and extract before finalization.

---

## Frontend Dev Server Configuration (proxy + preview compatibility)

Frontend dev server must (a) proxy `/api` to Functions host and (b) embed in scaffold's **Approve UI** preview, which starts it inside a **VS Code webview iframe** (forwarding port in remote / Codespaces / Dev Container / SSH sessions). Missing (b) hangs preview on "Starting…" or renders blank despite working in a normal browser, **blocking the approval gate**.

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

> For Angular, serve with host binding + host-check disabled so preview iframe loads (`ng serve --host 0.0.0.0 --disable-host-check`, or equivalent `serve` options in `angular.json`). For Next.js, bind all interfaces (`next dev -H 0.0.0.0`). Goal matches Vite's `host: true` + `allowedHosts: true`.

> **Do NOT frame-bust the dev server.** Never send `X-Frame-Options` from dev server or add a `<meta http-equiv="Content-Security-Policy" content="… frame-ancestors …">` to `index.html`. These allow normal browser loading but block preview webview iframe embedding: "works in my browser, blank in the preview."

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

When Functions imports from `../shared/`, `tsconfig.json` must set `rootDir` outside workspace:

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

> ⛔ **Import the shared code by relative path (`../shared/...`) or by the shared package's `name` — NEVER through a tsconfig `paths` alias.**
>
> `tsc` resolves `paths` at compile time and emits the module specifier **unchanged**. `paths` has no runtime counterpart (no `tsconfig-paths`, no bundler, no `imports` map in these projects), so the alias survives into `dist/` and Node cannot resolve it. The build is green, `tsc --noEmit` is green, and `func start` dies on load.
>
> ```jsonc
> // ❌ compiles, fails at runtime — tsc emits require('@shared/schemas/index') unchanged
> // → Worker was unable to load entry point: Cannot find module '@shared/schemas/index'
> { "compilerOptions": { "paths": { "@shared/*": ["shared/src/*"] } } }
> ```
>
> ```ts
> // ❌ import { createTaskSchema } from '@shared/schemas/index';
> // ✅ relative form — count the levels from the importing FILE, not from the workspace root.
> //    services/functions/src/functions/createTask.ts -> services/shared/schemas/index
> import { createTaskSchema } from '../../../shared/schemas/index';
> // ✅ or the workspace package's own name, exactly as written in services/shared/package.json
> import { createTaskSchema } from '@<project>/shared/schemas';
> ```
>
> These are the only two supported mechanisms. Picking both leaves two competing paths to the same code, and the compile-time-only one wins silently.

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

> ⛔ **Ignore `.env` and `local.settings.json` before creating them.** They hold real credential
> values. A secret that reaches a commit is compromised the moment it is pushed, and deleting it in
> a later commit does **not** undo that — the value stays in history and in every clone and fork
> that already has it. Recovery means rotating the credential, not editing a file. This applies to
> private repositories exactly as it does to public ones: no secret belongs in any commit, ever.

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
