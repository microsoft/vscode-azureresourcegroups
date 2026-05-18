# Testing Patterns

> Core reference for self-testable north star. Every module ships with tests. Every phase has test gate.

---

## Core Principle

**Project is not done until tests say it is.**

Agent runs tests after every module. If tests fail, agent iterates until they pass. No module complete until tests green. Not a suggestion — it's workflow.

---

## Test Pyramid

```
           ┌─────────────┐
           │   E2E /      │  ← Full request-response cycle
           │  Integration  │     with real/mock services
           ├──────────────┤
           │              │
           │    Unit       │  ← Fast, isolated, mocked deps
           │              │
           └──────────────┘
```

| Layer | What It Tests | Dependencies | Speed | When |
|-------|---------------|-------------|-------|------|
| **Unit** | Single function/class in isolation | All deps mocked | Fast (ms) | Every module, always |
| **Integration** | Request → handler → service → response cycle | Mock services injected | Fast (ms) | Every route, always |
| **E2E** | Full stack with real emulators | Running emulators (via local-dev) | Slower (s) | When emulators are available |

### What Each Layer Covers

**Unit Tests** (mandatory for every module):
- Service abstraction methods (with mock storage/DB/cache)
- Config loading (env vars present, missing, defaults)
- Validation schemas (valid input, invalid input, edge cases)
- Error types and error handler (mapping to HTTP status codes)
- Individual function handler logic (with injected mock services)
- Utility functions and helpers

**Integration Tests** (mandatory for every route):
- HTTP request → function handler → mock service → HTTP response
- Correct status codes (200, 201, 400, 404, 422, 500)
- Correct response body shapes
- Request validation (bad input rejected)
- Error handling (service failures produce correct error responses)

**E2E Tests** (when emulators available via local-dev):
- Full DB round-trip (create → read → verify data)
- File upload → storage → retrieval
- Cache set → get → verify
- Health check with live services

---

## Test Runner Quick Reference

### Node.js (TypeScript)

| Runner | Setup | Config File | Test Command | Mock Library | Assertion Library |
|--------|-------|-------------|-------------|-------------|------------------|
| **vitest** | `npm i -D vitest` | `vitest.config.ts` | `npx vitest run` | Built-in `vi.mock()` | Built-in `expect` |
| **jest** | `npm i -D jest ts-jest @types/jest` | `jest.config.ts` | `npx jest` | Built-in `jest.mock()` | Built-in `expect` |
| **mocha+chai+sinon** | `npm i -D mocha chai sinon @types/mocha @types/chai @types/sinon tsx` | `.mocharc.yml` | `npx mocha` | sinon | chai `expect` |

#### vitest config example
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/interfaces/**']
    }
  }
});
```

#### jest config example
```typescript
// jest.config.ts
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/interfaces/**']
};
```

#### mocha config example
```yaml
# .mocharc.yml
require:
  - tsx
spec: 'tests/**/*.test.ts'
recursive: true
timeout: 5000
```

### Python

| Runner | Setup | Config | Test Command | Mock Library | Assertion |
|--------|-------|--------|-------------|-------------|-----------|
| **pytest** | `pip install pytest pytest-cov pytest-asyncio` | `pytest.ini` or `pyproject.toml` | `pytest` | `unittest.mock` | Built-in `assert` |

```ini
# pytest.ini
[pytest]
testpaths = tests
python_files = test_*.py
python_functions = test_*
asyncio_mode = auto
```

### .NET

| Runner | Setup | Config | Test Command | Mock Library | Assertion |
|--------|-------|--------|-------------|-------------|-----------|
| **xUnit** | NuGet: `xunit`, `xunit.runner.visualstudio`, `Microsoft.NET.Test.Sdk` | `.csproj` | `dotnet test` | Moq or NSubstitute | xUnit `Assert` or FluentAssertions |
| **NUnit** | NuGet: `NUnit`, `NUnit3TestAdapter`, `Microsoft.NET.Test.Sdk` | `.csproj` | `dotnet test` | Moq or NSubstitute | NUnit `Assert` or FluentAssertions |

---

## Mock Data Patterns

### Fixture Files (JSON)

Store realistic mock data in `tests/fixtures/`:
```json
// tests/fixtures/items.json
{
  "validItems": [
    {
      "id": "item-001",
      "name": "Widget Alpha",
      "description": "A high-quality widget for testing",
      "price": 29.99,
      "category": "widgets",
      "createdAt": "2026-01-15T10:30:00.000Z",
      "updatedAt": "2026-01-15T10:30:00.000Z"
    },
    {
      "id": "item-002",
      "name": "Gadget Beta",
      "description": "An innovative gadget",
      "price": 49.99,
      "category": "gadgets",
      "createdAt": "2026-02-20T14:00:00.000Z",
      "updatedAt": "2026-03-01T09:15:00.000Z"
    }
  ],
  "invalidItems": [
    { "name": "", "description": "Missing name" },
    { "name": "X", "price": -5, "description": "Invalid price" },
    { "description": "No name field at all" }
  ],
  "createItemRequest": {
    "name": "New Widget",
    "description": "A brand new widget",
    "price": 19.99,
    "category": "widgets"
  }
}
```

### Factory Functions

For dynamic mock data, use factory functions:
```typescript
// tests/fixtures/itemFactory.ts
import { Item, CreateItemRequest } from '../../src/shared/types/entities';

