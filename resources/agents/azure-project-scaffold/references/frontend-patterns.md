# Frontend Architecture Patterns

> Frontend has same quality bar as backend: typed, tested, structured.

---

## Core Principle

**Frontend is not second-class.** Consumes shared types package, has own test gate, follows consistent patterns for data fetching, error handling, component structure.

---

## Rule: Consume Shared Types — No `any`

Shared package exists so frontend doesn't reinvent types. Every entity, request, response MUST use shared type.

```typescript
// ❌ BAD — defeats the purpose of the shared types package
const [user, setUser] = useState<any>(null);
const [photos, setPhotos] = useState<any[]>([]);
const [error, setError] = useState<any>(null);

// ✅ GOOD — imports from shared package
import type { PublicUser, Photo } from 'scrapbook-shared';

const [user, setUser] = useState<PublicUser | null>(null);
const [photos, setPhotos] = useState<Photo[]>([]);
const [error, setError] = useState<string | null>(null);
```

**Enforcement**: If shared package defines a type for an entity or API response, frontend MUST import and use it. No inline `any` or ad-hoc interfaces duplicating shared definitions.

---

## Rule: API Client Must Be Fully Typed

API client module MUST use shared request/response types for every endpoint. Client is contract boundary between frontend and backend.

```typescript
// api/client.ts
import type {
  AuthResponse,
  MeResponse,
  LoginRequest,
  RegisterRequest,
  ListPhotosResponse,
  PhotoResponse,
  ErrorResponse,
} from 'app-shared';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`/api${path}`, { ...options, headers });

  if (!res.ok) {
    const error: ErrorResponse = await res.json();
    throw new ApiError(res.status, error.error.code, error.error.message);
  }

  return res.json() as Promise<T>;
}

// Every endpoint is fully typed — no `any`
export const api = {
  login: (data: LoginRequest) =>
    request<AuthResponse>('POST', '/auth/login', { body: JSON.stringify(data) }),

  register: (data: RegisterRequest) =>
    request<AuthResponse>('POST', '/auth/register', { body: JSON.stringify(data) }),

  getMe: () =>
    request<MeResponse>('GET', '/auth/me'),

  listPhotos: (limit = 20, offset = 0) =>
    request<ListPhotosResponse>('GET', `/photos?limit=${limit}&offset=${offset}`),

  uploadPhoto: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<PhotoResponse>('POST', '/photos', { body: form });
  },

  deletePhoto: (id: string) =>
    request<{ success: true }>('DELETE', `/photos/${id}`),
};
```

---

## Rule: Error Handling in Custom Hooks

Every async op in custom hook MUST catch errors and update error state. Optimistic updates MUST roll back on failure.

```typescript
// ❌ BAD — if API call fails, UI state is inconsistent
const deletePhoto = useCallback(async (id: string) => {
  setPhotos(prev => prev.filter(p => p.id !== id));  // optimistic removal
  await api.deletePhoto(id);  // if this throws, photo is gone from UI but not from DB
}, []);

// ✅ GOOD — rollback on failure
const deletePhoto = useCallback(async (id: string) => {
  const previousPhotos = photos;
  setPhotos(prev => prev.filter(p => p.id !== id));  // optimistic
  try {
    await api.deletePhoto(id);
  } catch (err) {
    setPhotos(previousPhotos);  // rollback
    setError(err instanceof Error ? err.message : 'Failed to delete photo');
  }
}, [photos]);
```

### Silent Error Swallowing is a Bug

```typescript
// ❌ BAD — catches ALL errors including network failures, 500s
useEffect(() => {
  api.getCouple().then(setCouple).catch(() => {
    // "Not paired yet — that's fine"
  });
}, []);

// ✅ GOOD — only ignore expected "not found" errors
useEffect(() => {
  api.getCouple()
    .then(setCouple)
    .catch((err) => {
      if (err instanceof ApiError && err.status === 404) {
        // Not paired yet — expected state
        return;
      }
      setError('Failed to load couple info');
      logger.error('Unexpected error loading couple', err);
    });
}, []);
```

---

## Rule: No Destructive Actions Without Confirmation

Any action that permanently deletes or irreversibly modifies data MUST require user confirmation before executing.

```typescript
// ❌ BAD — one mis-click deletes a photo permanently
<button onClick={() => onDelete(photo.id)}>Delete</button>

// ✅ GOOD — confirmation required
<button onClick={() => {
  if (window.confirm('Delete this photo? This cannot be undone.')) {
    onDelete(photo.id);
  }
}}>Delete</button>
```

For better UX, consider custom confirmation dialog instead of `window.confirm`.

---

## Pattern: Extract Shared Form Components

When 2+ pages share >50% structure, extract shared component. Common with auth forms.

