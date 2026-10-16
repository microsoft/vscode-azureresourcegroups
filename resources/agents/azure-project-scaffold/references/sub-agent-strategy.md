# Sub-Agent Strategy for Backend Scaffolding

> Backend-scaffold parallelization. Read between **Step 1** and backend implementation.

---

## Execution Model

> ⚠️ **PIPELINING**: **Frontend sub-agent** (Step 1) and backend track start **immediately after Step 0** (plan validation), **concurrently**. Phase A (Contracts) and Phase B (Backend) derive from plan, not frontend; neither track blocks the other. For API-only projects (no frontend), skip Frontend sub-agent and start backend scaffolding immediately after Step 0.
>
> **Execution timeline for SPA + API projects:**
> ```
> Step 0 (Plan Validated)
>   ├── Frontend Sub-Agent (F1–F4: generate + build) ──> returns ──────────────────────────┐
>   └── Phase A: Contracts (sequential) ──> Phase B: Backend Sub-Agent ────────────────────┤
>                                                                                          ▼
>                                                                        Step 11: Wrap Up
> ```
>
> The Frontend sub-agent generates + builds + verifies `services/web/` (F1–F4) and hands back.

---

## Frontend Sub-Agent (parallel with backend)

Launched right after Step 0 (concurrently with Phase A/B). Owns frontend generation and build.

| Sub-Agent | Responsibility | Scope |
|-----------|---------------|-------|
| **Frontend Agent** (general-purpose) | Generate `services/web/`: the `ApiClient` seam (`src/api/` — interface + mock impl + one-line `index.ts` swap point) backed by a mock data layer with real images (F1–F2), pages + shared components that import only the seam `api` object (F3), login UI plus locally seeded identity when `API Login` is `Yes`, and all four data states. Login-enabled frontends MUST include a visible **Create account** button on the login page and a dedicated create-account page wired through `api.createAccount(...)`. When `API Login` is `No`, generate no auth UI or state. **The `ApiClient` interface must cover every entity the UI renders, including reference data the plan has no route for (assignee lookups, the signed-in user) — nothing outside `src/api/` may import `src/mocks/`.** Apply the Rule 13 quality bar + Polish floor. Run the frontend build gate (`npm --prefix services/web run build`, zero errors, no `any`) (F4). | Step 1 sub-steps **F1–F4** |

**Brief handed to the sub-agent** (full context it receives):
- The approved plan, especially **Section 6 (Design System & UI)**: `Component Library:`, `Style Direction:`, `Typography:`, Color Palette, Pages table.
- The approved HTML preview under `.azure/.preview-temp/` (manifest + per-page `<slug>.html` + `theme.css`) as the presentation-quality visual spec.
- The three frontend reference docs: `frontend-quality-bar.md`, `frontend-patterns.md`, `frontend-preview-steps.md`.

**Hand-back contract** (what the sub-agent returns):
- `services/web/` generated and **building cleanly** (it ran the F1–F4 checkpoints: build passes, no `any`, API Login behavior matches the plan, login-enabled apps have the required create-account button and page, four states present, Rule 13 satisfied).
- A short report listing the pages generated and any caveats.
- It MUST NOT call `ask_user` for UX approval — the design was already approved during planning.

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
| **Backend API Agent** (general-purpose) | Concrete service implementations, service registry, function handlers, OpenAPI spec, structured logging | Steps 3–10 implementation files |

> **NOTE**: Testing is NOT part of the scaffold phase. Test infrastructure, mocks, fixtures, and unit tests are out of scope — the scaffold produces correct, buildable production code only. Keeping tests out of scaffold ensures the production code stays focused and is not buried under test scaffolding.

---

## Coordination Rules

- The **Frontend Agent** and the backend track (Phase A → Phase B) launch together after Step 0 and run concurrently.
- The **Backend API Agent** receives the full project plan and the contracts created in Phase A as context.
- After the Backend agent completes, run the final build gate (`npm run build` in all workspaces).
- The scaffold does **not** start a dev server or open Simple Browser — the frontend is generated and built only; running it locally is out of scope for scaffolding.
- **Completion gate**: Step 11 (Wrap Up) writes the hand-off artifact only after BOTH: (a) frontend generated and building cleanly — the Frontend sub-agent returned — AND (b) Phase B backend agent completed. If one track finishes first, wait for the other.
- Then proceed to Step 11 (Wrap Up)

---

## Key Contract Rules

- Agent MUST use same `AppConfig` shape (flat structure — see [../../shared-references/service-abstraction.md](.github/agents/shared-references/service-abstraction.md))
- Agent MUST use same collection names (`'user'`, `'couple'`, etc.) mapping to SQL table names
- Agent MUST use same validation schema names exported from `services/shared/schemas/validation.ts`
