# Handler Test Patterns

> Boilerplate and required-test matrix for handler tests. Read during **Step V6** (Handler Tests).

---

## Typed Test Helper Pattern (Zero `any` Policy)

> Test files MUST have zero `any` types. Use typed interfaces for mock request/context objects instead of `as any` casts. Enforced during Step V7 (Lint Sweep).

### TypeScript — Typed Mock Helpers

```typescript
// tests/helpers.ts
import jwt from 'jsonwebtoken';
import { HttpResponseInit } from '@azure/functions';

export function makeToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, 'test-secret', { expiresIn: '1h' });
}

// Typed interfaces — eliminates all `as any` casts
export interface MockHttpRequest {
  method: string;
  url: string;
  headers: { get: (key: string) => string | null };
  params: Record<string, string>;
  query: { get: (key: string) => string | null };
  json: () => Promise<unknown>;
  formData: () => Promise<unknown>;
}

export interface MockInvocationContext {
  functionName: string;
  log: ReturnType<typeof vi.fn>;
  extraInputs: { get: ReturnType<typeof vi.fn> };
  extraOutputs: { set: ReturnType<typeof vi.fn> };
}

// Handler function type — used instead of `Record<string, Function>`
export type HandlerFn = (
  request: MockHttpRequest,
  context: MockInvocationContext
) => Promise<HttpResponseInit>;

export interface MockRequestOptions {
  method?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  query?: Record<string, string>;
  formData?: () => Promise<unknown>;
}

export function createMockRequest(opts: MockRequestOptions): MockHttpRequest {
  const url = new URL('http://localhost:7071/api/test');
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      url.searchParams.set(k, v);
    }
  }
  return {
    method: opts.method || 'GET',
    url: url.toString(),
    headers: {
      get: (key: string) => {
        const h = opts.headers || {};
        return h[key] || h[key.toLowerCase()] || null;
      },
    },
    params: opts.params || {},
    query: { get: (key: string) => url.searchParams.get(key) },
    json: async () => opts.body || {},
    formData: opts.formData || (async () => { throw new Error('No form data'); }),
  };
}

export function createMockContext(): MockInvocationContext {
  return {
    functionName: 'test',
    log: vi.fn(),
    extraInputs: { get: vi.fn() },
    extraOutputs: { set: vi.fn() },
  };
}
```

---

## Handler Test Template (TypeScript)

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getServices } from '../../src/services/registry.js';
import { createMockContext, createMockRequest, createAuthenticatedRequest } from '../helpers.js';
import type { HandlerFn } from '../helpers.js';

// Typed handler map — NOT Record<string, Function>
const handlers: Record<string, HandlerFn> = {};

vi.mock('@azure/functions', () => ({
  app: {
    http: (name: string, options: { handler: HandlerFn }) => {
      handlers[name] = options.handler;
    },
  },
  HttpRequest: vi.fn(),
  InvocationContext: vi.fn(),
}));

await import('../../src/functions/{handlerName}.js');

describe('{METHOD} {route}', () => {
  beforeEach(async () => {
    const { database } = getServices();
    // Seed fixture data...
  });

  it('happy path', async () => { /* ... */ });
  it('error path', async () => { /* ... */ });
});
```

> ❌ **Anti-patterns to reject during Step V7**:
> ```typescript
> const handlers: Record<string, Function> = {};  // ← Use HandlerFn
> const ctx = { log: vi.fn() } as any;             // ← Use createMockContext()
> (options: any) => { ... }                         // ← Use { handler: HandlerFn }
> ```

---

## Required Tests Per Handler

| Category | Tests | Rigor |
|----------|-------|-------|
| Happy path (2xx) | Correct status + response shape | All |
| Validation error (422) | Invalid input rejected | All |
| Not found (404) | Missing resource | Full + Partial |
| Auth error (401) | Missing/invalid token (if auth required) | Full + Partial |
| Forbidden (403) | Wrong permissions | Full + Partial |
| Conflict (409) | Duplicate resource | Full + Partial |
| **Enhancement resilience** | Enhancement service throws → handler still returns success with fallback | Full + Partial (MANDATORY for Enhancement handlers) |

### Partial Rigor Shortcuts

- Skip `getPhotoById` if `getPhotos` tested
- Skip redundant error codes already tested in other handlers
- Keep resilience test for at least one Enhancement handler

---

## Test Naming Conventions

Use descriptive test names documenting behavior:

```
✅ "should return 200 with list of items when items exist"
✅ "should return 404 when item ID does not exist"
✅ "should return 422 when name is empty string"
✅ "should return 500 when database connection fails"

❌ "test1"
❌ "getItems test"
❌ "works"
```

### Convention by Runtime

| Runtime | Pattern | Example |
|---------|---------|---------|
| TypeScript | `it('should {behavior} when {condition}')` | `it('should return 404 when item not found')` |
| Python | `def test_{behavior}_when_{condition}()` | `def test_returns_404_when_item_not_found()` |
| C# | `{Method}_{Condition}_{Expected}` | `GetItemById_ItemNotFound_Returns404()` |
