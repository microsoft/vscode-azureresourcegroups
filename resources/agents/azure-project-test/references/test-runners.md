# Test Runner Configuration

> Test runner setup across runtimes. Read during **Step V1** (Test Infrastructure).

---

## Node.js (TypeScript)

| Runner | Setup | Config File | Test Command | Mock Library | Assertion Library |
|--------|-------|-------------|-------------|-------------|------------------|
| **vitest** | `npm i -D vitest` | `vitest.config.ts` | `npx vitest run` | Built-in `vi.mock()` | Built-in `expect` |
| **jest** | `npm i -D jest ts-jest @types/jest` | `jest.config.ts` | `npx jest` | Built-in `jest.mock()` | Built-in `expect` |
| **mocha+chai+sinon** | `npm i -D mocha chai sinon @types/mocha @types/chai @types/sinon tsx` | `.mocharc.yml` | `npx mocha` | sinon | chai `expect` |

### vitest config example

> ⚠️ **MANDATORY settings for projects with heavy SDK imports** (pg, @azure/storage-blob, etc.):
> - `fileParallelism: false` — Prevents memory exhaustion/hangs from multiple workers loading heavy SDKs.
> - `teardownTimeout: 3000` — Kills lingering connections (e.g., `pg.Pool`) keeping process alive after tests.
> - `testTimeout: 10000` — Generous per-test timeout prevents false failures on slow CI.
> - `setupFiles` — Points to test setup file pre-registering mock services.
>
> Without these, full test suite **appears to hang indefinitely** running 13+ test files importing modules with heavy SDK deps.

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
      exclude: ['src/**/interfaces/**']
    }
  }
});
```

### vitest config with workspace imports (resolve aliases)

> **Key learning from benchmarking**: #1 test infrastructure issue is missing resolve aliases for workspace imports. vitest uses own module resolution (not `tsc`), so shared packages must alias to source `.ts` files, not compiled `.js`.

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Map shared package imports to source (not dist) for vitest
      '@scrapbook/shared/schemas/validation.js': path.resolve(__dirname, '../shared/schemas/validation.ts'),
      '@scrapbook/shared/schemas/validation': path.resolve(__dirname, '../shared/schemas/validation.ts'),
      '@scrapbook/shared': path.resolve(__dirname, '../shared/types/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
```

### jest config example

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

### mocha config example

```yaml
# .mocharc.yml
require:
  - tsx
spec: 'tests/**/*.test.ts'
recursive: true
timeout: 5000
```

---

## Python

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

---

## .NET

| Runner | Setup | Config | Test Command | Mock Library | Assertion |
|--------|-------|--------|-------------|-------------|-----------|
| **xUnit** | NuGet: `xunit`, `xunit.runner.visualstudio`, `Microsoft.NET.Test.Sdk` | `.csproj` | `dotnet test` | Moq or NSubstitute | xUnit `Assert` or FluentAssertions |
| **NUnit** | NuGet: `NUnit`, `NUnit3TestAdapter`, `Microsoft.NET.Test.Sdk` | `.csproj` | `dotnet test` | Moq or NSubstitute | NUnit `Assert` or FluentAssertions |
