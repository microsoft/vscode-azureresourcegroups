# Frontend Preview Steps

> Detailed sub-steps for standalone frontend preview. Read during **Step 1** (Frontend Preview).

> **Companion contract**: Before writing any JSX, also read [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md). It defines the load-bearing contract between the plan's Section 6 (Design System & UI) and the JSX you ship — per-library region-token → primitive mapping, theming via the library's brand ramp, real icons, and the four-state coverage gate. The sub-steps below cover *how* to stand up the live preview (working directory, build, verify, open in Simple Browser); the quality bar covers *what* the preview must contain. Design approval already happened during planning via `.azure/.preview-temp/` — Step 1 does **not** re-prompt the user for UX approval.

---

## ⚠️ ️ WORKING DIRECTORY — READ BEFORE RUNNING ANY COMMAND

**Every frontend command (scaffolder, `npm install`, `npx vite build`, `npx vite`, `npm run dev`, `npm run build`, etc.) MUST be invoked with `cwd` set to the frontend project folder — the directory that contains the frontend's `package.json` and `index.html` (typically `services/web/`). Running these commands from the workspace root is the #1 cause of the "preview is live but the page is blank" failure.**

| ✅ Correct | ❌ Wrong |
|----------|---------|
| `run_in_terminal` with `cwd: "services/web"` and command `npx vite --host` | `run_in_terminal` from workspace root running `npx vite --host` |
| `run_in_terminal` with `cwd: "services/web"` and command `npx vite build` | `cd services/web && npx vite build` chained from another shell that was launched at root, then forgotten on the next command |
| Pass the folder explicitly every time (don't rely on a previous `cd`) | Assume the terminal is still in `services/web/` from an earlier command — the agent runs each command in a fresh shell |

**Rules:**

1. **Prefer a working-directory-independent command** for the frontend's own npm scripts: `npm --prefix <frontend-folder> run <script>` (e.g. `npm --prefix services/web run dev -- --host`). `--prefix` loads the frontend's `package.json` from that folder no matter where the shell starts, so it cannot accidentally run from the workspace root — this is the single most reliable way to avoid the blank-page failure for the dev server.
2. When you must use a tool/binary directly (e.g. `npx vite` with no `dev` script), pass the frontend folder via the `cwd` parameter of `run_in_terminal` on the **same** call. Do **not** rely on a previous `cd` — each terminal invocation may start at the workspace root.
3. If the tool doesn't take a `cwd` parameter, prefix every command with `cd <frontend-folder> &&` and put it on the *same* shell call as the build/run command. Never split `cd` and `npx vite` across two separate `run_in_terminal` calls.
4. The frontend folder is whatever the plan specifies — usually `services/web/`. Confirm by checking that the folder contains both `package.json` and `index.html` (or `vite.config.*`).
5. **Never claim the preview is live until you have verified it actually serves content** — see the verification gate in F4 below.

---

## Sub-step F1: Initialize Frontend Project

| Task | Details |
|------|---------|
| Initialize frontend project | React + Vite / Vue + Vite / Angular / Svelte (per plan) |
| Create the frontend folder | Use the path the plan specifies (e.g. `services/web/`); follow the user's existing structure when one exists. Standard structure matching plan's frontend framework |
| Create local type definitions | Define entity types locally in the frontend's types folder (e.g. `services/web/src/types/`) — standalone mock types for now |

---

## Sub-step F2: Create Mock Data Layer

| Task | Details |
|------|---------|
| Create mock data files | `services/web/src/mocks/data.ts` — realistic sample data matching plan entities. **Any entity field that represents an image — `image`/`photo`/`avatar`/`cover`/`thumbnail`/`banner`/`url` on a media entity — MUST be populated with a real, loadable image URL**, never left blank, `null`, or pointing at a solid-color placeholder. Use `https://picsum.photos/seed/<stable-id>/<w>/<h>` for generic media, curated `https://images.unsplash.com/...` URLs for domain-specific imagery, and `https://i.pravatar.cc/<size>?u=<id>` for avatars. Empty media surfaces render as flat color blocks and fail the quality bar. |
| Create mock API client | `services/web/src/mocks/api.ts` — returns mock data with simulated delays |
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

## Sub-step F4: Build & Auto-Open the Live Dev Server (no approval prompt)

> 🧭 **ORCHESTRATOR-OWNED STEP.** F1–F3 (generate `services/web/`) are delegated to the **Frontend Preview sub-agent**; **F4 is run by the orchestrator after that sub-agent returns.** The dev server is a long-running background process — a stateless sub-agent must not own it, or it risks being torn down when the sub-agent exits. See [sub-agent-strategy.md](.github/agents/azure-project-scaffold/references/sub-agent-strategy.md).

> ⚠️ **PARALLEL STEP**: Frontend generation (F1–F3, sub-agent) runs **concurrently** with Phase A (Contracts) and Phase B (Backend). Backend derives from **plan's route definitions and entity types**, not frontend preview — independent work streams. Phase A and Phase B may begin immediately after Step 0 (plan validation) while the Frontend sub-agent generates `services/web/`; the orchestrator then runs F4 to open the dev server.
>
> **Step 12 (Wire Frontend) is synchronization gate** — requires BOTH:
> - (a) Frontend dev server live in Simple Browser AND
> - (b) Phase B backend agent completed
>
> **Why safe**: Entity types, route definitions, service interfaces all come from approved plan. Frontend preview uses standalone mock types (`services/web/src/types/`) independent of `services/shared/`. Frontend UI changes (layout, styling, components) don't affect backend contracts. Only Step 12 merges both streams by replacing mock types with shared imports.

> ⚠️ ️ **WORKING DIRECTORY** (see also the top of this file): every `npx vite build`, `npx vite`, `npm run dev`, `npm install`, etc. **MUST run against the frontend folder** (e.g. `services/web/`), never the workspace root. **Prefer the working-directory-independent form `npm --prefix services/web run <script>`** (e.g. `npm --prefix services/web run dev -- --host`) — it loads the frontend's `package.json` regardless of where the shell starts. When invoking a binary directly (`npx vite`), pass `cwd: services/web` on the same terminal call; do **not** assume a previous `cd` carried over. Running from the workspace root produces a blank white page (Vite can't find `index.html`) and the dev server will still bind to the port — so it *looks* live but serves nothing useful.

