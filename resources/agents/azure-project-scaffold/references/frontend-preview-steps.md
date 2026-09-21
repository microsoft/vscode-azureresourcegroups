# Frontend Steps

> Standalone frontend sub-steps. Read during **Step 1** (Frontend).

> **Companion contract**: Before JSX, read [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md). It links plan Section 5 (Design System & UI) to shipped JSX: per-library region-token → primitive mapping, brand-ramp theming, real icons, four-state gate. Steps below define *how* to generate/build (working directory, build, verify); quality bar defines *what* it contains. Planning approved `.azure/.preview-temp/`; Step 1 does **not** re-prompt UX approval.

---

## ⚠️ ️ WORKING DIRECTORY — READ BEFORE RUNNING ANY COMMAND

**Every frontend command (scaffolder, `npm install`, `npx vite build`, `npm run build`, etc.) MUST use `cwd` = frontend folder containing `package.json` and `index.html` (typically `services/web/`). Workspace-root execution is the #1 build-failure cause.**

| ✅ Correct | ❌ Wrong |
|----------|---------|
| `run_in_terminal`, `cwd: "services/web"`, command `npx vite build` | Workspace-root `run_in_terminal` running `npx vite build` |
| `run_in_terminal`, `cwd: "services/web"`, command `npm install` | `cd services/web && npx vite build` from root, then assuming it persists |
| Pass folder every time; never rely on previous `cd` | Assume terminal remains in `services/web/`; each command gets fresh shell |

**Rules:**

1. **Prefer cwd-independent npm scripts**: `npm --prefix <frontend-folder> run <script>` (e.g. `npm --prefix services/web run build`). `--prefix` loads frontend `package.json` regardless of shell start.
2. For direct tools/binaries (e.g. `npx vite build`), pass frontend `cwd` to `run_in_terminal` in the **same** call. Never rely on previous `cd`; invocations may start at root.
3. Without `cwd` support, prefix the build's same shell call with `cd <frontend-folder> &&`. Never split `cd` and `npx vite build` across `run_in_terminal` calls.
4. Use plan's frontend folder, usually `services/web/`. Confirm it contains `package.json` and `index.html` (or `vite.config.*`).

---

## ⚠️ Preview compatibility — the "Approve UI" iframe MUST be able to load your dev server

After scaffolding, `open_frontend_preview_view` opens **Approve UI**, **starts the frontend dev server**, and renders a **VS Code webview iframe**. User clicks **Approve UI** to integrate. If iframe cannot load app, user is **stuck**: normal browser may work while preview is blank/"Starting…" and **Approve UI never enables**. Ensure preview loads:

- **Embeddable, reachable dev server.** In `vite.config`, set `server: { host: true, allowedHosts: true, strictPort: false }` (Angular: `ng serve --host 0.0.0.0 --disable-host-check`; Next.js: `next dev -H 0.0.0.0`). `host: true` enables webview/forwarded-port access (remote, Codespaces, Dev Container, SSH); `allowedHosts: true` prevents forwarded/webview-origin 403; `strictPort: false` allows free port if default is busy. See [architecture.md](.github/agents/shared-references/architecture.md) → Frontend Dev Server Configuration.
- **Keep `dev`/`start` a real server.** It prints `http://localhost:<port>/` (plain `vite`, `next dev`, `ng serve`), never `vite build --watch` or build-only script. Preview waits for URL before enabling **Approve UI**; non-serving scripts time out on "Starting…".
- **Never frame-bust dev server.** No `X-Frame-Options` header or `<meta http-equiv="Content-Security-Policy" content="… frame-ancestors …">` in `index.html`. Either blocks webview iframe while browser tab works.
- **No competing dev server.** `open_frontend_preview_view` owns one server; scaffold only *builds* (`npm run build`, per F4). Do **not** run `npm run dev` or scaffold folder-open auto-start VS Code task. Second server creates port contention and preview bind failure.

---

## Sub-step F1: Initialize Frontend Project

| Task | Details |
|------|---------|
| Initialize frontend project | React + Vite / Vue + Vite / Angular / Svelte (per plan) |
| **Make the dev server preview-embeddable** | In `vite.config`, set `server: { host: true, allowedHosts: true, strictPort: false }` (Angular: `ng serve --host 0.0.0.0 --disable-host-check`; Next.js: `next dev -H 0.0.0.0`). Keep `dev` a plain server (`vite`); exclude `X-Frame-Options` / `frame-ancestors` CSP from `index.html`. This enables **Approve UI** webview iframe (`/api` proxy added later by integrate). See **Preview compatibility** above. |
| Create the frontend folder | Use plan path (e.g. `services/web/`) and existing structure; match planned frontend framework |
| Create local type definitions | Define standalone mock entity types in frontend types folder (e.g. `services/web/src/types/`) |
| **Define the `ApiClient` interface** | In seam `services/web/src/api/types.ts`, declare `ApiClient` with **one named, typed method per plan API route (Section 7)** (e.g. `listItems(): Promise<Item[]>`, `getItem(id: string): Promise<Item>`, `createItem(input: CreateItemRequest): Promise<Item>`). Add methods for every *other* entity any page, component, or provider renders, even without plan route: assignee/author lookups, signed-in user, category/status reference lists (e.g. `listUsers(): Promise<User[]>`, `getCurrentUser(): Promise<User>`). When `API Login` is `Yes`, include needed auth methods, including `createAccount(input)`, though plan omits auth routes. Reference data still uses seam; mock backs it during scaffold, then integrate maps it to real route/static list. **Interface must cover everything UI renders**; otherwise page must illegally bypass seam. Both mock and future live client implement this **stable seam**, enabling one-file integration swap. |