let counter = 0;

export function createMockItem(overrides?: Partial<Item>): Item {
  counter++;
  return {
    id: `item-${counter.toString().padStart(3, '0')}`,
    name: `Test Item ${counter}`,
    description: `Description for test item ${counter}`,
    price: 9.99 + counter,
    category: 'test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

export function createMockCreateRequest(overrides?: Partial<CreateItemRequest>): CreateItemRequest {
  counter++;
  return {
    name: `New Item ${counter}`,
    description: `New item description ${counter}`,
    price: 19.99,
    category: 'test',
    ...overrides
  };
}
```

### Python Fixtures (pytest)

```python
# tests/conftest.py
import pytest
import json
from pathlib import Path

@pytest.fixture
def item_fixtures():
    fixture_path = Path(__file__).parent / "fixtures" / "items.json"
    with open(fixture_path) as f:
        return json.load(f)

@pytest.fixture
def valid_item(item_fixtures):
    return item_fixtures["validItems"][0]

@pytest.fixture
def invalid_item(item_fixtures):
    return item_fixtures["invalidItems"][0]

@pytest.fixture
def mock_database():
    """Returns mock database service with pre-loaded data."""
    from services.interfaces import IDatabaseService
    from unittest.mock import MagicMock
    
    db = MagicMock(spec=IDatabaseService)
    # Configure default returns
    db.find_all.return_value = []
    db.find_by_id.return_value = None
    return db
```

### C# Fixtures

```csharp
// Fixtures/ItemFixtures.cs
public static class ItemFixtures
{
    public static Item CreateValidItem(string? id = null) => new()
    {
        Id = id ?? Guid.NewGuid().ToString(),
        Name = "Test Widget",
        Description = "A test widget",
        Price = 29.99m,
        Category = "widgets",
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow
    };

    public static CreateItemRequest CreateValidRequest() => new()
    {
        Name = "New Widget",
        Description = "A brand new widget",
        Price = 19.99m,
        Category = "widgets"
    };

    public static List<Item> CreateItemList(int count = 5) =>
        Enumerable.Range(1, count)
            .Select(i => CreateValidItem($"item-{i:D3}"))
            .ToList();
}
```

---

## Service Mocking Patterns

### TypeScript — vitest

```typescript
// tests/mocks/mockDatabase.ts
import { IDatabaseService } from '../../src/services/interfaces/IDatabaseService';
import { Item } from '../../src/shared/types/entities';

export function createMockDatabase(initialData: Item[] = []): IDatabaseService {
  const store = new Map<string, Item>();
  initialData.forEach(item => store.set(item.id, item));

  return {
    findAll: async () => Array.from(store.values()),
    findById: async (id: string) => store.get(id) ?? null,
    create: async (item: Item) => { store.set(item.id, item); return item; },
    update: async (id: string, data: Partial<Item>) => {
      const existing = store.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
      store.set(id, updated);
      return updated;
    },
    delete: async (id: string) => { return store.delete(id); },
    healthCheck: async () => true
  };
}
```

```typescript
// tests/functions/getItems.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockDatabase } from '../mocks/mockDatabase';
import { createMockItem } from '../fixtures/itemFactory';

describe('getItems', () => {
  let mockDb: IDatabaseService;
  const testItems = [createMockItem(), createMockItem()];

  beforeEach(() => {
    mockDb = createMockDatabase(testItems);
  });

  it('should return all items', async () => {
    const items = await mockDb.findAll();
    expect(items).toHaveLength(2);
  });

  it('should return empty array when no items', async () => {
    mockDb = createMockDatabase([]);
    const items = await mockDb.findAll();
    expect(items).toEqual([]);
  });
});
```

### TypeScript — mocha + chai + sinon

```typescript
// tests/functions/getItems.test.ts
import { expect } from 'chai';
import sinon from 'sinon';
import { createMockDatabase } from '../mocks/mockDatabase';
import { createMockItem } from '../fixtures/itemFactory';

describe('getItems', () => {
  let mockDb: IDatabaseService;
  const testItems = [createMockItem(), createMockItem()];

  beforeEach(() => {
    mockDb = createMockDatabase(testItems);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should return all items', async () => {
    const items = await mockDb.findAll();
    expect(items).to.have.lengthOf(2);
  });

  it('should return empty array when no items', async () => {
    mockDb = createMockDatabase([]);
    const items = await mockDb.findAll();
    expect(items).to.deep.equal([]);
  });
});
```

### Python — pytest + unittest.mock

```python
# tests/test_get_items.py
import pytest
from unittest.mock import AsyncMock, MagicMock
from services.interfaces import IDatabaseService

@pytest.fixture
def mock_database(item_fixtures):
    db = MagicMock(spec=IDatabaseService)
    db.find_all = AsyncMock(return_value=item_fixtures["validItems"])
    db.find_by_id = AsyncMock(return_value=item_fixtures["validItems"][0])
    return db

async def test_get_items_returns_all(mock_database, item_fixtures):
    items = await mock_database.find_all()
    assert len(items) == len(item_fixtures["validItems"])

async def test_get_items_empty(mock_database):
    mock_database.find_all = AsyncMock(return_value=[])
    items = await mock_database.find_all()
    assert items == []
```

### C# — xUnit + Moq

```csharp
// Functions/GetItemsTests.cs
public class GetItemsTests
{
    private readonly Mock<IDatabaseService> _mockDb;

    public GetItemsTests()
    {
        _mockDb = new Mock<IDatabaseService>();
    }

    [Fact]
    public async Task GetItems_ReturnsAllItems()
    {
        var items = ItemFixtures.CreateItemList(3);
        _mockDb.Setup(db => db.FindAllAsync()).ReturnsAsync(items);

        var result = await _mockDb.Object.FindAllAsync();

        Assert.Equal(3, result.Count);
    }

    [Fact]
    public async Task GetItems_ReturnsEmptyList()
    {
        _mockDb.Setup(db => db.FindAllAsync()).ReturnsAsync(new List<Item>());

        var result = await _mockDb.Object.FindAllAsync();

        Assert.Empty(result);
    }
}
```

---

## Test Gate Enforcement

Agent MUST follow this workflow at every test gate:

### 1. Run Tests

```bash
# TypeScript
npm test
# or: npx vitest run
# or: npx jest
# or: npx mocha

# Python
pytest

# .NET
dotnet test
```

### 2. Parse Output

Look for:
- **Pass**: All tests passed, zero failures → proceed to next phase
- **Fail**: One or more tests failed → DO NOT proceed
### 3. If Tests Fail

1. Read failure output — identify which test failed and why
2. Determine if issue is in **code** or **test**
3. Fix issue
4. Re-run tests
5. Repeat until ALL tests pass

### 4. If Tests Pass

1. Mark current phase's checklist items as complete in `.azure/project-plan.md`
2. Proceed to next phase

### Decision Tree

```
Run tests
    │
    ├── ALL PASS ──→ Mark phase complete → Proceed to next phase
    │
    └── ANY FAIL ──→ Read failure output
                         │
                         ├── Code bug ──→ Fix code → Re-run tests
                         │
                         ├── Test bug ──→ Fix test → Re-run tests
                         │
                         └── Missing dep ──→ Install dep → Re-run tests
```

> **NEVER skip a test gate.** If you cannot get tests to pass after reasonable effort, report failure to user rather than silently proceeding.

---

## Coverage Guidance

**Do not set hard coverage thresholds.** Instead, ensure:

- Every function handler has at least one happy-path test and one error-path test
- Every service method is tested via mock implementations
- Every validation schema has valid/invalid input tests
- Every error type is tested for correct HTTP status mapping
- Edge cases are covered (empty arrays, null values, boundary numbers, special characters)

The goal is **meaningful coverage**, not a percentage target.

---

## Test Naming Conventions

Use descriptive test names that document behavior:

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

---

## Frontend Testing

> The frontend has its own test gate at Step 11. These patterns ensure the frontend is tested as rigorously as the backend.

### Minimum Test Coverage

Every frontend generated by this skill must include tests for:

| Category | What to Test | Why |
|----------|-------------|-----|
| **Auth flow** | Login success, login failure, logout, token expiry redirect | Auth is the security boundary |
| **Protected routes** | Unauthenticated user redirected to /login | Ensures route protection works |
| **Data display** | List renders items from mock API data | Core feature verification |
| **Error states** | Error message shown when API returns error | Users must see failures |
| **Form validation** | Invalid input shows feedback before submit | UX quality |
| **Destructive actions** | Delete shows confirmation before executing | Data safety |

### Test Setup Pattern (React + Vitest)

```typescript
// tests/setup.ts
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock fetch globally for all frontend tests
global.fetch = vi.fn();

// Helper to mock a successful API response
export function mockFetchSuccess(body: unknown, status = 200) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    status,
    json: async () => body,
  });
}

