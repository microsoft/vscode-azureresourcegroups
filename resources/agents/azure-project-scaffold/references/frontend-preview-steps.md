# Frontend Preview Steps

> Detailed sub-steps for standalone frontend preview. Read during **Step 0.5** (Frontend Preview).

---

## Sub-step F1: Initialize Frontend Project

| Task | Details |
|------|---------|
| Initialize frontend project | React + Vite / Vue + Vite / Angular / Svelte (per plan) |
| Create `src/web/` directory | Standard structure matching plan's frontend framework |
| Create local type definitions | Define entity types locally in `src/web/src/types/` — standalone mock types for now |

---

## Sub-step F2: Create Mock Data Layer

| Task | Details |
|------|---------|
| Create mock data files | `src/web/src/mocks/data.ts` — realistic sample data matching plan entities |
| Create mock API client | `src/web/src/mocks/api.ts` — returns mock data with simulated delays |
| **Auto-seed auth state** | If app has auth, auth context/provider MUST auto-login with mock credentials on first load (no token in storage). Preview boots directly into authenticated view so user sees main app content — NOT a login page. Login/register/logout MUST still work if user manually logs out. |
| Handle all 4 data states | Loading (skeleton/spinner), Error (retry button), Empty (call-to-action), Data (populated) |

---

## Sub-step F3: Create Pages & Components

| Task | Details |
|------|---------|
| Create pages | One page per major feature, wired to mock API client |
| Create shared components | Reusable UI components (layout, nav, forms, cards) |
| Error handling in hooks | Every async hook catches errors, handles loading/error states |
| Destructive action confirmations | Delete and irreversible actions require user confirmation |
| Auth context auto-login | If app has auth, AuthProvider/auth context MUST auto-login on mount when no token exists, so preview opens to main authenticated content |
| Use correct file extensions | `.tsx` for JSX, `.ts` for pure TypeScript |

---

## Sub-step F4: Build, Auto-Open & Approval Loop

> ⚠️ **PARALLEL STEP**: Step 0.5 runs **concurrently** with Phase A (Contracts) and Phase B (Backend). Backend derives from **plan's route definitions and entity types**, not frontend preview — independent work streams. Phase A and Phase B may begin immediately after Step 0 (plan validation) while frontend preview is generated and reviewed.
>
> **Step 11 (Wire Frontend) is synchronization gate** — requires BOTH:
> - (a) Frontend preview approved by user
> - (b) Phase B backend agent completed
>
> **Why safe**: Entity types, route definitions, service interfaces all come from approved plan. Frontend preview uses standalone mock types (`src/web/src/types/`) independent of `src/shared/`. Frontend UI changes (layout, styling, components) don't affect backend contracts. Only Step 11 merges both streams by replacing mock types with shared imports.

> ⚠️ **WORKING DIRECTORY**: All frontend build/dev-server commands (`npx vite build`, `npx vite --host`, `npm run dev`, etc.) MUST run with `cwd` set to frontend project directory (e.g., `src/web/`), **NOT workspace root**. Running from root produces blank white page because Vite cannot locate `index.html`.

### Approval Loop Procedure

1. Frontend builds with zero errors (`npx vite build` from `src/web/`, or equivalent). **cwd MUST be frontend directory — NOT project root.**
2. No `any` types in `.ts`/`.tsx` files
3. Preview is auto-authenticated — if app has login/auth, user lands on main content (not login page) on first load
4. Start dev server: `cd src/web && npx vite --host` (async/detach — must keep running). **cwd MUST be `src/web/` — running from project root serves blank white page.**
5. **Open preview in VS Code's Simple Browser** using `simpleBrowser.show` command:
   - Use `run_vscode_command` tool: `simpleBrowser.show` with argument `"http://localhost:{port}/"`
   - Opens embedded browser tab inside VS Code — no external browser needed
6. **Ask user for approval** (use `ask_user`): _"Your frontend preview is live in your browser. Do you approve this UI, or would you like changes?"_
7. If user requests changes → make changes, rebuild, ask again (loop)
8. If user approves → stop dev server, proceed to Step 11 (Wire Frontend) once Phase B also completes

> **CRITICAL**: Do NOT prompt "Would you like to preview?" — always auto-open in VS Code's Simple Browser via `simpleBrowser.show`. User explicitly opted into this workflow by approving a plan with frontend. Frontend preview is user's first chance to validate app direction — but backend builds in parallel since it depends only on plan.

---

## Frontend Quality Bar

Even in preview mode, frontend MUST meet these standards:
- No `any` types (use local type definitions in `src/web/src/types/`)
- Hooks catch errors and handle loading/error states
- Destructive actions (delete, etc.) require `window.confirm()` before executing
- `.tsx` for files containing JSX, `.ts` for pure TypeScript
- All 4 data states handled: loading, error, empty, data
- **Auto-authenticated preview**: If app has auth, preview MUST auto-login on first load so user sees main content immediately (not login page)
