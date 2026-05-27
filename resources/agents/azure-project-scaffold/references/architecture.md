# Project Architecture

> Best practices for structuring an Azure-centric project with built-in testability.

---

## Core Principles

1. **Service boundary isolation** — Every Azure service interaction lives in a dedicated module behind an interface. Never scatter SDK calls across function handlers.
2. **Dependency injection** — Services are injectable. Function handlers receive their dependencies rather than importing singletons. This makes testing trivial — swap real services for mocks.
3. **Environment-driven config** — The same code runs against local mocks, local emulators, and Azure services, switched only by environment variables.
4. **Monorepo by default** — Frontend, backend, and shared types live in one repo with clear directory boundaries.
5. **Contracts first** — Shared types/schemas between frontend and backend live in a `shared/` directory. API contracts are defined before implementation.
6. **One function per file** — Each Azure Function gets its own file. The file name matches the function name. Each is independently testable.
7. **Tests live next to what they test** — Test directory structure mirrors source directory structure.

---

## Canonical Project Structures

### TypeScript — SPA + Azure Functions

```
project-root/
├── .azure/
│   └── project-plan.md             ← Project plan (source of truth)
├── .env.example                    ← Connection string template (checked in)
├── .env                            ← Actual values (gitignored)
├── .gitignore
├── package.json                    ← Root workspace config
├── src/
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
│   │   └── seeds/                  ← Database seed data (if applicable)
│   │       ├── seed.ts
│   │       └── fixtures/
│   │           └── seed-data.json
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
│       │   └── api.ts              ← Request/response contracts
│       └── schemas/
│           └── validation.ts       ← Zod schemas
└── data/                           ← Docker volume mounts (gitignored)
```

### TypeScript — API Only

```
project-root/
├── .azure/
│   └── project-plan.md
├── .env.example
├── .gitignore
├── package.json
├── src/
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
│   │   └── seeds/
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
├── src/
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

### C# (.NET 8) — SPA + Azure Functions

```
project-root/
├── .azure/
│   └── project-plan.md
├── .env.example
├── .gitignore
├── ProjectName.sln
├── src/
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
│   │   └── Seeds/
│   │       └── SeedData.cs
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

## Service Abstraction Layer — Structure

The `services/` directory is the **critical architectural component** for testability. Each file wraps one Azure service behind an interface.

### Interface Pattern

Every service follows this pattern:

```
┌─────────────────────────────────────────────────┐
│              Function Handler                    │
│  (receives services via DI — no SDK imports)     │
├─────────────────────────────────────────────────┤
│              Service Interface                   │
│  IStorageService │ IDatabaseService │ ICacheService
├─────────────────┬───────────────────────────────┤
│ Real Impl       │ Mock Impl                      │
│ (Azure SDK)     │ (in-memory Map/Dict/List)      │
├─────────────────┴───────────────────────────────┤
│         Environment (local or Azure)             │
└─────────────────────────────────────────────────┘
```

| File | Azure Service | Purpose |
|------|---------------|---------|
| `interfaces/IStorageService` | Blob / Queue / Table | Define upload, download, list, delete |
| `interfaces/IDatabaseService` | CosmosDB / PostgreSQL | Define query, insert, update, delete |
| `interfaces/ICacheService` | Redis | Define get, set, delete, clear |
| `storage` | Blob Storage | Concrete impl using `@azure/storage-blob` / `azure-storage-blob` / `Azure.Storage.Blobs` |
| `database` | PostgreSQL / CosmosDB | Concrete impl using `pg` / `psycopg2` / `Npgsql` |
| `cache` | Redis | Concrete impl using `ioredis` / `redis-py` / `StackExchange.Redis` |
| `config` | — | Config loader + env validation |
| `registry` | — | Factory that returns real or mock services |

> See [service-abstraction.md](service-abstraction.md) for implementation patterns per runtime.

---

## Function Organization

### One Function Per File (Required)

```
src/functions/src/functions/
├── getItems.ts         ← HTTP GET /api/items
├── createItem.ts       ← HTTP POST /api/items
├── getItemById.ts      ← HTTP GET /api/items/{id}
├── updateItem.ts       ← HTTP PUT /api/items/{id}
├── deleteItem.ts       ← HTTP DELETE /api/items/{id}
├── health.ts           ← HTTP GET /api/health
└── openapi.ts          ← HTTP GET /api/openapi.json
```

Each function receives its dependencies via the service registry:

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

---

## Frontend Proxy Configuration

When a frontend is included, the dev server must proxy `/api` requests to the Functions host:

### Vite (React, Vue, Svelte)

```typescript
// vite.config.ts
export default defineConfig({
  server: {
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

---

## Monorepo Package Management

### npm Workspaces (TypeScript)

```json
{
  "private": true,
  "workspaces": ["src/functions", "src/web", "src/shared"],
  "scripts": {
    "test": "npm test --workspaces",
    "test:functions": "cd src/functions && npm test",
    "test:web": "cd src/web && npm test",
    "build": "npm run build --workspaces"
  }
}
```

### Python (Poetry)

```toml
# pyproject.toml at project root
[tool.poetry]
packages = [
    { include = "services", from = "src/functions" },
    { include = "shared", from = "src" },
]
```

### .NET (Solution)

```xml
<!-- ProjectName.sln references -->
<!-- src/Functions/Functions.csproj -->
<!-- src/Functions.Tests/Functions.Tests.csproj -->
<!-- src/Shared/Shared.csproj -->
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
