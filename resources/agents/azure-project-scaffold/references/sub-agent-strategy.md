# Sub-Agent Strategy for Backend Scaffolding

> Parallelization strategy for backend scaffold execution. Read when transitioning from **Step 1** to backend implementation.

---

## Execution Model

> ⚠️ **PIPELINING**: The **Frontend sub-agent** (Step 1) and the backend track both begin **immediately after Step 0** (plan validation) and run **concurrently**. Phase A (Contracts) and Phase B (Backend) derive from the plan, not the frontend, so neither track blocks the other. For API-only projects (no frontend), the Frontend sub-agent is skipped and backend scaffolding proceeds immediately after Step 0.
>
> **Execution timeline for SPA + API projects:**
> ```
> Step 0 (Plan Validated)
>   ├── Frontend Sub-Agent (F1–F4: generate + build) ──> returns ──────────────────────────┐
>   └── Phase A: Contracts (sequential) ──> Phase B: Backend Sub-Agent ────────────────────┤
>                                                                                          ▼
>                                                                        Step 12: Wire Frontend
>                                                                        Step 13: Wrap Up
> ```
>
> **No live preview**: the scaffold generates and builds the frontend but does **not** start a dev server or open the Simple Browser. Running the app locally is out of scope for scaffolding. The Frontend sub-agent generates + builds + verifies `services/web/` (F1–F4) and hands back.

---

## Frontend Sub-Agent (parallel with backend)

Launched right after Step 0 (concurrently with Phase A/B). Owns frontend generation and build — no dev server, no live preview.

| Sub-Agent | Responsibility | Scope |
|-----------|---------------|-------|
| **Frontend Agent** (general-purpose) | Generate `services/web/`: mock data layer with real images (F1–F2), pages + shared components wired to the mock API client (F3), auto-authenticated state, all four data states. Apply the Rule 15 quality bar + Polish floor. Run the frontend build gate (`npm --prefix services/web run build`, zero errors, no `any`) (F4). | Step 1 sub-steps **F1–F4** |

**Brief handed to the sub-agent** (full context it receives):
- The approved plan, especially **Section 5 (Design System & UI)**: `Component Library:`, `Style Direction:`, `Typography:`, Color Palette, Pages table.
- The approved HTML mock-up under `.azure/.preview-temp/` (manifest + per-page `<slug>.html` + `theme.css`) as the directional sketch.
- The three frontend reference docs: `frontend-quality-bar.md`, `frontend-patterns.md`, `frontend-preview-steps.md`.

**Hand-back contract** (what the sub-agent returns):
- `services/web/` generated and **building cleanly** (it ran the F1–F4 checkpoints: build passes, no `any`, auto-auth seeded, four states present, Rule 15 satisfied).
- A short report listing the pages generated and any caveats.
- It MUST NOT start the dev server, open Simple Browser, or call `ask_user`. **The scaffold does not launch a live preview.**

---

## Phase A: Contracts First (BLOCKING — Sequential, No Parallelism)

Create sequentially — dependencies for everything else:
1. Shared types (`services/shared/types/`)
2. Validation schemas (`services/shared/schemas/`)
3. Service interfaces (`services/functions/src/services/interfaces/`)
4. Error types (`services/functions/src/errors/`)
5. Config module (`services/functions/src/services/config.ts`)

Build shared package to produce `dist/`. Verify cross-workspace imports resolve.

---

## Phase B: Parallel Implementation via Sub-Agents

Once contracts exist on disk, launch backend sub-agent:

| Sub-Agent | Responsibility | Scope |
|-----------|---------------|-------|
| **Backend API Agent** (general-purpose) | Concrete service implementations, service registry, function handlers, migrations, seed data, OpenAPI spec, structured logging | Steps 3–10 implementation files |

> **NOTE**: Testing is NOT part of the scaffold phase. Test infrastructure, mocks, fixtures, and unit tests are out of scope — the scaffold produces correct, buildable production code only. Keeping tests out of scaffold ensures the production code stays focused and is not buried under test scaffolding.

---

## Coordination Rules

- The **Frontend Agent** and the backend track (Phase A → Phase B) launch together after Step 0 and run concurrently.
- The **Backend API Agent** receives the full project plan and the contracts created in Phase A as context.
- After the Backend agent completes, run the final build gate (`npm run build` in all workspaces).
- The scaffold does **not** start a dev server or open Simple Browser — the frontend is generated and built only; running it locally is out of scope for scaffolding.
- **Synchronization gate**: Step 12 (Wire Frontend) MUST wait for BOTH: (a) frontend generated and building cleanly — the Frontend sub-agent returned — AND (b) Phase B backend agent completed. If one track finishes first, wait for the other.
- Then proceed to Step 12 (Wire Frontend) and Step 13 (Wrap Up)

---

## Key Contract Rules

- Agent MUST use same `AppConfig` shape (flat structure — see [../../shared-references/service-abstraction.md](.github/agents/shared-references/service-abstraction.md))
- Agent MUST use same collection names (`'user'`, `'couple'`, etc.) mapping to SQL table names
- Agent MUST use same validation schema names exported from `services/shared/schemas/validation.ts`
