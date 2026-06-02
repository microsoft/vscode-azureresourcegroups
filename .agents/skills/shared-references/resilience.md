# Resilience & Graceful Degradation

> Patterns for handling external service failures without crashing requests. Every external call must have a failure plan.

---

## Core Principle

**External service failures MUST NEVER crash the request unless the service is essential to the operation.** Every external dependency gets classified as **Essential** or **Enhancement**, and code must handle each accordingly.

---

## Service Dependency Classification

During Phase 1 planning, classify every external service:

| Type | Definition | Failure Behavior | Example |
|------|-----------|-----------------|---------|
| **Essential** | Request cannot produce meaningful result without this service | Propagate error to client (4xx/5xx) | Database, auth provider |
| **Enhancement** | Request can succeed with degraded output if unavailable | Catch error, use fallback, log warning | AI captions, email notifications, thumbnail generation, analytics |

This classification **MUST appear in the project plan** under "Service Dependency Classification".

---

## Rule: Enhancement Service Constructors Must Not Throw

> ⚠️ **#1 cause of "all tests pass but app doesn't start" failures** (identified across multiple benchmark runs).

Enhancement services must be safe to instantiate even when config is missing. Service registry's `initializeServices()` constructs ALL services at once — if any constructor throws, it cascades to crash every handler.

### The Problem

```typescript
// ❌ BAD — constructor validates config and throws when AZURE_OPENAI_ENDPOINT is empty
class AzureAICaptionService implements IAICaptionService {
  private endpoint: string;
  constructor() {
    const config = loadConfig();
    if (!config.openai.endpoint) {
      throw new Error('AZURE_OPENAI_ENDPOINT is required');  // 💥 Crashes initializeServices()
    }
    this.endpoint = config.openai.endpoint;
  }
}
```

When `initializeServices()` calls `new AzureAICaptionService()`, the throw prevents registry from initializing. Every subsequent `getServices()` call fails — crashing ALL handlers, even those that never use AI service.

Tests don't catch this because they call `registerServices()` with mocks, bypassing `initializeServices()` entirely.

### Solution A: Defer validation to method calls (Recommended)

```typescript
// ✅ GOOD — constructor never throws; validation happens at call time
class AzureAICaptionService implements IAICaptionService {
  private config: AppConfig;
  constructor() {
    this.config = loadConfig();
    // Do NOT validate — Enhancement services must survive missing config
  }

  async generateCaption(buffer: Buffer, mimeType: string): Promise<string> {
    if (!this.config.openai.endpoint || !this.config.openai.apiKey) {
      throw new Error('AI caption service not configured');
      // Handler's try/catch catches this and uses fallback caption
    }
    // ... actual implementation
  }

  async healthCheck(): Promise<boolean> {
    return !!(this.config.openai.endpoint && this.config.openai.apiKey);
  }
}
```

### Solution B: Wrap construction in registry

```typescript
// ✅ GOOD — registry catches Enhancement service construction failures
function initializeServices(): void {
  let aiCaption: IAICaptionService;
  try {
    aiCaption = new AzureOpenAICaptionService();
  } catch (err) {
    logger.warn({ err }, 'AI caption service unavailable, using no-op fallback');
    aiCaption = {
      generateCaption: async () => 'A special moment',
      healthCheck: async () => false,
    };
  }
  services = {
    database: new PostgresDatabaseService(),  // Essential — let it throw
    storage: new BlobStorageService(),         // Essential — let it throw
    aiCaption,                                  // Enhancement — caught above
  };
}
```

### Testing: Auto-initialization Test (Mandatory)

Every test suite MUST include a test verifying auto-initialization works without pre-registered mocks:

```typescript
describe('auto-initialization', () => {
  it('should survive missing Enhancement service config', () => {
    clearServices();
    // Only set Essential service env vars
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
    process.env.STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    // Enhancement env vars intentionally NOT set
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_API_KEY;
    // getServices() must NOT throw
    expect(() => getServices()).not.toThrow();
  });
});
```

---

## Pattern: Try/Fallback Wrapper

When a feature depends on Enhancement service, wrap call in try/catch with sensible default.

### TypeScript