---

## Sub-step F2: Create the Mock Data Layer Behind the `src/api/` Seam

> **Load-bearing seam rule.** **No file outside `services/web/src/api/` imports mock**—not pages, hooks, shared components, or auth provider. All import one `api` object from `services/web/src/api/`. Scaffold backs `api` with mock; integrate swaps **one file** (`src/api/index.ts`) to live client and deletes mock—**no edits outside `src/api/`**. Direct `src/mocks/` imports stop compiling after deletion, turning one-file swap into rewrite.
>
> **If `ApiClient` lacks needed data—including reference data without plan route—add interface method (F1) + mock backing. Never import fixture.** No exemption: extend seam. Wire exactly below for single-file swap.

| Task | Details |
|------|---------|
| Create mock data files | `services/web/src/mocks/data.ts` — realistic planned entities. **Media fields — `image`/`photo`/`avatar`/`cover`/`thumbnail`/`banner`/`url` on media entities — MUST contain real loadable image URL**, never blank, `null`, or solid-color placeholder. Use `https://picsum.photos/seed/<stable-id>/<w>/<h>` for generic media, curated `https://images.unsplash.com/...` URLs for domain imagery, and `https://i.pravatar.cc/<size>?u=<id>` for avatars. Empty media becomes flat blocks and fails quality. |
| Create the mock client (an `ApiClient` impl) | `services/web/src/api/mockClient.ts` — `export const mockClient: ApiClient = { … }` implements **every** F1 `ApiClient` method (including reference-data methods), returns `src/mocks/data.ts` with small delays, and satisfies interface for future live-client interchangeability. **Declare mock as `ApiClient`; never derive interface from mock.** `export type ApiClient = typeof mockClient` inverts seam: integrate deletes mock, interface disappears, live client has nothing to implement. |
| **Create the seam entry (the one file that swaps)** | `services/web/src/api/index.ts` — single swap point containing exactly:<br>`import type { ApiClient } from './types';`<br>`import { mockClient } from './mockClient';`<br>`export const api: ApiClient = mockClient;`<br>`export type { ApiClient } from './types';`<br>Integrate changes only this file (mock → live). No logic, only wiring. |
| **Auto-seed auth state** | When plan says `API Login: Yes`, local auth MUST auto-login with local credentials on first load (no token in storage), showing authenticated main view, not login. Login/logout still work after manual logout. Get signed-in user through seam (`api.getCurrentUser()`, added in F1); auth provider follows same seam, so `import { currentUser } from '../mocks/data'` violates. When `API Login: No`, scaffold no auth state/login UI. |
| **Build the Mock State Switcher (STANDARD — always)** | Create `services/web/src/api/previewState.ts` exposing forced `PreviewDataState` (`'data' \| 'loading' \| 'empty' \| 'error'`), initialized `?previewState=` → `localStorage['previewState']` → `'data'`. **Every mock method honors it**: `loading` → never/slow resolve; `error` → realistic `Error`; `empty` → `[]` / `null`; `data` → fixtures. Render fixed-corner Data/Loading/Empty/Error switcher gated by `import.meta.env.DEV` (PROD forced `'data'`, no UI). Fixed contract; see Mock State Switcher in [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md). |
| Handle all 4 data states | Loading (skeleton/spinner), Error (retry), Empty (CTA), Data (populated), all live-reachable via Mock State Switcher |

---

## Sub-step F3: Create Pages & Components

| Task | Details |
|------|---------|
| Create pages | One per major feature, wired to seam `api` — `import { api } from '@/api'` (or relative `../api`). **Never import `src/mocks/` or `src/api/mockClient.ts` outside `src/api/`**—including pages, hooks, shared components, auth provider. For assignee name, signed-in user, or other reference data, add F1 `ApiClient` method + call through seam. This preserves one-file integration swap. |
| Create shared components | Reusable UI components (layout, nav, forms, cards) |
| Error handling in hooks | Every async hook catches errors and handles loading/error |
| Destructive action confirmations | Delete and irreversible actions require user confirmation |
| Auth context auto-login | When `API Login` is `Yes`, AuthProvider/context MUST auto-login on mount without token so preview opens authenticated main content |
| Account creation | When `API Login` is `Yes`, login page MUST show visible **Create account** button routing to dedicated create-account page. Page calls `api.createAccount(...)` through seam and shows validation, duplicate-account, loading, success states. Required though local auto-login initially shows main content. |
| Use correct file extensions | `.tsx` for JSX, `.ts` for pure TypeScript |

