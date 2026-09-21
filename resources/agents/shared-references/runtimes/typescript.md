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
    "AZURE_FUNCTIONS_ENVIRONMENT": "Development",
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

> `local.settings.json`: plain JSON; **no** `${...}` interpolation.
> Replace `<POSTGRES_USER>` / `<POSTGRES_PASSWORD>` with matching discrete values from docker-compose's
> workspace-root `.env`. Never leave placeholders or paste credentials from tool output: redaction
> rewrites concrete credential URLs; masked values starting with `*` corrupt YAML/JSON config.

### tsconfig.json

> ⚠️ Imports from `../shared/` require `rootDir` = `".."`. This changes `dist/` output; see `main` below.

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

> ⚠️ **`main` MUST match actual `dist/` output.** With `rootDir: ".."`, handlers compile to `dist/functions/src/functions/*.js`, not `dist/src/functions/*.js`. After `tsc`, verify `main` resolves from `dist/`.

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

> Set `scripts.test` for user's test runner.

> ⚠️ **Deployment contract: ship prebuilt artifact; do NOT rebuild server-side.**
> Deploy **compiled `dist/`**, not TypeScript source. `azd` builds locally (`npm install` + `npm run build`) and packages output; Kudu/Oryx runs production-only `npm install --omit=dev`. If deployed `package.json` triggers `npm run build`, Oryx lacks `typescript` (a `devDependency`) and fails `tsc: not found`. Scaffold standalone artifacts:
> - **Dependency split is load-bearing.** Put every runtime-code (`dist/**/*.js`) import in `dependencies`; put build-only tools (`typescript`, `@types/*`, test runners, bundlers) in `devDependencies`. Production `--omit=dev` must satisfy every `require`/`import` in `dist/`.
> - **Compiled output self-sufficient.** `dist/` must neither import `src/` nor require rebuilding. `main` targets compiled `.js` (Rule 12), never `.ts`.
> - **Disable server build; don't strip scripts.** Ship prebuilt `dist/`; turn platform build **off** (`SCM_DO_BUILD_DURING_DEPLOYMENT=false` / `azd` `host: function` remote build disabled). Do **not** use `prepackage`/`postpackage` hooks to temporarily remove (`build`, `watch`, `clean`, `prestart`) from `package.json`; fix unwanted rebuild's cause. Deploy agent owns config; scaffold guarantees clean prebuilt deployment via this split.
> - **Native modules stay external.** Compiled native addons (`bcrypt`, `sharp`, `better-sqlite3`, Prisma engines, …) are OS/arch-specific. Keep in `dependencies`, installed on Linux host; never bundle binaries from Windows/macOS builds.

> ⚠️ **Monorepo / npm workspaces: each service self-contained.**
> Services deploy **independently** (one `azure.yaml` service = one artifact). npm workspaces **hoist** `node_modules` and one lockfile to repo root, leaving per-service zips without local `node_modules` or standalone root-linked deps ("43KB zip / `Cannot find module 'shared'`"). Make services standalone; **default needs no bundler**:
> - **Compile `shared` through relative imports (preferred).** Import by **relative path** (`../../shared/...`), not workspace package (`@app/shared`). With `rootDir: ".."` + `../shared` in `include`, `tsc` emits `shared` into service `dist/`, eliminating `shared` runtime resolution and fixing per-service `Cannot find module 'shared'`. If using `shared` as workspace package, vendor or bundle its compiled output.
> - **Resolve third-party deps per service.** Since deps hoist, either (a) install production `node_modules` *inside service directory* via isolated `npm install --omit=dev`, or (b) let platform production-install from service `package.json` + lockfile (disable only *build*, keep *install*). Install native addons on Linux host; never copy Windows/macOS `node_modules`.
> - **Optional single-file bundle.** For cold-start-sensitive or single-artifact needs, `esbuild --bundle --packages=external` from `src/index.ts` importing every handler, with `main` targeting `dist/index.js`, inlines first-party code (including `shared`) while leaving npm deps external. This avoids both issues but **departs from idiomatic per-file layout** (Microsoft `func init --model V4`: modular handlers + glob `main` compiled by `tsc`); opt-in only, not default.

---

## Function Handler Pattern

> ⚠️ **Always set `status` explicitly**, including 200. Never rely on default; keeps assertions consistent and avoids `undefined` vs `200`.

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

> ⚠️ **MANDATORY with heavy SDK imports** (pg, @azure/storage-blob, etc.):
> - `fileParallelism: false` — Prevent memory exhaustion from concurrent workers loading heavy SDKs.
> - `teardownTimeout: 3000` — Kill lingering connections (e.g., `pg.Pool`) after tests.
> - `testTimeout: 10000` — Prevent false failures on slow CI.
>
> Without these, 13+ heavy-SDK test files **hang indefinitely**. #1 test infrastructure issue.

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

```json
// .eslintrc.json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": "off",
    "no-console": ["warn", { "allow": ["warn", "error"] }]
  },
  "env": {
    "node": true,
    "es2022": true
  }
}
```

---

## Dependencies Quick Reference

### Core Dependencies

| Package | Purpose |
|---------|---------|
| `@azure/functions` | Azure Functions v4 runtime |
| `zod` | Validation |
| `pino` | Structured logs |
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
| `vitest` / `jest` / `mocha` | User-selected test runner |
| `eslint` + `@typescript-eslint/*` | Lint |
| `prettier` | Format |
| `tsx` | Script TypeScript execution |
| `pino-pretty` | Dev log format |
