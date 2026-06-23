# Frontend Steps

> Detailed sub-steps for generating the standalone frontend. Read during **Step 1** (Frontend).

> **Companion contract**: Before writing any JSX, also read [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md). It defines the load-bearing contract between the plan's Section 5 (Design System & UI) and the JSX you ship — per-library region-token → primitive mapping, theming via the library's brand ramp, real icons, and the four-state coverage gate. The sub-steps below cover *how* to generate and build the frontend (working directory, build, verify); the quality bar covers *what* the frontend must contain. Design approval already happened during planning via `.azure/.preview-temp/` — Step 1 does **not** re-prompt the user for UX approval.

---

## ⚠️ ️ WORKING DIRECTORY — READ BEFORE RUNNING ANY COMMAND

**Every frontend command (scaffolder, `npm install`, `npx vite build`, `npm run build`, etc.) MUST be invoked with `cwd` set to the frontend project folder — the directory that contains the frontend's `package.json` and `index.html` (typically `services/web/`). Running these commands from the workspace root is the #1 cause of build failures.**

| ✅ Correct | ❌ Wrong |
|----------|---------|
| `run_in_terminal` with `cwd: "services/web"` and command `npx vite build` | `run_in_terminal` from workspace root running `npx vite build` |
| `run_in_terminal` with `cwd: "services/web"` and command `npm install` | `cd services/web && npx vite build` chained from another shell that was launched at root, then forgotten on the next command |
| Pass the folder explicitly every time (don't rely on a previous `cd`) | Assume the terminal is still in `services/web/` from an earlier command — the agent runs each command in a fresh shell |

**Rules:**

1. **Prefer a working-directory-independent command** for the frontend's own npm scripts: `npm --prefix <frontend-folder> run <script>` (e.g. `npm --prefix services/web run build`). `--prefix` loads the frontend's `package.json` from that folder no matter where the shell starts, so it cannot accidentally run from the workspace root.
2. When you must use a tool/binary directly (e.g. `npx vite build`), pass the frontend folder via the `cwd` parameter of `run_in_terminal` on the **same** call. Do **not** rely on a previous `cd` — each terminal invocation may start at the workspace root.
3. If the tool doesn't take a `cwd` parameter, prefix every command with `cd <frontend-folder> &&` and put it on the *same* shell call as the build command. Never split `cd` and `npx vite build` across two separate `run_in_terminal` calls.
4. The frontend folder is whatever the plan specifies — usually `services/web/`. Confirm by checking that the folder contains both `package.json` and `index.html` (or `vite.config.*`).

---

## Sub-step F1: Initialize Frontend Project

| Task | Details |
|------|---------|
| Initialize frontend project | React + Vite / Vue + Vite / Angular / Svelte (per plan) |
| Create the frontend folder | Use the path the plan specifies (e.g. `services/web/`); follow the user's existing structure when one exists. Standard structure matching plan's frontend framework |
| Create local type definitions | Define entity types locally in the frontend's types folder (e.g. `services/web/src/types/`) — standalone mock types for now |
| **Define the `ApiClient` interface** | In the seam folder `services/web/src/api/types.ts`, declare an `ApiClient` interface with **one method per endpoint in the plan's API route inventory (Section 7)**, named and typed from the route contract (e.g. `listItems(): Promise<Item[]>`, `getItem(id: string): Promise<Item>`, `createItem(input: CreateItemRequest): Promise<Item>`). This interface is the **stable seam** both the mock and the future live client implement — it is what makes integration a one-file swap. |

---

## Sub-step F2: Create the Mock Data Layer Behind the `src/api/` Seam

> **Load-bearing seam rule.** Pages and hooks NEVER import the mock directly. They import a single `api` object from `services/web/src/api/` (the seam). At scaffold time that `api` is backed by the mock implementation; at integrate time the integrate agent swaps **one file** (`src/api/index.ts`) to point at the live client and deletes the mock impl — **no page or hook changes**. Wire the seam exactly as below so the swap stays a single-file edit.

| Task | Details |
|------|---------|
| Create mock data files | `services/web/src/mocks/data.ts` — realistic sample data matching plan entities. **Any entity field that represents an image — `image`/`photo`/`avatar`/`cover`/`thumbnail`/`banner`/`url` on a media entity — MUST be populated with a real, loadable image URL**, never left blank, `null`, or pointing at a solid-color placeholder. Use `https://picsum.photos/seed/<stable-id>/<w>/<h>` for generic media, curated `https://images.unsplash.com/...` URLs for domain-specific imagery, and `https://i.pravatar.cc/<size>?u=<id>` for avatars. Empty media surfaces render as flat color blocks and fail the quality bar. |
| Create the mock client (an `ApiClient` impl) | `services/web/src/api/mockClient.ts` — `export const mockClient: ApiClient = { … }` implementing **every** method of the `ApiClient` interface from F1, returning data from `src/mocks/data.ts` with small simulated delays. It MUST satisfy the interface so it is type-interchangeable with the future live client. |
| **Create the seam entry (the one file that swaps)** | `services/web/src/api/index.ts` — the single swap point. It contains exactly:<br>`import type { ApiClient } from './types';`<br>`import { mockClient } from './mockClient';`<br>`export const api: ApiClient = mockClient;`<br>`export type { ApiClient } from './types';`<br>At integrate time only this file changes (mock → live). Keep it this small — no logic, just the wiring line. |
| **Auto-seed auth state** | If app has auth, auth context/provider MUST auto-login with mock credentials on first load (no token in storage). Preview boots directly into authenticated view so user sees main app content — NOT a login page. Login/register/logout MUST still work if user manually logs out. |
| **Build the Mock State Switcher (STANDARD — always)** | Create `services/web/src/api/previewState.ts` exposing the forced `PreviewDataState` (`'data' \| 'loading' \| 'empty' \| 'error'`), initialized from the `?previewState=` query param → `localStorage['previewState']` → `'data'`. The **mock client must honor it on every method**: `loading` → never/slowly resolves; `error` → rejects with a realistic `Error`; `empty` → returns `[]` / `null`; `data` → normal fixtures. Render a small fixed-corner Data/Loading/Empty/Error switcher gated by `import.meta.env.DEV` (forced to `'data'`, no UI, in PROD). This is a fixed contract — scaffold it the same way every time. See the Mock State Switcher standard in [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md). |
| Handle all 4 data states | Loading (skeleton/spinner), Error (retry button), Empty (call-to-action), Data (populated) — all four reachable live via the Mock State Switcher above |

---

## Sub-step F3: Create Pages & Components

| Task | Details |
|------|---------|
| Create pages | One page per major feature, wired to the `api` object from the seam — `import { api } from '@/api'` (or the relative `../api`). **Never import from `src/mocks/` or `src/api/mockClient.ts` in a page or hook** — only the seam (`src/api/`). This is what keeps integration a one-file swap. |
| Create shared components | Reusable UI components (layout, nav, forms, cards) |
| Error handling in hooks | Every async hook catches errors, handles loading/error states |
| Destructive action confirmations | Delete and irreversible actions require user confirmation |
| Auth context auto-login | If app has auth, AuthProvider/auth context MUST auto-login on mount when no token exists, so preview opens to main authenticated content |
| Use correct file extensions | `.tsx` for JSX, `.ts` for pure TypeScript |

---

## Sub-step F4: Build & Verify the Frontend

> ⚠️ **PARALLEL STEP**: Frontend generation + build (F1–F4, sub-agent) runs **concurrently** with Phase A (Contracts) and Phase B (Backend). Backend derives from **plan's route definitions and entity types**, not the frontend — independent work streams. Phase A and Phase B may begin immediately after Step 0 (plan validation) while the Frontend sub-agent generates and builds `services/web/`.
>
> The Frontend sub-agent only needs to **generate and build** `services/web/` with mock data — it does **not** wire to the real backend. The verify agent, in a later session, swaps the seam (`src/api/index.ts`) from the mock client to the live client and replaces the local mock types with shared imports — a one-file swap at the seam, no page or hook edits.
>
> **Why safe**: Entity types, route definitions, service interfaces all come from approved plan. Frontend uses standalone mock types (`services/web/src/types/`) independent of `services/shared/`, behind the `ApiClient` seam (`src/api/`). Frontend UI changes (layout, styling, components) don't affect backend contracts. The verify agent merges both streams later by repointing the seam at the live client and replacing mock types with shared imports.

> ⚠️ ️ **WORKING DIRECTORY** (see also the top of this file): every `npx vite build`, `npm run build`, `npm install`, etc. **MUST run against the frontend folder** (e.g. `services/web/`), never the workspace root. **Prefer the working-directory-independent form `npm --prefix services/web run <script>`** (e.g. `npm --prefix services/web run build`) — it loads the frontend's `package.json` regardless of where the shell starts. When invoking a binary directly (`npx vite build`), pass `cwd: services/web` on the same terminal call; do **not** assume a previous `cd` carried over.

> ⚠️ **NO UX APPROVAL PROMPT.** The user already approved the design during planning via the HTML/CSS mock-up at `.azure/.preview-temp/`. **Do NOT call `ask_user` for "do you approve this UI?"** during scaffolding. The only legitimate user prompt during Step 1 is a hard build failure that requires their input to resolve.

### Procedure

1. **Frontend builds with zero errors.** Build with a **working-directory-independent** command so it can't accidentally run from the workspace root: `npm --prefix <frontend-folder> run build` (e.g. `npm --prefix services/web run build`). `--prefix` resolves the frontend's `package.json` regardless of where the shell starts, so it's immune to the root-launch bug. Only fall back to `npx vite build` with `cwd: <frontend-folder>` if there is no `build` script. **Never run a bare `npx vite build` from the project root.**
2. No `any` types in `.ts`/`.tsx` files.
3. Frontend is auto-authenticated — if app has login/auth, mock auth state is seeded so the app would land on main content (not a login page) on first load.
4. **Briefly note** that the frontend was generated and builds cleanly, and that backend work continues in parallel — one short sentence. **Then keep working** — no approval question, no waiting loop.

> **CRITICAL**: Do NOT prompt "Would you like to preview?" or "Do you approve this UI?" during scaffolding — design approval already happened during planning via the HTML mock-up.

### Translating the planning mock-up into real framework code

The `.azure/.preview-temp/*.html` files are a **layout + tonal reference**, not source code to ship. For each page:

- The plan's Pages table tells you which **regions** belong on the page (`header + hero + grid + footer` etc.).
- The HTML mock-up shows the **approved arrangement, density, and palette** of those regions.
- Your job in Step 1 is to reproduce that visual feel using the **real `Component Library:` primitives** from Section 6 (see [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) for the per-library token → primitive mapping).

Do not import the HTML mock-up, embed it via `<iframe>`, or copy CSS class names from it into your JSX — the mock-up is throwaway and `.azure/.preview-temp/` is deleted in Step 11. Only the visual intent (regions, palette, density) carries forward into real components.

---

## Frontend Quality Bar

Even before it's wired to the backend, the frontend MUST meet these standards. The full per-library contract lives in [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) — read it before writing any JSX. Baseline rules enforced here:

- No `any` types (use local type definitions in `services/web/src/types/`)
- Hooks catch errors and handle loading/error states
- Destructive actions (delete, etc.) require `window.confirm()` before executing
- `.tsx` for files containing JSX, `.ts` for pure TypeScript
- All 4 data states handled: loading, error, empty, data (see quality-bar's State Coverage Contract for per-library primitives — `<Skeleton>` / `<MessageBar intent="error">` / empty illustration + CTA / real data), and all four reachable live via the **Mock State Switcher** (dev-only `?previewState=` override — see quality-bar's Mock State Switcher standard)
- **Auto-authenticated preview**: If app has auth, preview MUST auto-login on first load so user sees main content immediately (not login page)
- **Render layout tokens with real library primitives** — never raw `<div className="card">` placeholders. See [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) for the region-token → primitive mapping per library.
- **Wrap the app shell in the library's theme provider** with a brand ramp derived from plan Section 6's `primary` color. See [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) → Theming contract.
- **Use real icons** from the library's icon set (Fluent: `@fluentui/react-icons` Regular variants; Vuetify: `mdi-*`; Material: `<mat-icon>` real names; Skeleton/Pico: Lucide/Tabler). No emoji, no SVG placeholders.
