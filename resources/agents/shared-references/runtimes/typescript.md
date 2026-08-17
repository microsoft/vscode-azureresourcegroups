# TypeScript (Node.js) Runtime Reference

> Azure Functions v4 model, TypeScript. Test runner setup, validation, logging, DI patterns.

---

## Azure Functions v4 Setup

### Initialization

```bash
func init services/functions --typescript --model V4
cd services/functions
npm install
```

### host.json

```json
{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true,
        "excludedTypes": "Request"
      }
    }
  },
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

### local.settings.json

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "NODE_ENV": "development",
    "STORAGE_CONNECTION_STRING": "UseDevelopmentStorage=true",
    "DATABASE_URL": "postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5432/appdb",
    "REDIS_URL": "redis://localhost:6379"
  },
  "Host": {
    "CORS": "*",
    "CORSCredentials": false
  }
}
```

> `local.settings.json` is plain JSON and does **not** support `${...}` interpolation.
> Replace `<POSTGRES_USER>` / `<POSTGRES_PASSWORD>` with the same discrete values declared in the
> workspace-root `.env` used by docker-compose. Never leave the angle-bracket placeholders in the
> generated file, and never paste a credential value copied out of tool output — redaction filters
> rewrite concrete credential URLs, and a masked value beginning with `*` corrupts YAML/JSON config.

### tsconfig.json

> ⚠️ When importing from `../shared/`, `rootDir` must be `".."` for cross-workspace imports. Changes `dist/` output — see `main` field below.

