# Frontend Preview Steps

> Detailed sub-steps for standalone frontend preview. Read during **Step 0.5** (Frontend Preview).

---

## ⚠️ ️ WORKING DIRECTORY — READ BEFORE RUNNING ANY COMMAND

**Every frontend command (scaffolder, `npm install`, `npx vite build`, `npx vite`, `npm run dev`, `npm run build`, etc.) MUST be invoked with `cwd` set to the frontend project folder — the directory that contains the frontend's `package.json` and `index.html` (typically `src/web/`). Running these commands from the workspace root is the #1 cause of the "preview is live but the page is blank" failure.**

| ✅ Correct | ❌ Wrong |
|----------|---------|
| `run_in_terminal` with `cwd: "src/web"` and command `npx vite --host` | `run_in_terminal` from workspace root running `npx vite --host` |
| `run_in_terminal` with `cwd: "src/web"` and command `npx vite build` | `cd src/web && npx vite build` chained from another shell that was launched at root, then forgotten on the next command |
| Pass the folder explicitly every time (don't rely on a previous `cd`) | Assume the terminal is still in `src/web/` from an earlier command — the agent runs each command in a fresh shell |

**Rules:**

1. Always pass the frontend folder via the `cwd` parameter of `run_in_terminal` (or whatever terminal tool is available). Do **not** rely on a previous `cd` — each terminal invocation may start at the workspace root.
2. If the tool doesn't take a `cwd` parameter, prefix every command with `cd <frontend-folder> &&` and put it on the *same* shell call as the build/run command. Never split `cd` and `npx vite` across two separate `run_in_terminal` calls.
3. The frontend folder is whatever the plan specifies — usually `src/web/`. Confirm by checking that the folder contains both `package.json` and `index.html` (or `vite.config.*`).
4. **Never claim the preview is live until you have verified it actually serves content** — see the verification gate in F4 below.

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

> ⚠️ ️ **WORKING DIRECTORY** (see also the top of this file): every `npx vite build`, `npx vite`, `npm run dev`, `npm install`, etc. **MUST be invoked with `cwd` set to the frontend folder** (e.g. `src/web/`), passed on the same terminal call as the command. Do **not** assume a previous `cd` carried over. Running from the workspace root produces a blank white page (Vite can't find `index.html`) and the dev server will still bind to the port — so it *looks* live but serves nothing useful.

### Approval Loop Procedure

1. **Frontend builds with zero errors.** Run `npx vite build` with `cwd: <frontend-folder>` (e.g. `src/web`). If the tool requires `cd`, do it in the same shell call: `cd src/web && npx vite build`. **Never run this from the project root.**
2. No `any` types in `.ts`/`.tsx` files
3. Preview is auto-authenticated — if app has login/auth, user lands on main content (not login page) on first load
4. **Start dev server.** Run `npx vite --host` async/detached with `cwd: <frontend-folder>` — e.g. `run_in_terminal` with `cwd: "src/web"` and command `npx vite --host`. If using a shell-only tool, use `cd src/web && npx vite --host` on the same call. **Running from project root produces a blank page — the server binds but serves no app.**
5. **VERIFICATION GATE — do not skip and do not claim the preview is live until this passes.** Before telling the user the preview is live, prove it actually serves the app:
   - Capture the dev-server log lines that start with `VITE v` / `Local:` / `Network:` and confirm the URL matches what you're about to open. Vite prints something like `Local: http://localhost:5173/`.
   - The log line `ready in <N> ms` is **not** enough — Vite reports "ready" even when started from the wrong directory; the page will still be blank.
   - Fetch the served page once (e.g. via the simple browser, or a quick HTTP request if available) and confirm the response body contains your app's root element / title, **not** an empty `<div id="root"></div>` with no script tags resolved.
   - If the response is blank or 404s on the entry script, **you ran from the wrong directory.** Kill the server, re-run with `cwd` set to the frontend folder, and re-verify.
6. **Open preview in VS Code's Simple Browser** using `simpleBrowser.show` command:
   - Use `run_vscode_command` tool: `simpleBrowser.show` with argument `"http://localhost:{port}/"` (use the port Vite actually printed, not a hard-coded default).
   - Opens embedded browser tab inside VS Code — no external browser needed.
7. **Ask user for approval** (use `ask_user`): _"Your frontend preview is live in your browser. Do you approve this UI, or would you like changes?"_ Only ask this **after** the verification gate in step 5 passes.
8. If user requests changes → make changes, rebuild, re-verify, ask again (loop)
9. If user approves → stop dev server, proceed to Step 11 (Wire Frontend) once Phase B also completes

> **CRITICAL**: Do NOT prompt "Would you like to preview?" — always auto-open in VS Code's Simple Browser via `simpleBrowser.show`. User explicitly opted into this workflow by approving a plan with frontend. Frontend preview is user's first chance to validate app direction — but backend builds in parallel since it depends only on plan.
>
> **EQUALLY CRITICAL**: Do NOT say "your preview is live" / "the dev server is running on localhost:5173" / "open it in your browser" until step 5's verification gate has passed. "The terminal printed `ready in 320 ms`" is **not** verification — Vite says that even when launched from the wrong folder, and the resulting page is blank. A blank page is worse than no preview because the user assumes the scaffold is broken.

---

## Frontend Quality Bar

Even in preview mode, frontend MUST meet these standards:
- No `any` types (use local type definitions in `src/web/src/types/`)
- Hooks catch errors and handle loading/error states
- Destructive actions (delete, etc.) require `window.confirm()` before executing
- `.tsx` for files containing JSX, `.ts` for pure TypeScript
- All 4 data states handled: loading, error, empty, data
- **Auto-authenticated preview**: If app has auth, preview MUST auto-login on first load so user sees main content immediately (not login page)