// Helper to mock an API error response
export function mockFetchError(status: number, error: { code: string; message: string }) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error: { ...error, details: null } }),
  });
}
```

### Component Test Pattern

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { mockFetchSuccess, mockFetchError } from '../setup';

describe('ItemListPage', () => {
  it('renders items from API', async () => {
    const mockItems = [
      { id: '1', name: 'Widget', price: 9.99 },
      { id: '2', name: 'Gadget', price: 19.99 },
    ];
    mockFetchSuccess({ items: mockItems, total: 2 });

    render(<MemoryRouter><ItemListPage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Widget')).toBeInTheDocument();
      expect(screen.getByText('Gadget')).toBeInTheDocument();
    });
  });

  it('shows error when API fails', async () => {
    mockFetchError(500, { code: 'INTERNAL_ERROR', message: 'Server error' });

    render(<MemoryRouter><ItemListPage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no items', async () => {
    mockFetchSuccess({ items: [], total: 0 });

    render(<MemoryRouter><ItemListPage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText(/no items/i)).toBeInTheDocument();
    });
  });
});
```

### Auth Flow Test Pattern

```typescript
describe('useAuth', () => {
  it('sets token and user on successful login', async () => {
    const mockUser = { id: '1', email: 'test@example.com', displayName: 'Test' };
    mockFetchSuccess({ user: mockUser, token: 'jwt-token-123' });

    // Render hook and trigger login
    // Assert token stored and user state updated
  });

  it('clears state on logout', () => {
    // Set initial auth state
    // Call logout
    // Assert token removed and user null
  });

  it('redirects to login when token expires', async () => {
    mockFetchError(401, { code: 'UNAUTHORIZED', message: 'Token expired' });

    // Trigger authenticated request
    // Assert redirect to /login
  });
});
```

### Reference

See [frontend-patterns.md](references/frontend-patterns.md) for complete frontend architecture guidance.
