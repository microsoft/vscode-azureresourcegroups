# Wire Frontend to Live Data

> Read at **Step 3**. The scaffold built the frontend behind a stable `ApiClient` seam (`src/api/`), so wiring to live data is a **one-file swap** at the seam plus a types switch — not a call-site rewrite.

---

## The seam the scaffold left you

The scaffold wired the frontend so **no page or hook imports the mock directly**. They all import a single `api` object from `services/web/src/api/`:

- `src/api/types.ts` — the `ApiClient` interface (one method per endpoint in the route inventory).
- `src/api/mockClient.ts` — the mock implementation of `ApiClient` (reads `src/mocks/data.ts`).
- `src/api/index.ts` — the **single swap point**: `export const api: ApiClient = mockClient;`

Your job is to add the live implementation and repoint that one file. Because pages/hooks import only `api` from the seam, **you do not touch them**.

---

## Goal: no mock data remains in use

After this step, a search of the frontend `src/` for `mock` / `mockData` / `previewState` must find nothing that is still imported. The app fetches everything from the live backend.

---

## Replacement recipe (one-file swap)

1. **Adopt shared types.** Point `src/api/types.ts` (or the local entity types it references) at the shared package instead of the duplicated local types:
   ```ts
   import type { PublicUser, CreateUserRequest } from '@app/shared';
   ```
   No `any`. The `ApiClient` interface stays the same shape — only the types it references come from the shared contract.
2. **Build the live client** at `src/api/client.ts` — a second implementation of the **same `ApiClient` interface**, method-for-method, so it drops into the seam without touching callers:
   ```ts
   import type { ApiClient } from './types';
   import type { PublicUser, CreateUserRequest } from '@app/shared';

   // Read the API base from the framework's PUBLIC (client-exposed) env var — see the table below.
   // The value is frozen at build time; in a cross-origin topology production MUST supply it.
   // Shown in Vite syntax — substitute your framework's equivalent (e.g. Next.js `process.env.NEXT_PUBLIC_API_BASE`).
   const configuredBase = import.meta.env.VITE_API_BASE;
   if (import.meta.env.PROD && !configuredBase) {
     throw new Error('VITE_API_BASE is required for the production build');
   }
   const BASE = configuredBase ?? '/api';

   async function request<T>(path: string, init?: RequestInit): Promise<T> {
     const res = await fetch(`${BASE}${path}`, {
       headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
       ...init,
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
   The example above is for a **cross-origin backend**. For a **same-origin linked backend**, use `const BASE = '/api';` and require no build-time variable. Follow the topology recorded in the project plan; never choose based only on the fact that the local dev proxy works.

   **Stay framework-agnostic.** The user may pick any frontend framework — read the API base from *that framework's* public (client-exposed) environment variable. Only variables carrying the framework's public prefix are bundled into browser code, and their values are frozen at build time, so a cross-origin deployment must inject the value **before** the production build runs, not after the static files are emitted. Map the Vite tokens above to whatever the plan selected:

   | Framework | Public env var | Client access | Production check | Build-config validation |
   |-----------|----------------|---------------|------------------|--------------------------|
   | Vite (React/Vue/Svelte) | `VITE_API_BASE` | `import.meta.env.VITE_API_BASE` | `import.meta.env.PROD` | `vite.config.*` via `loadEnv` |
   | Next.js | `NEXT_PUBLIC_API_BASE` | `process.env.NEXT_PUBLIC_API_BASE` | `process.env.NODE_ENV === 'production'` | `next.config.*` |
   | SvelteKit | `PUBLIC_API_BASE` | import from `$env/static/public` | `dev` from `$app/environment` | build errors if referenced-but-unset |
   | Angular | `environment.apiBase` (or `NG_APP_*` via `@ngx-env`) | `environment.apiBase` | `environment.production` | `environment.prod.ts` / builder |
   | Astro / Nuxt | `PUBLIC_*` / `NUXT_PUBLIC_*` | `import.meta.env.PUBLIC_*` / `useRuntimeConfig().public` | `import.meta.env.PROD` / `import.meta.dev` | `astro.config.*` / `nuxt.config.*` |

   If the framework isn't listed, consult its docs for the public-env prefix and the production flag — the principle is identical. Name the chosen variable in the plan's `Frontend API Base` field and the deploy hand-off so deploy injects it before the build.

   The runtime guard above fails clearly when the deployed app starts, but most bundlers do not execute application modules while building. For a cross-origin topology, **also** validate the variable in the framework's build config so packaging itself fails before emitting a broken bundle — e.g. in Vite (`vite.config.ts`):
   ```ts
   import { defineConfig, loadEnv } from 'vite';

   export default defineConfig(({ mode }) => {
     const env = loadEnv(mode, process.cwd(), '');
     if (mode === 'production' && !env.VITE_API_BASE) {
       throw new Error('VITE_API_BASE is required for the production build');
     }

     return {
       // Existing plugins and server configuration.
     };
   });
   ```
   For other frameworks apply the equivalent check in their build config (`next.config.*`, `astro.config.*`, `nuxt.config.*`, an Angular builder step, etc.).
   Because `liveClient` is typed `: ApiClient`, the compiler guarantees it covers every method the pages already call.
3. **Swap the seam — the one file that changes.** Edit `src/api/index.ts` so `api` points at the live client:
   ```ts
   import type { ApiClient } from './types';
   import { liveClient } from './client';
   export const api: ApiClient = liveClient;
   export type { ApiClient } from './types';
   ```
   That single line (`mockClient` → `liveClient`) is the entire wire-up for the call sites. **No page or hook edits.**
4. **Remove the mock layer.** Delete `src/api/mockClient.ts` and `src/mocks/*` (and any local duplicated types now sourced from shared). A lingering `import … from './mockClient'` or `from '../mocks'` means the step is not done.
5. **Remove the Mock State Switcher.** The scaffold always adds a dev-only state switcher (`src/api/previewState.ts` + a fixed-corner Data/Loading/Empty/Error component) that forces the mock client into `loading` / `empty` / `error`. Delete `src/api/previewState.ts`, its corner-switcher component, and every `previewState` import/usage in the mock client, pages, hooks, and app shell. Live data is the only source now — a lingering `import … previewState` or a rendered Data/Loading/Empty/Error switcher means the step is not done.
6. **Rebuild.** `npm --prefix services/web run build` — zero errors, zero `any`. Fix any `.ts`/`.tsx` extension mismatch (JSX must be `.tsx`).

> **If the scaffold did NOT leave a `src/api/` seam** (older scaffold, or a hand-written frontend): fall back to the call-site approach — find every `import … from '.../mocks'`, replace with a real `api.*` call, preserve the four data states. But first establish the seam (`src/api/index.ts`) so any future change stays a one-file swap.


---

## Dev proxy (so `/api` reaches the backend locally)

Point the dev server's `/api` proxy at the backend host from Step 2.

This proxy exists only in the development server. It does not create an Azure production route and does not remove the need for a production API base URL or backend CORS when the frontend and API use different origins.

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

**Keep** the `host` / `allowedHosts` / `strictPort` settings the scaffold added — they let the frontend load inside a webview iframe and forwarded (remote / Codespaces) hosts; only add the `proxy` entry. For other frameworks use their equivalent proxy config (Next.js `rewrites`, Angular `proxy.conf.json`). Keep the target in sync with the backend port the artifact documents.