```json
{
  "compilerOptions": {
    "module": "Node16",
    "target": "ES2022",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "..",
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "../shared/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### package.json (backend)

> ⚠️ **`main` field MUST match actual `dist/` output.** With `rootDir: ".."`, handlers compile to `dist/functions/src/functions/*.js` (not `dist/src/functions/*.js`). After `tsc` build, verify `main` resolves via `dist/` contents.

```json
{
  "name": "functions",
  "version": "1.0.0",
  "private": true,
  "main": "dist/functions/src/functions/*.js",
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "clean": "rimraf dist",
    "prestart": "npm run clean && npm run build",
    "start": "func start",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/ tests/",
    "db:migrate": "knex migrate:latest",
    "db:seed": "tsx seeds/seed.ts"
  },
  "dependencies": {
    "@azure/functions": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "rimraf": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

> Adjust `scripts.test` per user's test runner.

> ⚠️ **Deployment build contract — ship a prebuilt artifact, do NOT re-build on the server.**
> The deployed unit for a TS Functions app is the **compiled `dist/`**, not the TypeScript source. `azd` compiles locally (`npm install` + `npm run build`) and packages the output. The server (Kudu/Oryx) then runs `npm install --omit=dev` (production deps only). If the deployed `package.json` still triggers a build, Oryx runs `npm run build` **without** `typescript` (a `devDependency`) and fails with `tsc: not found`. Scaffold the project so the artifact stands alone:
> - **Dependency split is load-bearing.** Every package imported by runtime code (`dist/**/*.js`) MUST be in `dependencies`; build-only tooling (`typescript`, `@types/*`, test runners, bundlers) MUST be in `devDependencies`. A production install (`--omit=dev`) must satisfy every `require`/`import` in `dist/`.
> - **Compiled output must be self-sufficient.** `dist/` must never import from `src/` or need a rebuild to run. The `main` field points at compiled `.js` (Rule 12), never a `.ts` entry.
> - **Prefer disabling the server build over stripping scripts.** The robust deploy config ships the prebuilt `dist/` and turns the platform build **off** (`SCM_DO_BUILD_DURING_DEPLOYMENT=false` / `azd` `host: function` remote build disabled). Do **not** rely on `prepackage`/`postpackage` hooks that temporarily delete the build scripts (`build`, `watch`, `clean`, `prestart`) from `package.json` — that treats the symptom (an unwanted server rebuild) instead of the cause. The deploy agent owns the deploy config; the scaffold's job is to guarantee the split above so a prebuilt artifact deploys cleanly.
> - **Native modules stay external.** Packages with compiled native addons (`bcrypt`, `sharp`, `better-sqlite3`, Prisma engines, …) are OS/arch-specific. Keep them in `dependencies` (installed on the Linux host), never bundle their binaries from a Windows/macOS build.

> ⚠️ **Monorepo / npm workspaces deployment — keep each service self-contained.**
> Each service deploys **independently** (one `azure.yaml` service = one artifact), and npm workspaces **hoist** `node_modules` and the single lockfile to the repo root — so a per-service zip has no local `node_modules` and can't resolve a root-linked dependency on its own (the "43KB zip / `Cannot find module 'shared'`" failures). Use the following approaches to make a service self-contained — **no bundler required by default**:
> - **Compile `shared` in via relative imports (preferred).** Import the shared package by **relative path** (`../../shared/...`), not as a workspace package (`@app/shared`). With `rootDir: ".."` + `../shared` in `include`, `tsc` emits `shared` into the service's own `dist/`, so there is **no `shared` runtime dependency to resolve** — this is the real fix for `Cannot find module 'shared'` on a per-service deploy. If you must consume `shared` as a workspace package, vendor or bundle its compiled output into the artifact.
> - **Resolve third-party deps at the service level.** Because deps are hoisted, ship the service with either (a) a production `node_modules` installed *into the service directory* (isolated `npm install --omit=dev`), or (b) the platform's production install against the service's `package.json` + lockfile (disable only the *build*, keep the *install*). Native-addon packages must install on the Linux host, never copied from a Windows/macOS `node_modules`.
> - **Optional — single-file bundle.** For cold-start-sensitive or single-artifact needs, `esbuild --bundle --packages=external` (from a `src/index.ts` that imports every handler; point `main` at the one `dist/index.js`) inlines first-party code (including `shared`) and leaves npm deps external. It sidesteps both issues but **departs from the idiomatic per-file layout** (Microsoft's `func init --model V4` default is modular handlers + a glob `main` compiled by `tsc`), so treat it as an **opt-in optimization, not the default**.

---

## Function Handler Pattern

> ⚠️ **Always set `status` explicitly**, even for 200. Do NOT omit and rely on default. Explicit status keeps test assertions consistent and prevents `undefined` vs `200` confusion.

### HTTP Function (v4 Model)

```typescript
// services/functions/getItems.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getServices } from '../services/registry';
import { handleError } from '../errors/errorHandler';
import { Item } from '../../shared/types/entities';

app.http('getItems', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'items',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const { database } = getServices();
      const limit = Number(request.query.get('limit')) || 20;
      const offset = Number(request.query.get('offset')) || 0;

      const items = await database.findAll<Item>('items', { limit, offset });

      return {
        status: 200,
        jsonBody: { items, total: items.length },
      };
    } catch (error) {
      return handleError(error, context);
    }
  },
});
```

### POST with Validation

```typescript
// services/functions/createItem.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getServices } from '../services/registry';
import { handleError } from '../errors/errorHandler';
import { validateBody } from '../middleware/validateRequest';
import { createItemSchema } from '../../shared/schemas/validation';
import { v4 as uuid } from 'uuid';

app.http('createItem', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'items',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await validateBody(request, createItemSchema);
      const { database } = getServices();

      const item = {
        id: uuid(),
        ...body,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const created = await database.create('items', item);
      return { status: 201, jsonBody: { item: created } };
    } catch (error) {
      return handleError(error, context);
    }
  },
});
```

### GET by ID with 404 Handling

```typescript
// services/functions/getItemById.ts
import { app } from '@azure/functions';
import { getServices } from '../services/registry';
import { handleError } from '../errors/errorHandler';
import { NotFoundError } from '../errors/errorTypes';
import { Item } from '../../shared/types/entities';

app.http('getItemById', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'items/{id}',
  handler: async (request, context) => {
    try {
      const { database } = getServices();
      const id = request.params.id;

      const item = await database.findById<Item>('items', id);
      if (!item) {
        throw new NotFoundError('Item', id);
      }

      return { jsonBody: { item } };
    } catch (error) {
      return handleError(error, context);
    }
  },
});
```

### Health Check

```typescript
// services/functions/health.ts
import { app } from '@azure/functions';
import { getServices } from '../services/registry';

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (request, context) => {
    const services = getServices();

    const checks: Record<string, boolean> = {};
    
    // Check each service
    try { checks.database = await services.database.healthCheck(); } catch { checks.database = false; }
    try { checks.storage = await services.storage.healthCheck(); } catch { checks.storage = false; }
    try { checks.cache = await services.cache.healthCheck(); } catch { checks.cache = false; }

    const allHealthy = Object.values(checks).every(v => v);
    const anyHealthy = Object.values(checks).some(v => v);

    const status = allHealthy ? 'healthy' : anyHealthy ? 'degraded' : 'unhealthy';

    return {
      status: allHealthy ? 200 : 503,
      jsonBody: { status, services: checks },
    };
  },
});
```

---

## Test Runner Configurations

### vitest

> ⚠️ **MANDATORY for projects with heavy SDK imports** (pg, @azure/storage-blob, etc.):
> - `fileParallelism: false` — Prevents memory exhaustion from multiple workers loading heavy SDKs.
> - `teardownTimeout: 3000` — Kills lingering connections (e.g., `pg.Pool`) keeping process alive after tests.
> - `testTimeout: 10000` — Prevents false failures on slow CI.
>
> Without these, test suite **hangs indefinitely** with 13+ files importing heavy SDKs. #1 test infrastructure issue.

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false,
    teardownTimeout: 3000,
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/interfaces/**', 'src/functions/*.ts'],
    },
  },
});
```

```typescript
// tests/setup.ts
import { registerServices, clearServices } from '../src/services/registry';
import { MockDatabaseService } from './mocks/mockDatabase';
import { MockStorageService } from './mocks/mockStorage';
import { MockCacheService } from './mocks/mockCache';
import itemFixtures from './fixtures/items.json';

beforeEach(() => {
  registerServices({
    database: new MockDatabaseService({ items: itemFixtures.validItems }),
    storage: new MockStorageService(),
    cache: new MockCacheService(),
  });
});

afterEach(() => {
  clearServices();
});
```

### jest

```typescript
// jest.config.ts
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  setupFilesAfterSetup: ['<rootDir>/tests/setup.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/interfaces/**',
  ],
};
```

### mocha + chai + sinon

```yaml
# .mocharc.yml
require:
  - tsx
  - tests/setup.ts
spec: 'tests/**/*.test.ts'
recursive: true
timeout: 10000
```

```typescript
// tests/setup.ts (mocha version)
import { registerServices, clearServices } from '../src/services/registry';
import { MockDatabaseService } from './mocks/mockDatabase';
import { MockStorageService } from './mocks/mockStorage';
import { MockCacheService } from './mocks/mockCache';
import itemFixtures from './fixtures/items.json';