> ⚠️ **NO UX APPROVAL PROMPT.** The user already approved the design during planning via the HTML/CSS mock-up at `.azure/.preview-temp/`. The Simple Browser preview here is **visibility-only** — it lets the user watch the real framework + library come together while backend Phase B finishes. **Do NOT call `ask_user` for "do you approve this UI?"** during scaffolding. The only legitimate user prompt during Step 1 is a hard build/runtime failure that requires their input to resolve.

### Procedure

1. **Frontend builds with zero errors.** Build with a **working-directory-independent** command so it can't accidentally run from the workspace root: `npm --prefix <frontend-folder> run build` (e.g. `npm --prefix services/web run build`). `--prefix` resolves the frontend's `package.json` regardless of where the shell starts, so it's immune to the root-launch bug. Only fall back to `npx vite build` with `cwd: <frontend-folder>` if there is no `build` script. **Never run a bare `npx vite build` from the project root.**
2. No `any` types in `.ts`/`.tsx` files.
3. Preview is auto-authenticated — if app has login/auth, user lands on main content (not login page) on first load.
4. **Start dev server — this is the step that shows the UI to the user, and the #1 place this fails by launching from the root.** Use the **working-directory-independent** form so the server cannot bind from the wrong folder:
   - **Preferred (cwd-independent):** `npm --prefix <frontend-folder> run dev -- --host` — e.g. `npm --prefix services/web run dev -- --host`. `--prefix` makes npm load the frontend's `package.json` and run its `dev` script from that folder no matter where the shell started, so the blank-page-at-root failure cannot happen. Run it async/detached.
   - **Only if there is no `dev` script:** `npx vite --host` **with `cwd: <frontend-folder>` set on the same `run_in_terminal` call** (e.g. `cwd: "services/web"`). Never rely on a previous `cd`, and never run a bare `npx vite --host` from the workspace root — the server binds to the port and prints `ready in N ms` but serves a blank page.
   - After launching, **confirm the actual working directory** from the dev-server log: Vite prints the project root / config path it resolved. If it points at the workspace root instead of the frontend folder, kill the server and relaunch with the `--prefix` (or `cwd`) form before proceeding to step 5.
