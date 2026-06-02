# Resilience & Graceful Degradation

> Patterns for handling external service failures without crashing requests. Every external call must have a plan for when it fails.

---

## Core Principle

**External service failures must never crash the request unless the service is essential to the operation.** Every external dependency gets classified as **Essential** or **Enhancement**, and the code must handle each accordingly.

---

## Service Dependency Classification

During Phase 1 planning, classify every external service:

| Type | Definition | Failure Behavior | Example |
|------|-----------|-----------------|---------|
| **Essential** | The request cannot produce a meaningful result without this service | Propagate error to client (4xx/5xx) | Database, auth provider |
| **Enhancement** | The request can succeed with degraded output if this service is unavailable | Catch error, use fallback, log warning | AI captions, email notifications, thumbnail generation, analytics |

This classification **MUST appear in the project plan** under "Service Dependency Classification".

---

## Pattern: Try/Fallback Wrapper

When a feature depends on an Enhancement service, wrap the call in try/catch with a sensible default.

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

### Python

```python
# BAD
caption = await ai_caption.generate_caption(image_buffer, mime_type)

# GOOD
try:
    caption = await ai_caption.generate_caption(image_buffer, mime_type)
except Exception as e:
    logger.warning("Caption generation failed, using default", error=str(e))
    caption = "A special moment 📸"
```

### C#

```csharp
// BAD
var caption = await _aiCaption.GenerateCaptionAsync(buffer, mimeType);

// GOOD
string caption;
try
{
    caption = await _aiCaption.GenerateCaptionAsync(buffer, mimeType);
}
catch (Exception ex)
{
    _logger.LogWarning(ex, "Caption generation failed, using default");
    caption = "A special moment 📸";
}
```

---

## Pattern: Timeouts

Every external HTTP/SDK call should have a timeout to prevent hanging requests.

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

### Python

```python
import asyncio

async def with_timeout(coro, timeout_seconds: float):
    return await asyncio.wait_for(coro, timeout=timeout_seconds)

# Usage
caption = await with_timeout(
    ai_caption.generate_caption(buffer, mime_type),
    timeout_seconds=10.0
)
```

### C#

```csharp
// Using CancellationTokenSource
using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
var caption = await _aiCaption.GenerateCaptionAsync(buffer, mimeType, cts.Token);
```

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

### Python

```python
import asyncio
import random

async def with_retry(fn, max_retries=3, base_delay=0.5):
    for attempt in range(max_retries + 1):
        try:
            return await fn()
        except Exception as e:
            if attempt == max_retries:
                raise
            delay = base_delay * (2 ** attempt)
            jitter = random.uniform(0, delay * 0.1)
            await asyncio.sleep(delay + jitter)
```

### C#

```csharp
public static async Task<T> WithRetryAsync<T>(
    Func<Task<T>> fn,
    int maxRetries = 3,
    int baseDelayMs = 500)
{
    for (int attempt = 0; attempt <= maxRetries; attempt++)
    {
        try
        {
            return await fn();
        }
        catch (Exception) when (attempt < maxRetries)
        {
            var delay = baseDelayMs * Math.Pow(2, attempt);
            var jitter = Random.Shared.NextDouble() * delay * 0.1;
            await Task.Delay((int)(delay + jitter));
        }
    }
    throw new InvalidOperationException("Unreachable");
}
```

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

### Python

```python
import asyncio

# Parallel with fallback
async def safe_caption(buffer, mime_type):
    try:
        return await ai_caption.generate_caption(buffer, mime_type)
    except Exception as e:
        logger.warning("Caption failed", error=str(e))
        return "A special moment 📸"

blob_url, caption = await asyncio.gather(
    storage.upload("photos", blob_name, buffer, file_type),
    safe_caption(buffer, file_type),
)
```

---

## Testing Resilience

Every Enhancement service wrapper must have tests verifying graceful degradation:

```typescript
describe('uploadPhoto', () => {
  it('should succeed with default caption when AI service fails', async () => {
    // Arrange: Make AI service throw
    mockAICaption.generateCaption = vi.fn().mockRejectedValue(new Error('AI down'));

    // Act: Upload should still succeed
    const response = await handler(uploadRequest, mockContext);

    // Assert: Photo created with default caption
    expect(response.status).toBe(201);
    expect(response.jsonBody.photo.caption).toBe('A special moment 📸');
  });

  it('should fail when storage service fails', async () => {
    // Arrange: Make essential service throw
    mockStorage.upload = vi.fn().mockRejectedValue(new Error('Storage down'));

    // Act & Assert: Upload should fail
    const response = await handler(uploadRequest, mockContext);
    expect(response.status).toBe(500);
  });
});
```

---

## Checklist

When implementing a function handler that calls external services:

- [ ] Classify each service call as Essential or Enhancement
- [ ] Enhancement services are wrapped in try/catch with fallback
- [ ] Essential services propagate errors to the error handler
- [ ] Independent calls are parallelized with `Promise.all` / `asyncio.gather` / `Task.WhenAll`
- [ ] Tests verify the handler succeeds when Enhancement services fail
- [ ] Tests verify the handler fails correctly when Essential services fail
