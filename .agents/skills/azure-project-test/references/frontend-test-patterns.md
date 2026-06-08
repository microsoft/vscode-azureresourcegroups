# Frontend Test Patterns

> React component test setup, auth flow tests, data display tests. Read during **Step V6b** (Frontend Component Tests).

---

## Prerequisites

Install test deps in web workspace:

```bash
cd src/web && npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

---

## vitest.config.ts (Frontend)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/tests/**/*.test.tsx'],
  },
});
```

---

## Test Setup Pattern (React + Vitest)

```typescript
// src/web/src/tests/setup.ts
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

---

## Minimum Test Coverage

| Category | What to Test | Test File |
|----------|-------------|-----------|
| **Auth flow** | Login success, login failure, logout | `src/tests/auth.test.tsx` |
| **Protected routes** | Unauthenticated → redirect to /login | `src/tests/routes.test.tsx` |
| **Data display** | List renders items from mock fetch data | `src/tests/pages.test.tsx` |
| **Error states** | Error message shown when API 500 | `src/tests/pages.test.tsx` |
| **Empty states** | Empty state CTA shown when no data | `src/tests/pages.test.tsx` |
| **Destructive actions** | Delete shows confirmation | `src/tests/actions.test.tsx` |

---

## Component Test Pattern

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

---

## Auth Flow Test Pattern

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