beforeEach(() => {
  registerServices({
    database: new MockDatabaseService({ items: itemFixtures.validItems }),
    storage: new MockStorageService(),
    cache: new MockCacheService(),
  });
});

afterEach(() => {
  clearServices();
});
```

---

## Validation — Zod

### Schema Definition

```typescript
// shared/schemas/validation.ts
import { z } from 'zod';

export const createItemSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional().default(''),
  price: z.number().positive('Price must be positive'),
  category: z.string().min(1, 'Category is required').max(100),
});

export const updateItemSchema = createItemSchema.partial();

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateItemRequest = z.infer<typeof createItemSchema>;
export type UpdateItemRequest = z.infer<typeof updateItemSchema>;
```

---

## Structured Logging — pino

### Logger Setup

```typescript
// src/logger.ts
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

export function getLogger(name?: string) {
  return name ? logger.child({ module: name }) : logger;
}
```

### Request Logging Middleware

```typescript
// middleware/requestLogger.ts
import { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getLogger } from '../logger';

const logger = getLogger('http');

export function logRequest(
  request: HttpRequest,
  response: HttpResponseInit,
  context: InvocationContext,
  durationMs: number
): void {
  logger.info({
    method: request.method,
    path: request.url,
    status: response.status || 200,
    durationMs,
    functionName: context.functionName,
  }, `${request.method} ${request.url} ${response.status || 200} ${durationMs}ms`);
}
```

---

## Shared Types

```typescript
// shared/types/entities.ts
export interface Item {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  createdAt: string;
  updatedAt: string;
}
```

```typescript
// shared/types/api.ts
import { Item } from './entities';

// Response contracts
export interface ListItemsResponse {
  items: Item[];
  total: number;
}

export interface SingleItemResponse {
  item: Item;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details: unknown | null;
  };
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: Record<string, boolean>;
}
```

---

## ESLint Configuration

Use ESLint's current flat configuration. The `_` convention from the scaffold rules is
valid only when the config explicitly ignores it:

```javascript
// eslint.config.mjs
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'coverage/**'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
```

---

## Dependencies Quick Reference

### Core Dependencies

| Package | Purpose |
|---------|---------|
| `@azure/functions` | Azure Functions v4 runtime |
| `zod` | Input validation |
| `pino` | Structured logging |
| `uuid` | ID generation |

### Per Service

| Service | Package |
|---------|---------|
| Blob Storage | `@azure/storage-blob` |
| PostgreSQL | `pg`, `@types/pg` |
| CosmosDB | `@azure/cosmos` |
| Redis | `ioredis` |
| Migrations | `knex` |

### Dev Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler |
| `vitest` / `jest` / `mocha` | Test runner (user's choice) |
| `eslint` + `@typescript-eslint/*` | Linting |
| `prettier` | Formatting |
| `tsx` | TypeScript execution (for scripts) |
| `pino-pretty` | Dev log formatting |