5. **VERIFICATION GATE — do not skip and do not claim the preview is live until this passes.** Before opening Simple Browser, prove the server actually serves the app:
   - Capture the dev-server log lines that start with `VITE v` / `Local:` / `Network:` and confirm the URL matches what you're about to open. Vite prints something like `Local: http://localhost:5173/`.
   - The log line `ready in <N> ms` is **not** enough — Vite reports "ready" even when started from the wrong directory; the page will still be blank.
   - Fetch the served page once (e.g. via the simple browser, or a quick HTTP request if available) and confirm the response body contains your app's root element / title, **not** an empty `<div id="root"></div>` with no script tags resolved.
   - If the response is blank or 404s on the entry script, **you ran from the wrong directory.** Kill the server, re-run with `cwd` set to the frontend folder, and re-verify.
6. **Open preview in VS Code's Simple Browser** using `simpleBrowser.show` command:
   - Use `run_vscode_command` tool: `simpleBrowser.show` with argument `"http://localhost:{port}/"` (use the port Vite actually printed, not a hard-coded default).
   - Opens embedded browser tab inside VS Code — no external browser needed.
7. **Briefly announce** what the user is looking at and that backend work continues in parallel — one short sentence, e.g. *"Your frontend is live in Simple Browser. I'll keep working on the backend; you can check back any time to watch it evolve."* **Then keep working** — no approval question, no waiting loop. The dev server stays up until Step 12 wires it to the real backend.

> **CRITICAL**: Do NOT prompt "Would you like to preview?" or "Do you approve this UI?" during scaffolding — the user explicitly opted into this workflow by approving the plan + HTML mock-up. The Simple Browser preview is for visibility; design approval already happened.
>
> **EQUALLY CRITICAL**: Do NOT say "your preview is live" / "the dev server is running on localhost:5173" until step 5's verification gate has passed. "The terminal printed `ready in 320 ms`" is **not** verification — Vite says that even when launched from the wrong folder, and the resulting page is blank. A blank page is worse than no preview because the user assumes the scaffold is broken.

### Translating the planning mock-up into real framework code

The `.azure/.preview-temp/*.html` files are a **layout + tonal reference**, not source code to ship. For each page:

- The plan's Pages table tells you which **regions** belong on the page (`header + hero + grid + footer` etc.).
- The HTML mock-up shows the **approved arrangement, density, and palette** of those regions.
- Your job in Step 1 is to reproduce that visual feel using the **real `Component Library:` primitives** from Section 6 (see [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) for the per-library token → primitive mapping).

Do not import the HTML mock-up, embed it via `<iframe>`, or copy CSS class names from it into your JSX — the mock-up is throwaway and `.azure/.preview-temp/` is deleted in Step 13. Only the visual intent (regions, palette, density) carries forward into real components.

---

## Frontend Quality Bar

Even in preview mode, frontend MUST meet these standards. The full per-library contract lives in [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) — read it before writing any JSX. Baseline rules enforced here:

- No `any` types (use local type definitions in `services/web/src/types/`)
- Hooks catch errors and handle loading/error states
- Destructive actions (delete, etc.) require `window.confirm()` before executing
- `.tsx` for files containing JSX, `.ts` for pure TypeScript
- All 4 data states handled: loading, error, empty, data (see quality-bar's State Coverage Contract for per-library primitives — `<Skeleton>` / `<MessageBar intent="error">` / empty illustration + CTA / real data)
- **Auto-authenticated preview**: If app has auth, preview MUST auto-login on first load so user sees main content immediately (not login page)
- **Render layout tokens with real library primitives** — never raw `<div className="card">` placeholders. See [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) for the region-token → primitive mapping per library.
- **Wrap the app shell in the library's theme provider** with a brand ramp derived from plan Section 6's `primary` color. See [frontend-quality-bar.md](.github/agents/azure-project-scaffold/references/frontend-quality-bar.md) → Theming contract.
- **Use real icons** from the library's icon set (Fluent: `@fluentui/react-icons` Regular variants; Vuetify: `mdi-*`; Material: `<mat-icon>` real names; Skeleton/Pico: Lucide/Tabler). No emoji, no SVG placeholders.