---

## Sub-step F4: Build & Verify the Frontend

> ⚠️ **PARALLEL STEP**: Frontend generation + build (F1–F4, sub-agent) runs **concurrently** with Phase A (Contracts) and Phase B (Backend). Backend derives from **plan routes and entity types**, not frontend. Begin Phase A/B after Step 0 while Frontend sub-agent builds `services/web/`.
>
> Frontend sub-agent only **generates and builds** mock-backed `services/web/`; it does **not** wire backend. Later verify swaps seam (`src/api/index.ts`) mock → live and local types → shared imports, without page/hook edits.
>
> **Why safe**: Approved plan supplies entities, routes, interfaces. Frontend uses standalone mocks (`services/web/src/types/`) independent of `services/shared/`, behind `ApiClient` seam (`src/api/`). UI changes do not affect backend contracts. Verify later repoints seam and replaces mock types.

> ⚠️ ️ **WORKING DIRECTORY**: every `npx vite build`, `npm run build`, `npm install`, etc. **MUST target frontend folder** (e.g. `services/web/`), never root. Prefer cwd-independent `npm --prefix services/web run <script>` (e.g. `npm --prefix services/web run build`), which loads frontend `package.json`. For direct `npx vite build`, pass `cwd: services/web` on same call; previous `cd` does not persist.

> ⚠️ **NO UX APPROVAL PROMPT.** Planning approved HTML/CSS mock-up at `.azure/.preview-temp/`. **Do NOT call `ask_user` for "do you approve this UI?"** during scaffolding. Only prompt in Step 1 for hard build failure requiring user input.

### Procedure

1. **Frontend builds with zero errors.** Use cwd-independent `npm --prefix <frontend-folder> run build` (e.g. `npm --prefix services/web run build`); `--prefix` resolves frontend `package.json` from any shell start. Without `build` script, use `npx vite build` with `cwd: <frontend-folder>`. **Never run bare `npx vite build` from project root.**
2. No `any` types in `.ts`/`.tsx` files.
3. When `API Login` is `Yes`, seed local identity so first load lands on main content, not login. Logout reveals login page with visible **Create account** button + working dedicated create-account page. When `No`, frontend has no auth UI/state.
4. **Briefly note** frontend generated/builds cleanly and backend continues in parallel—one sentence. **Keep working**; no approval question/wait.

> **CRITICAL**: Do NOT prompt "Would you like to preview?" or "Do you approve this UI?" during scaffolding; planning HTML mock-up already approved.

### Translating the planning mock-up into real framework code

`.azure/.preview-temp/*.html` files are **layout + tonal reference**, not shipped source. Per page:

- Plan Pages table specifies page **regions** (`header + hero + grid + footer` etc.).
- HTML mock-up specifies **approved arrangement, density, palette**.
- Reproduce visual feel with **real `Component Library:` primitives** from Section 6; see [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) mappings.

Do not import mock-up, embed via `<iframe>`, or copy its CSS classes into JSX. `.azure/.preview-temp/` is deleted in Step 11; only visual intent (regions, palette, density) carries into real components.

---

## Frontend Quality Bar

Before backend wiring, frontend MUST meet these standards. Read full per-library [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) before JSX. Baseline:

- No `any` types (use local type definitions in `services/web/src/types/`)
- Hooks catch errors; handle loading/error states
- Destructive actions (delete, etc.) require `window.confirm()` before executing
- `.tsx` for files containing JSX, `.ts` for pure TypeScript
- Handle all 4 data states: loading, error, empty, data (quality-bar State Coverage primitives—`<Skeleton>` / `<MessageBar intent="error">` / empty illustration + CTA / real data); expose all live via **Mock State Switcher** (dev-only `?previewState=` override; see standard)
- **Auto-authenticated preview**: When `API Login` is `Yes`, local auth MUST auto-login on first load so user immediately sees main content, not login
- **Render layout tokens with real library primitives**, never raw `<div className="card">` placeholders. See [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) for per-library region-token mapping.
- **Wrap the app shell in the library's theme provider** with a brand ramp derived from plan Section 6's `primary` color. See [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) → Theming contract.
- **Use real library icons** (Fluent: `@fluentui/react-icons` Regular; Vuetify: `mdi-*`; Material: `<mat-icon>` real names; Skeleton/Pico: Lucide/Tabler). No emoji/SVG placeholders.