```typescript
// BAD — AI failure crashes the entire photo upload
const caption = await aiCaption.generateCaption(buffer, mimeType);

// GOOD — AI failure degrades gracefully
let caption: string;
try {
  caption = await aiCaption.generateCaption(buffer, mimeType);
} catch (err) {
  logger.warn({ err }, 'Caption generation failed, using default');
  caption = 'A special moment 📸';
}
```

For Python and C# try/fallback patterns, see [runtimes/python.md](runtimes/python.md) and [runtimes/dotnet.md](runtimes/dotnet.md).

---

## Pattern: Timeouts

Every external HTTP/SDK call should have timeout to prevent hanging requests.

### TypeScript

```typescript
// Using AbortController (built-in)
async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn();
  } finally {
    clearTimeout(timeout);
  }
}

// Usage
const caption = await withTimeout(
  () => aiCaption.generateCaption(buffer, mimeType),
  10_000 // 10 seconds
);
```

For Python and C# timeout patterns, see [runtimes/python.md](runtimes/python.md) and [runtimes/dotnet.md](runtimes/dotnet.md).

---

## Pattern: Retry with Exponential Backoff

For transient failures (429 Too Many Requests, 503 Service Unavailable, network timeouts), retry with increasing delays.

### TypeScript

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; retryableErrors?: string[] } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 500 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;

      const isRetryable = err instanceof Error && (
        err.message.includes('ECONNRESET') ||
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('429') ||
        err.message.includes('503')
      );

      if (!isRetryable) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * delay * 0.1;
      await new Promise(r => setTimeout(r, delay + jitter));
    }
  }
  throw new Error('Unreachable');
}
```

For Python and C# retry patterns, see [runtimes/python.md](runtimes/python.md) and [runtimes/dotnet.md](runtimes/dotnet.md).

---

## Pattern: Parallel Independent Calls

When multiple independent external calls are needed for a single request, run them in parallel. Combine with try/fallback for Enhancement services.

### TypeScript

```typescript
// BAD — sequential (slow, and second call waits for first)
const blobUrl = await storage.upload('photos', blobName, buffer, file.type);
const caption = await aiCaption.generateCaption(buffer, file.type);

// GOOD — parallel, with fallback on enhancement service
const [blobUrl, caption] = await Promise.all([
  storage.upload('photos', blobName, buffer, file.type),  // Essential — let it throw
  aiCaption.generateCaption(buffer, file.type)             // Enhancement — catch
    .catch((err) => {
      logger.warn({ err }, 'Caption generation failed');
      return 'A special moment 📸';
    }),
]);
```

For Python and C# parallel call patterns, see [runtimes/python.md](runtimes/python.md) and [runtimes/dotnet.md](runtimes/dotnet.md).

---

## Testing Resilience

> ⚠️ **MANDATORY for every handler using Enhancement service.** Absence consistently flagged during scaffold benchmarking. See [testing.md](testing.md) → "Mandatory Test Patterns → Pattern 2" for complete typed test pattern.

Every Enhancement service wrapper must have tests verifying graceful degradation:

```typescript
describe('uploadPhoto', () => {
  it('should succeed with default caption when AI service fails', async () => {
    // Arrange: Make AI service throw
    const { aiCaption } = getServices();
    const mockAI = aiCaption as MockAICaptionService;
    mockAI.shouldFail = true;

    // Act: Upload should still succeed
    const response = await handlers.uploadPhoto(uploadRequest, createMockContext());

    // Assert: Photo created with default caption
    expect(response.status).toBe(201);
    expect(response.jsonBody.photo.caption).toBe('A special moment 📸');
  });

  it('should fail when storage service fails', async () => {
    // Arrange: Make essential service throw
    mockStorage.upload = vi.fn().mockRejectedValue(new Error('Storage down'));

    // Act & Assert: Upload should fail
    const response = await handlers.uploadPhoto(uploadRequest, createMockContext());
    expect(response.status).toBe(500);
  });
});
```

---

## Checklist

When implementing a function handler that calls external services:

- [ ] Classify each service call as Essential or Enhancement
- [ ] Enhancement services wrapped in try/catch with fallback
- [ ] Essential services propagate errors to error handler
- [ ] Independent calls parallelized with `Promise.all` / `asyncio.gather` / `Task.WhenAll`
- [ ] **Tests verify handler succeeds when Enhancement services fail** (MANDATORY — see Pattern 2 in testing.md)
- [ ] Tests verify handler fails correctly when Essential services fail
