# Error Handling

> Standardized error responses, error types, and middleware for consistent error handling across all routes.

---

## Core Principle

**Every route returns errors in a consistent shape.** Clients rely on single error format for all endpoints. Error paths tested as thoroughly as happy paths.

---

## Standardized Error Response Shape

All error responses follow this shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Item with ID 'xyz' was not found",
    "details": null
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `error.code` | `string` | Machine-readable error code (e.g., `VALIDATION_ERROR`, `NOT_FOUND`) |
| `error.message` | `string` | Human-readable error description |
| `error.details` | `any?` | Optional extra details (validation errors, field-level issues). **Omitted in production** for security-sensitive errors. |

---

## Error Code → HTTP Status Mapping

| Error Code | HTTP Status | When |
|------------|-------------|------|
| `VALIDATION_ERROR` | 422 | Request body fails validation (Zod/Pydantic/FluentValidation) |
| `BAD_REQUEST` | 400 | Malformed request (missing params, wrong content type) |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `CONFLICT` | 409 | Duplicate resource or state conflict |
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `FORBIDDEN` | 403 | Valid auth but insufficient permissions |
| `INTERNAL_ERROR` | 500 | Unhandled exception or service failure |

---

## Error Code Type Safety

Error codes MUST be defined as typed union in shared types package, not arbitrary strings. Enables frontend consumers to switch on error codes with exhaustiveness checking.

### TypeScript

```typescript
// shared/types/errors.ts
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR';

export interface ErrorResponse {
  error: {
    code: ErrorCode;     // ← typed union, not string
    message: string;
    details: Record<string, unknown> | null;
  };
}
```

### Python

```python
# shared/types.py
from enum import Enum

class ErrorCode(str, Enum):
    VALIDATION_ERROR = "VALIDATION_ERROR"
    BAD_REQUEST = "BAD_REQUEST"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    INTERNAL_ERROR = "INTERNAL_ERROR"
```

### C#

```csharp
// Shared/ErrorCode.cs
public static class ErrorCodes
{
    public const string ValidationError = "VALIDATION_ERROR";
    public const string BadRequest = "BAD_REQUEST";
    public const string NotFound = "NOT_FOUND";
    public const string Conflict = "CONFLICT";
    public const string Unauthorized = "UNAUTHORIZED";
    public const string Forbidden = "FORBIDDEN";
    public const string InternalError = "INTERNAL_ERROR";
}
```

### Frontend Usage

With typed error codes, frontend can handle specific error types:

```typescript
import type { ErrorCode } from 'app-shared';

function handleApiError(code: ErrorCode, message: string) {
  switch (code) {
    case 'UNAUTHORIZED':
      // Redirect to login
      break;
    case 'CONFLICT':
      // Show "already exists" message
      break;
    case 'VALIDATION_ERROR':
      // Show field-level errors
      break;
    default:
      // Show generic error
      break;
  }
}
```

---

## TypeScript Implementation

### Error Types

```typescript
// errors/AppError.ts
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = this.constructor.name;
  }
}
```

```typescript
// errors/errorTypes.ts
import { AppError } from './AppError';

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(404, 'NOT_FOUND', `${resource} with ID '${id}' was not found`);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(422, 'VALIDATION_ERROR', message, details);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, 'BAD_REQUEST', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(403, 'FORBIDDEN', message);
  }
}
```

### Error Handler

```typescript
// errors/errorHandler.ts
import { HttpResponseInit, InvocationContext } from '@azure/functions';
import { AppError } from './AppError';
import { ZodError } from 'zod';
import { getLogger } from '../logger';

const logger = getLogger();

export function handleError(error: unknown, context: InvocationContext): HttpResponseInit {
  // Known application errors
  if (error instanceof AppError) {
    logger.warn({ err: error, code: error.code }, error.message);
    return {
      status: error.statusCode,
      jsonBody: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      },
    };
  }

  // Zod validation errors → map to ValidationError shape
  if (error instanceof ZodError) {
    const details = error.errors.map(e => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    logger.warn({ err: error, details }, 'Validation failed');
    return {
      status: 422,
      jsonBody: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details,
        },
      },
    };
  }

  // Unknown errors → 500
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error({ err }, 'Unhandled error');
  
  return {
    status: 500,
    jsonBody: {
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production'
          ? 'An internal error occurred'
          : err.message,
        details: null,
      },
    },
  };
}
```

### Request Validation Middleware

```typescript
// middleware/validateRequest.ts
import { HttpRequest } from '@azure/functions';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../errors/errorTypes';

export async function validateBody<T>(request: HttpRequest, schema: ZodSchema<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const details = result.error.errors.map(e => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    throw new ValidationError('Request validation failed', details);
  }
  return result.data;
}

export function validateParams(params: Record<string, string>, required: string[]): void {
  const missing = required.filter(key => !params[key]);
  if (missing.length > 0) {
    throw new ValidationError(`Missing required parameters: ${missing.join(', ')}`);
  }
}
```