```typescript
// ❌ BAD — LoginPage and RegisterPage are 90% identical
// LoginPage.tsx: 80 lines of form, state, error handling, submit
// RegisterPage.tsx: 85 lines of nearly identical code

// ✅ GOOD — shared AuthForm component
interface AuthFormProps {
  title: string;
  fields: { name: string; type: string; label: string; required?: boolean }[];
  onSubmit: (data: Record<string, string>) => Promise<void>;
  submitLabel: string;
  altLink: { text: string; to: string };
}

function AuthForm({ title, fields, onSubmit, submitLabel, altLink }: AuthFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const formData = new FormData(e.target as HTMLFormElement);
      const data = Object.fromEntries(formData) as Record<string, string>;
      await onSubmit(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-container">
      <h2>{title}</h2>
      {error && <p className="error">{error}</p>}
      <form onSubmit={handleSubmit}>
        {fields.map(field => (
          <input key={field.name} name={field.name} type={field.type}
                 placeholder={field.label} required={field.required} />
        ))}
        <button type="submit" disabled={loading}>
          {loading ? 'Please wait...' : submitLabel}
        </button>
      </form>
      <Link to={altLink.to}>{altLink.text}</Link>
    </div>
  );
}
```

---

## Pattern: File Upload Validation (Client-Side)

File uploads MUST validate client-side before sending to server. Provides immediate feedback, prevents wasted bandwidth.

```typescript
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function validateFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return `Invalid file type: ${file.type}. Allowed: JPEG, PNG, WebP, GIF`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB. Maximum: 10 MB`;
  }
  return null; // valid
}

// Usage in upload handler
const handleUpload = async (file: File) => {
  const validationError = validateFile(file);
  if (validationError) {
    setError(validationError);
    return;
  }
  // ... proceed with upload
};
```

**Server MUST also validate** — client-side validation is for UX, not security. Backend upload handler MUST independently check file size and type.

---

## Pattern: Four-State Data Pages

Every page fetching data MUST handle exactly four states:

```typescript
function PhotoGallery() {
  const { photos, loading, error } = usePhotos();

  // 1. Loading
  if (loading) {
    return <div className="loading-skeleton">Loading your memories...</div>;
  }

  // 2. Error (with retry)
  if (error) {
    return (
      <div className="error-state">
        <p>Something went wrong: {error}</p>
        <button onClick={retry}>Try again</button>
      </div>
    );
  }

  // 3. Empty (with helpful CTA)
  if (photos.length === 0) {
    return (
      <div className="empty-state">
        <p>No photos yet!</p>
        <Link to="/upload">Upload your first memory</Link>
      </div>
    );
  }

  // 4. Data
  return (
    <div className="photo-grid">
      {photos.map(photo => <PhotoCard key={photo.id} photo={photo} />)}
    </div>
  );
}
```

---

## Pattern: Consistent Styling Approach

Choose ONE styling approach and use it consistently. Do not mix inline styles with CSS classes.

| Approach | When to Use | How |
|----------|------------|-----|
| **CSS Modules** | Component-scoped styles, medium-large apps | `import styles from './Button.module.css'` |
| **Global CSS + BEM** | Small apps, rapid prototyping | `className="photo-card__caption"` |
| **CSS-in-JS** (styled-components, Emotion) | Dynamic themes, complex state-based styling | `const Button = styled.button\`...\`` |
| **Tailwind** | Utility-first, design-system projects | `className="flex items-center gap-2"` |

❌ Never mix inline `style={{ }}` props with CSS classes in the same codebase.

---

## Frontend Test Requirements

The frontend test gate (Step 11) requires the following minimum tests:

### Minimum Test Coverage

| Category | What to Test | Example |
|----------|-------------|---------|
| **Auth flow** | Login success, login failure, logout, token expiry redirect | Mock fetch → verify state changes |
| **Protected routes** | Unauthenticated user redirects to /login | Render route without token → expect redirect |
| **Data display** | List renders items from mock API data | Mock fetch → verify items in DOM |
| **Error states** | Error message shown when API returns error | Mock fetch 500 → verify error message |
| **Form validation** | Invalid input shows feedback | Submit empty form → verify error text |
| **Destructive actions** | Delete shows confirmation before executing | Click delete → verify confirm dialog |

### Test Setup Pattern (React + Vitest)

```typescript
// tests/setup.ts
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock fetch globally for all tests
global.fetch = vi.fn();

// Helper to mock successful API responses
export function mockFetchSuccess(body: unknown) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

// Helper to mock API errors
export function mockFetchError(status: number, error: { code: string; message: string }) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error: { ...error, details: null } }),
  });
}
```

### Component Test Example

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { mockFetchSuccess, mockFetchError } from '../setup';

describe('ScrapbookPage', () => {
  it('renders photo list from API', async () => {
    const mockPhotos = [
      { id: '1', caption: 'Beach sunset', blobUrl: '/photo1.jpg', createdAt: '2026-01-01' },
    ];
    mockFetchSuccess({ photos: mockPhotos, total: 1 });

    render(<MemoryRouter><ScrapbookPage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Beach sunset')).toBeInTheDocument();
    });
  });

  it('shows error when API fails', async () => {
    mockFetchError(500, { code: 'INTERNAL_ERROR', message: 'Server error' });

    render(<MemoryRouter><ScrapbookPage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no photos', async () => {
    mockFetchSuccess({ photos: [], total: 0 });

    render(<MemoryRouter><ScrapbookPage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText(/no photos yet/i)).toBeInTheDocument();
    });
  });
});
```
