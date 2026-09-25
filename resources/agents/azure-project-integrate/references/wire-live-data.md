# Wire Frontend to Live Data

> Read at **Step 3**. Scaffold frontend has stable `ApiClient` seam (`src/api/`): live wiring = seam **one-file swap** + types switch, not call-site rewrite.

---

## The seam the scaffold left you

Scaffold wiring ensures **no page or hook imports mock directly**. All import one `api` object from `services/web/src/api/`:

- `src/api/types.ts` — `ApiClient` interface, one method per route-inventory endpoint.
- `src/api/mockClient.ts` — mock `ApiClient` implementation reading `src/mocks/data.ts`.
- `src/api/index.ts` — **single swap point**: `export const api: ApiClient = mockClient;`

Add live implementation; repoint that one file. Pages/hooks import only seam `api`; **do not touch them**.

---

## Goal: no mock data remains in use

Afterward, frontend `src/` search for `mock` / `mockData` / `previewState` finds no remaining imports. App fetches everything from live backend.

---

## Replacement recipe (one-file swap)

1. **Adopt shared types.** Point `src/api/types.ts` (or referenced local entity types) to shared package, replacing duplicate local types:
   ```ts
   import type { PublicUser, CreateUserRequest } from '@app/shared';
   ```
   No `any`. Keep `ApiClient` interface shape; source referenced types from shared contract.
2. **Build the live client** at `src/api/client.ts` — second, method-for-method implementation of **same `ApiClient` interface**, replacing seam implementation without caller edits:
   ```ts
   import type { ApiClient } from './types';
   import type { PublicUser, CreateUserRequest } from '@app/shared';

   const BASE = import.meta.env.VITE_API_BASE ?? '/api';

   async function request<T>(path: string, init?: RequestInit): Promise<T> {
     const headers = new Headers(init?.headers);
     headers.set('Content-Type', 'application/json');
     if (!headers.has('x-correlation-id')) {
       headers.set('x-correlation-id', crypto.randomUUID());
     }
     const res = await fetch(`${BASE}${path}`, {
       ...init,
       headers,
       signal: init?.signal ?? AbortSignal.timeout(10_000),
     });
     if (!res.ok) {
       const body = await res.json().catch(() => ({}));
       throw new ApiError(res.status, body?.error?.message ?? res.statusText);
     }
     return res.json() as Promise<T>;
   }

   export const liveClient: ApiClient = {
     listUsers: () => request<PublicUser[]>('/users'),
     getUser: (id) => request<PublicUser>(`/users/${id}`),
     // ...one method per endpoint, matching the ApiClient interface exactly
   };
   ```
   Because `liveClient` is typed `: ApiClient`, the compiler guarantees it covers every method the pages already call.
   The timeout and correlation header are part of the Workload Quality Contract. If the scaffold supplied a
   shared request helper, reuse it rather than creating a second policy. Add retries only for explicitly
   idempotent operations and documented transient failures; never auto-retry a `POST`/mutation simply because
   `fetch` failed.
3. **Swap the seam — the one file that changes.** Edit `src/api/index.ts` so `api` points at the live client:
   ```ts
   import type { ApiClient } from './types';
   import { liveClient } from './client';
   export const api: ApiClient = liveClient;
   export type { ApiClient } from './types';
   ```
   Single line (`mockClient` → `liveClient`) wires all call sites. **No page or hook edits.**
4. **Remove the mock layer.** Delete `src/api/mockClient.ts`, `src/mocks/*`, and local duplicate types now shared. Any lingering `import … from './mockClient'` or `from '../mocks'` means incomplete.
5. **Remove the Mock State Switcher.** Scaffold adds dev-only switcher (`src/api/previewState.ts` + fixed-corner Data/Loading/Empty/Error component) forcing mock client to `loading` / `empty` / `error`. Delete `src/api/previewState.ts`, corner-switcher component, and every `previewState` import/usage in mock client, pages, hooks, app shell. Live data only; any lingering `import … previewState` or rendered Data/Loading/Empty/Error switcher means incomplete.
6. **Rebuild.** `npm --prefix services/web run build` — zero errors, zero `any`. Fix `.ts`/`.tsx` mismatch; JSX requires `.tsx`.

> **If scaffold did NOT leave a `src/api/` seam** (older scaffold or hand-written frontend): use call-site approach — replace every `import … from '.../mocks'` with real `api.*` call; preserve four data states. First establish seam (`src/api/index.ts`) so future changes remain one-file swap.


---

## Dev proxy (so `/api` reaches the backend)

Point dev server `/api` proxy at Step 2 backend host.

**Vite** (`vite.config.ts`):
```ts
export default defineConfig({
  server: {
    host: true,          // preserve preview compatibility (webview iframe / forwarded host)
    allowedHosts: true,  // dev-only: don't 403-block the webview / forwarded origin
    strictPort: false,
    proxy: { '/api': { target: 'http://localhost:7071', changeOrigin: true } },
  },
});
```

**Keep** scaffold `host` / `allowedHosts` / `strictPort` settings; they support webview iframe + forwarded (remote / Codespaces) hosts. Add only `proxy`. For other frameworks use equivalent proxy config (Next.js `rewrites`, Angular `proxy.conf.json`). Match target to artifact backend port.