### Usage in Function Handlers

```typescript
// functions/createItem.ts
import { app } from '@azure/functions';
import { getServices } from '../services/registry';
import { handleError } from '../errors/errorHandler';
import { validateBody } from '../middleware/validateRequest';
import { createItemSchema } from '../../shared/schemas/validation';
import { v4 as uuid } from 'uuid';

app.http('createItem', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'items',
  handler: async (request, context) => {
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
  }
});
```

---

For Python error handling, see [runtimes/python.md](runtimes/python.md). For C#, see [runtimes/dotnet.md](runtimes/dotnet.md).

---

## Testing Error Handling

### TypeScript Tests

```typescript
// tests/errors/errorHandler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleError } from '../../src/errors/errorHandler';
import { NotFoundError, ValidationError, BadRequestError } from '../../src/errors/errorTypes';
import { InvocationContext } from '@azure/functions';

const mockContext = { log: vi.fn() } as unknown as InvocationContext;

describe('errorHandler', () => {
  it('should return 404 for NotFoundError', () => {
    const error = new NotFoundError('Item', 'abc-123');
    const response = handleError(error, mockContext);

    expect(response.status).toBe(404);
    expect(response.jsonBody).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: "Item with ID 'abc-123' was not found",
        details: null,
      },
    });
  });

  it('should return 422 for ValidationError', () => {
    const details = [{ field: 'name', message: 'Required' }];
    const error = new ValidationError('Validation failed', details);
    const response = handleError(error, mockContext);

    expect(response.status).toBe(422);
    expect(response.jsonBody.error.code).toBe('VALIDATION_ERROR');
    expect(response.jsonBody.error.details).toEqual(details);
  });

  it('should return 400 for BadRequestError', () => {
    const error = new BadRequestError('Missing content type');
    const response = handleError(error, mockContext);

    expect(response.status).toBe(400);
    expect(response.jsonBody.error.code).toBe('BAD_REQUEST');
  });

  it('should return 500 for unknown errors', () => {
    const error = new Error('Something broke');
    const response = handleError(error, mockContext);

    expect(response.status).toBe(500);
    expect(response.jsonBody.error.code).toBe('INTERNAL_ERROR');
  });

  it('should return consistent error shape for all error types', () => {
    const errors = [
      new NotFoundError('Item', '1'),
      new ValidationError('Bad input'),
      new BadRequestError('Bad request'),
      new Error('Unknown'),
    ];

    for (const error of errors) {
      const response = handleError(error, mockContext);
      expect(response.jsonBody).toHaveProperty('error');
      expect(response.jsonBody.error).toHaveProperty('code');
      expect(response.jsonBody.error).toHaveProperty('message');
      expect(response.jsonBody.error).toHaveProperty('details');
    }
  });
});
```

### Validation Schema Tests

```typescript
// tests/validation/itemSchema.test.ts
import { describe, it, expect } from 'vitest';
import { createItemSchema } from '../../src/shared/schemas/validation';

describe('createItemSchema', () => {
  it('should pass with valid input', () => {
    const result = createItemSchema.safeParse({
      name: 'Widget',
      description: 'A nice widget',
      price: 29.99,
      category: 'widgets',
    });
    expect(result.success).toBe(true);
  });

  it('should fail when name is empty', () => {
    const result = createItemSchema.safeParse({
      name: '',
      description: 'A widget',
      price: 29.99,
      category: 'widgets',
    });
    expect(result.success).toBe(false);
  });

  it('should fail when price is negative', () => {
    const result = createItemSchema.safeParse({
      name: 'Widget',
      description: 'A widget',
      price: -5,
      category: 'widgets',
    });
    expect(result.success).toBe(false);
  });

  it('should fail when required fields are missing', () => {
    const result = createItemSchema.safeParse({
      description: 'Just a description',
    });
    expect(result.success).toBe(false);
  });

  it('should fail when name is not a string', () => {
    const result = createItemSchema.safeParse({
      name: 123,
      description: 'A widget',
      price: 29.99,
      category: 'widgets',
    });
    expect(result.success).toBe(false);
  });
});
```

---

## Validation Library Quick Reference

| Runtime | Library | Schema Example |
|---------|---------|---------------|
| TypeScript | **Zod** | `z.object({ name: z.string().min(1), price: z.number().positive() })` |
| Python | **Pydantic** | `class CreateItem(BaseModel): name: str = Field(min_length=1); price: float = Field(gt=0)` |
| C# | **FluentValidation** | `RuleFor(x => x.Name).NotEmpty(); RuleFor(x => x.Price).GreaterThan(0);` |
