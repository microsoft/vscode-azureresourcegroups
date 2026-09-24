---
name: azure-project-plan-plan
description: "Plan-generation phase of the azure-project-plan agent — consume .azure/requirements.json and produce .azure/project-plan.md plus the frontend HTML/CSS preview. Read this on re-entry after the requirements form is submitted; for requirements gathering read requirements.md."
license: MIT
metadata:
  author: Microsoft
  version: "2.0.0"
---

# Azure Project Plan — Plan Generation

> **AUTHORITATIVE — MANDATORY** during the `azure-project-plan` agent's **plan-generation** phase. Follow exactly; ignore prior assumptions; supersedes all other sources. Never improvise.

> **Scope:** **Phase B only** — generate `.azure/project-plan.md` (Step 3), frontend preview (Step 3.5), and inlined Planning Quick Reference. Assumes requirements gathered per [`requirements.md`](requirements.md) and stored in `.azure/requirements.json`. Shared rules, triggers, autopilot behavior: [`instructions.md`](instructions.md).

## ═══════════════════════════════════════════════════
## PHASE 1: PLANNING — Plan
## ═══════════════════════════════════════════════════

> **Enter here on re-entry.** After requirements per [`requirements.md`](requirements.md) are stored in `.azure/requirements.json`, read it first; treat `answer` fields as authoritative; then generate plan below. If `dataStores` equals `["No datastore required"]`, add no datastore resource and never render `No datastore required` as an Azure service; still include non-datastore services needed to host/run app.
>
> Copy binary `auth` answer into Project Overview as `**API Login**: Yes` or `No`. This is plan/renderings' only authentication detail. Never name identity provider, token type, credential strategy, protected route, or per-route auth value. Scaffold agent chooses API authentication implementation when API Login is `Yes`. Backend-to-Azure uses managed identity, not a plan choice.

### Step 3: Generate Plan & Present for Approval

Write `.azure/project-plan.md` from template in a **single pass** (all sections at once, never section-by-section), then present for approval.

> **🔒 STRUCTURAL CONTRACT — non-negotiable.** Plan-preview webview (`open_plan_view`) is a **structured parser**, not Markdown renderer. It accepts only exact skeleton below; other structures parse **zero sections** and show *"couldn't render this plan — didn't match the expected layout"*.
> - **Copy skeleton verbatim**, replacing only `{placeholders}`. Do **not** invent sections.
> - Every section heading MUST be `## <N>. <Title>`: number, period, space, title (e.g. `## 1. Project Overview`, `## 2. Backend — Azure Functions`). Missing `N.` (e.g. `## Overview`, `## Architecture`, `## Services`, `## Data Stores`) is **invalid** and will not render.
> - Top metadata MUST be bold key-value rows `**Status**:`, `**Created**:`, `**Mode**:`, not front-matter/table.
> - Do **NOT** add generic architecture document, `mermaid` diagram, or heading absent from skeleton. Put data stores and architecture **inside** numbered sections, never separate improvised headings.
> - Fixed heading order: `# Project Plan` → `## 1. Project Overview` → one `## N. <Service> — <role>` per service → `## N. Services Required` → `## N. Prerequisites` → `## N. Design System & UI` (frontend only) → `## N. Project Structure` → `## N. Route Definitions` → `## N. Next Steps`. Renumber only; never rename/reshape.

#### Plan Template

`.azure/project-plan.md` structure (replace all `{placeholders}`):

````markdown
# Project Plan

**Status**: Planning
**Created**: {date}
**Mode**: {NEW | AUGMENT}

---

## 1. Project Overview

**Goal**: {Brief description of what the user is building}. The project is designed so that every module is independently testable.

**App Type**: {API only | SPA + API | Full-stack SSR | Static + API | Background worker — **derived from the detected services**, not asked}

**API Login**: {Yes | No — copied from the `auth` requirements answer}

**Mode**: {NEW | AUGMENT}

**Deployment Plan**: {`.azure/plan.md` found — services derived from deployment plan | No deployment plan found}

---

## 2. Backend — Azure Functions

> One **stack section per service** — emit a `## N. <Service> — <role>` heading and a single combined table for the backend, a frontend section when the app has a UI, and extra sections for any worker services. The plan view turns every section that has a **Language** row into an editable, language-aware stack card, so each service picks its own language independently. Renumber the sections that follow to match the services you emit.

| Component | Technology |
|-----------|-----------|
| **Language** | {TypeScript / Python / C#} |
| **Runtime** | {Node / Bun / Deno / CPython / PyPy / .NET} |
| **Package Manager** | {npm / pnpm / pip / poetry / dotnet (NuGet)} |
| **Test Runner** | {vitest / jest / pytest / xUnit} |
| **Mocking Library** | {vi.mock / jest.mock / sinon / unittest.mock / **NSubstitute** (.NET — never Moq, see runtimes/dotnet.md)} |
| **Test Command** | {npm test / pytest / dotnet test} |
| **Orchestration** | docker-compose |

> **Language vs Runtime**: `Language` is the source language the user picked in this service's `language` question. `Runtime` is the execution runtime — default `Node` for TypeScript/JavaScript, `CPython` for Python, `.NET` for C#. Only deviate from the default (e.g. `Bun`, `Deno`, `PyPy`) when the user explicitly asks. **Package Manager and Test Runner are language-dependent** — match them to this service's Language (e.g. C# → `dotnet (NuGet)` + `xUnit`/`NUnit`/`MSTest`). The `Orchestration` row is recorded for the scaffold step but hidden in the plan UI — always keep it set to `docker-compose`.

---

## 3. Frontend — Web App

> Emit this section only when `services` contains a `frontend` service (derived App Type ≠ `API only` / `Background worker`); omit it entirely otherwise. The frontend is its own service with its own Language and **Framework**. Frontend Language is always **JavaScript or TypeScript** — even when the backend uses Python or C#, the frontend is a JS/TS app.

| Component | Technology |
|-----------|-----------|
| **Language** | {TypeScript / JavaScript} |
| **Framework** | {React + Vite / Vue + Vite / Angular / Svelte} |
| **Package Manager** | {npm / pnpm} |
| **Test Runner** | {vitest / jest} |
| **Mocking Library** | {vi.mock / jest.mock / sinon} |
| **Test Command** | {npm test} |

---

## 4. Services Required

| Azure Service | Role in App | Environment Variable | Default Value (Local) | Classification |
|---------------|------------|---------------------|----------------------|----------------|
| {Blob Storage} | {Store uploaded images} | {STORAGE_CONNECTION_STRING} | {UseDevelopmentStorage=true} | {Essential} |
| {PostgreSQL} | {Primary data store} | {DATABASE_URL} | {postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/appdb} | {Essential} |

---

## 5. Prerequisites

Identify the required tools, then inventory them by following [prerequisites.md](../shared-references/prerequisites.md). Always produce **both** groups — `### Run` and `### Debug` — as two sub-tables under this section. The plan webview shows the Run group always and the Debug group only when the user turns on the Autopilot toggle, so do not omit either group yourself.

The required tools are derived from the technology stacks and Azure services associated with each service. Map each stack to its chosen tooling, e.g. runtime - Node, package manager - npm, project type - Azure Functions Core Tools (for Azure Functions), etc. The Run vs Debug distinction is defined in [prerequisites.md](../shared-references/prerequisites.md): Run tools are needed to run the project; Debug tools (Docker, Docker Compose, VS Code extensions) are the local-debugging extras.

The Debug group must include a row for every detected project type's VS Code debug-integration extension from the prerequisites.md Debug Tools table (e.g. an Azure Functions service always adds `ms-azuretools.vscode-azurefunctions`). These extension rows are required and separate from the Run-group CLI/runtime tools — do not omit them just because a related Run tool (like Functions Core Tools) is already listed.

For each tool, record which planned service(s) need it in the `Service(s)` column (use `*` for global toolchain shared by all services, or list each service explicitly). For a container runtime or orchestrator (Docker, Docker Compose), list the service(s) whose Azure dependencies its emulators stand in for, rather than `*`.

After identifying the required tools, run the detection pass to fill the `Installed` column (✅ / ❓) and detected `Version`. Produce the columns `Tool`, `Service(s)`, `Installed`, and `Version` — **do not** add or emit any install links or URLs.

Every row resolves to just two states, following the status rules in [prerequisites.md](../shared-references/prerequisites.md): installed (✅) when a scan positively finds the tool, or unknown (❓) when it can't be confirmed. Never mark a tool ❌, because absence can't be proven in a sandboxed agent environment where version managers or shells may have limited access in locating an installed tool. Never leave the `Installed` column as a placeholder or `—`; every row must resolve to ✅ or ❓ from an actual scan. Inform the user to double-check all ❓ tools are installed before proceeding.

**Re-run the detection pass when the whole plan is (re)generated from scratch or the tool set itself changes** (e.g. a Runtime edit or an added/removed service). Do **not** re-run it for a partial regeneration that doesn't touch this section's tools — unless the user explicitly asks to recheck prerequisites.

---

## 6. Design System & UI


> **MANDATORY when `services` contains a `frontend` service.** Skip only when there is no frontend service (derived App Type `API only` / `Background worker`). The plan-preview webview parses this section by title (`s.title.toLowerCase().includes('design system')`) and the scaffold quality contract reads `Component Library:` to decide which real library primitives to render.

**Component Library**: {Fluent UI v9 / Vuetify 3 / Skeleton UI / Angular Material / Pico.css — see PLANNING QUICK REFERENCE → Component Library Defaults}
**Style Direction**: {1–2 sentence design intent, e.g. "Modern data-dense console with subtle elevations, rounded 4px corners, and an emphasis on scannable lists."}
**Typography**: {Inter, system-ui / Roboto / Segoe UI Variable}

### Color Palette

> **Choose colors that fit THIS app — never copy the example hexes.** Derive the palette from `Style Direction` above plus any brand cues in the user's prompt (industry, mood, named colors, an existing logo). The `{#…}` values are illustrative placeholders, **not** defaults — only fall back to a plain neutral set when the project genuinely has no brand or style direction (e.g. generic internal tooling). The **Usage** column must describe each color's role in **this app's** UI in domain terms, not generic boilerplate. Token names (`primary`, `accent`, `surface`, `text`, `muted`, `border`) are a **fixed contract** — do NOT rename, add, or drop them; the scaffold's quality contract and preview theming key off these exact names.

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `{#…}` | {Brand color — primary buttons, links, active nav} |
| `accent`  | `{#…}` | {Secondary accents, highlights} |
| `surface` | `{#…}` | {Page + card backgrounds} |
| `text`    | `{#…}` | {Body text} |
| `muted`   | `{#…}` | {Secondary text, captions, timestamps} |
| `border`  | `{#…}` | {Dividers, input + card borders} |

### Pages

> **List THIS app's real screens and give each its own content-specific layout.** Name pages after what they show (recipe app → `Recipes` / `Recipe Detail` / `New Recipe`; issue tracker → `Board` / `Issue` / `Backlog`), and choose each page's region tokens from the records that page actually displays — a list-heavy page wants `table`/`card-list`, a single-record page wants `two-column(media+meta) + action-bar`, a capture flow wants `form`. Do **not** reuse one boilerplate layout for every row or pad a page with regions it has no content for.

| Page | Route | Purpose | Layout |
|------|-------|---------|--------|
| {Primary page — name it after the main entity} | `/` | {one-line purpose} | `{region tokens chosen for this page's content}` |
| {Next page} | `{/route}` | {one-line purpose} | `{region tokens for this page's content}` |

> **Layout tokens are layout INTENT, not implementation.** The scaffold agent renders them using `Component Library` primitives per the scaffold skill's `frontend-quality-bar.md`. Recognized tokens: `header, nav, sidebar, hero, main, list, card-list, grid, form, table, actions, action-bar, tabs, modal, footer`. Compound tokens: `split(a|b)` (1:2 columns), `two-column(a+b)` (1:1 columns).

### Sample Content

> **Shared content contract — this is what keeps the planning preview and the scaffolded app in parity.** The preview sub-agents (Step 3.5b) and the scaffold agent both read this block and render the **same** records, so the preview faithfully previews what ships instead of generic filler. Author it now, while you have full domain context (Sections 1–4).

For each page above, list 3–6 representative records using that page's primary entity — a short table or bullet list per page, whatever fits the data shape. Use **real values from this app's domain** (real entity names, realistic numbers, real states) — a recipe app lists recipes, an issue tracker lists issues, a storefront lists products. **Never** emit generic placeholders like "Item 1", "Recent items", "Card title", or lorem ipsum. The skeleton below shows the **format**, not the content — replace every `{...}` with your domain's records.

```
{Page name} — {primary entity}:
| {Field A}     | {Field B} | {Field C} | {Status} |
| {record 1 …}  | {…}       | {…}       | {state}  |
| {record 2 …}  | {…}       | {…}       | {state}  |
| {record 3 …}  | {…}       | {…}       | {state}  |

{Form/settings page} — {field}: {realistic default} · {field}: {realistic default}
```

---

## 7. Project Structure

```
{Generated directory tree for the chosen stack}
```

---

## 8. Route Definitions

| # | Method | Path | Description | Request Body | Response Body | Status Codes |
|---|--------|------|-------------|-------------|--------------|-------------|
| 1 | GET | `/api/health` | Health check | — | `{ status, services }` | 200, 503 |
| {n} | {METHOD} | {/api/path} | {description} | {body or —} | {response shape} | {codes} |

---

## 9. Next Steps

1. Run **azure-project-scaffold** to execute this plan
2. Run **azure-project-integrate** to wire the frontend to live data, smoke-test the backend, and create the migrations
3. Run **azure-debug-plan** → **azure-debug-generate** for Docker emulators and VS Code debugging
4. Run the **azure-deploy** agent when ready; it uses **azure-app-onboard** for architecture, cost estimation, IaC generation, provisioning, and health verification
````

#### After Writing the Plan

> **Order matters: open plan view BEFORE rendering per-page previews.** Loading lets user interact with plan while previews generate. Opening only after all pages delays plan and breaks flow.

0. **Self-check structure BEFORE opening view.** Re-read `.azure/project-plan.md`; confirm all below. On failure, **rewrite file** to match skeleton before continuing; do **not** open malformed plan, which shows parse-error banner:
   - Top has bold key-value rows `**Status**:`, `**Created**:`, `**Mode**:`, not YAML front-matter/table.
   - `## 1. Project Overview` has exactly one auth-related value: `**API Login**: Yes` or `No`.
   - Every `##` heading matches numbered `## <N>. <Title>`. No unnumbered `##` headings like `## Overview`, `## Architecture`, `## Services`, or `## Data Stores`.
   - No `mermaid` block or improvised section outside fixed skeleton.
   - `## 1. Project Overview` has `**Goal**:`; Section 5, when frontend exists, is `## N. Design System & UI` with `**Component Library**:`.
1. **Write preview scaffolding** per Step 3.5a: `.azure/.preview-temp/theme.css` + `manifest.json`, every page `status: "pending"`. Skip all Step 3.5 without `frontend` service (derived App Type `API only` / `Background worker`; no UI).
2. **Open plan preview NOW** via `azure-project-plan.agent.md` workflow's `open_plan_view` tool, **immediately after `manifest.json` exists and before page sub-agent fan-out**. Webview watches `.azure/.preview-temp/`, showing plan plus per-page *Generating preview…* placeholders.
3. **Render page previews** per Step 3.5b: fan out one sub-agent per page. Already-open view replaces each placeholder with HTML when `<slug>.html` lands.
4. **Present plan**, ask for approval.
5. If approved, change status `Planning` → `Approved`.
6. **Immediately invoke `azure-project-scaffold`** (auto-chain); do NOT ask user to invoke it. Scaffold treats `.azure/.preview-temp/*.html` as presentation-quality visual spec, translating it into real components with Frontend stack framework.

> **❌ STOP** — Do NOT proceed until approval; then auto-chain immediately.

---

### Step 3.5: Generate Frontend HTML/CSS Preview (parallel sub-agents)

> **Skip entirely** when Section 6 was omitted: no `frontend` service, derived App Type `API only` / `Background worker`. Otherwise **mandatory**; without it, plan-preview webview permanently shows *Generating preview…* and provides no UI to approve.

**Output location:** `.azure/.preview-temp/` (leading dot; transient gitignored scratch space). Scaffold reads it as presentation-quality visual spec, then deletes it in scaffold Step 13.

**Inputs:** new `.azure/project-plan.md` Section 6 (Color Palette, Typography, Pages, Style Direction, Component Library); **Shared design-quality principles** in [`../shared-references/frontend-quality-bar.md`](../shared-references/frontend-quality-bar.md), the fidelity-agnostic contract for preview and scaffold; per-region recipes in [`references/html-preview.md`](references/html-preview.md). Read html-preview **once** at step start. Parent needs `## Shared CSS` for `theme.css` (Step 3.5a), `## Icons`, and `## Token → HTML recipes` for per-page sub-agent slices (Step 3.5b). Never send Shared CSS to sub-agents.

#### 3.5a. Write `theme.css` and `manifest.json` (do this BEFORE fan-out)

Both files MUST predate plan-preview webview opening so controller renders loading tabs. Use OS-agnostic `create_file`, which auto-creates parent folders.

**`.azure/.preview-temp/theme.css`** — shared stylesheet derived from Section 6:

```css
:root {
    /* ── Brand colors (from Section 6 palette) ── */
    --color-primary: {hex from Section 6};
    --color-on-primary: {white or near-black, whichever contrasts better};
    --color-accent: {hex};
    --color-on-accent: {white or near-black};

    /* ── Surfaces (derive from the palette — do NOT assume a light theme) ── */
    --color-surface: {hex — page background from Section 6};
    --color-surface-raised: {a card/panel tone that reads as raised against surface — #ffffff for a light theme, a step LIGHTER than surface for a dark one};
    --color-surface-sunken: color-mix(in srgb, var(--color-surface) 92%, var(--color-text) 6%);

    /* ── Text & borders ── */
    --color-text: {hex — e.g. #111827};
    --color-muted: {hex — e.g. #6b7280};
    --color-border: {hex — e.g. #e5e7eb};

    /* ── Semantic (status badges, alerts) ── */
    --color-success: #16a34a;
    --color-warning: #d97706;
    --color-danger:  #dc2626;

    /* ── Typography ── */
    --font-body: {typography from Section 6}, system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-heading: var(--font-body);
    --text-xs: 11px;
    --text-sm: 13px;
    --text-base: 14px;
    --text-lg: 16px;
    --text-xl: 20px;
    --text-2xl: 26px;
    --text-3xl: 34px;

    /* ── Shape (match the roundness to Style Direction — these are a neutral middle, not a mandate) ── */
    /* sharp/technical → 2–4px · balanced → the values below · soft/friendly → 12–18px */
    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 16px;
    --radius-pill: 9999px;

    /* ── Spacing scale (4px base) ── */
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 20px;
    --space-6: 28px;
    --space-7: 40px;
    --space-8: 56px;

    /* ── Elevation (multi-tier — gives cards/buttons/menus real depth) ── */
    --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06);
    --shadow-md: 0 4px 12px rgba(15, 23, 42, 0.10);
    --shadow-lg: 0 12px 28px rgba(15, 23, 42, 0.16);
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-body);
    font-size: var(--text-base);
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}
h1, h2, h3, h4 {
    font-family: var(--font-heading);
    line-height: 1.2;
    margin: 0;
}
a { color: var(--color-primary); text-decoration: none; }
a:hover { text-decoration: underline; }
/* Plus the shared component CSS from references/html-preview.md §Shared CSS */
```

> **Aim for presentation quality:** stakeholder-ready visual spec with depth from multi-tier `--shadow-*`, consistent radius, coherent palette, clear type hierarchy. `references/html-preview.md` Shared CSS adds hover/focus transitions, skeleton shimmer, and polished empty/error states. Per `shared-references/frontend-quality-bar.md`, raw-static preview leaves only real webfonts, JavaScript behavior, and real photos to scaffold; everything else looks finished.

Paste full Shared CSS from `references/html-preview.md` into same file. Keep header, nav, sidebar, hero, etc. names exactly as defined so per-page HTML matches.

**`.azure/.preview-temp/manifest.json`** — one entry per page in Section 6's Pages table:

```json
{
    "generatedAt": "{ISO timestamp}",
    "previewStatus": "{ready | generating}",
    "pages": [
        { "slug": "dashboard", "title": "Dashboard", "route": "/", "status": "pending" },
        { "slug": "settings",  "title": "Settings",  "route": "/settings", "status": "pending" }
    ]
}
```

- `previewStatus`: overall state; `"generating"` while initial/revision work runs, `"ready"` when all complete. Set `"generating"` before preview writes and `"ready"` after all pages. **Always update for initial generation and feedback revisions**.
- `slug`: kebab-cased page name (`Photo Upload` → `photo-upload`), unique and matching eventual `<slug>.html`.
- `route`: exact Section 6 Pages path; default `/<slug>` if missing.
- `status`: starts `"pending"` per page; SHOULD become `"ready"` in step 3.5c after HTML write for accuracy. Rendering instead depends on **non-empty `<slug>.html` presence**. Manifest supplies page list (slug/title/route) and initial loading tabs.

#### 3.5a-open. Open the plan view NOW — before fanning out

Once `theme.css` and `manifest.json` exist, workflow opens plan view via `open_plan_view` per `azure-project-plan.agent.md` Step C. **Do this before Step 3.5b.** User immediately gets plan plus one *Generating preview…* tab per manifest page while sub-agents render. Do **not** wait for completion; this ordering prevents that delay regression.

> **Embedded webview only** (agent Hard rule 8): render preview *exclusively* as sandboxed iframes in plan webview **UI Preview** card; never `simpleBrowser.show`, `vscode.env.openExternal`, dev server, or `.preview-temp/*.html` editor tab. Planning preview has no port/URL.

#### 3.5b. Fan out one sub-agent per page (parallel)

Launch one `runSubagent` per page, **all in one tool-call batch**; platform parallelizes them. Cap at **4 concurrent**; split more pages into batches of 4. Each prompt MUST contain:

1. The page's row from Section 6's Pages table (page name, route, purpose, layout regions).
2. Color Palette, Typography, Style Direction, Component Library values for visual fidelity.
3. **App domain context** — 1–2 sentence Sections 1–2 summary plus relevant entity/data model.
4. **Page records from Section 6 Sample Content** — required real domain-specific rows/values. Shared content contract; scaffold reproduces them.
5. **Only needed region recipes** from already-read `## Token → HTML recipes`: recipes for this row's layout tokens; `## Icons` inline-SVG library; `## Adapting sizing to the domain`; `## Wrapping a full page`; `## Hard rules`. **Do NOT pass `## Shared CSS`** (~500 lines), already in `theme.css`; pages link to `theme.css`. **Do NOT pass unnamed region recipes.**
6. **Parent-assigned state.** Across pages, depict each non-data state **at least once**: one data-bearing page `loading (skeleton)`, one tab/section `empty`, one page `error (inline banner)`. Give matching recipe/instruction only to assigned sub-agent; all others render populated `data`.
7. The exact output path: `.azure/.preview-temp/<slug>.html`.
8. A directive: *"Write a single self-contained, **presentation-quality** HTML file linking to `./theme.css` — it must look like a finished product screen, not a wireframe. Use the per-region recipes provided above, in the order from the page's Layout. Replace every `{...}` placeholder token with the real Sample Content provided above — never generic filler like 'Item 1', 'Recent items', or 'Card title'. Put a **real inline-SVG icon** (from the `## Icons` block) in every nav item, sidebar item, KPI tile, section-title row, empty state, and primary CTA — no emoji, no glyphs. **Fill every image slot** with a neutral placeholder (surface + border media block with a muted icon, or initials) — never a brand-color gradient and never an empty box. Name primary CTAs after their action ('Create project', not 'Submit'). In nav/sidebar, link each **sibling** page with `href="./<sibling-slug>.html"` (the sibling's kebab-cased page name, matching its `<slug>.html`) so cross-page navigation works; the current page's own link uses `href="#"`. Do NOT add a banner claiming the app 'will use' a different library. Do NOT add `<script>` tags or inline `on*=` handlers (they are stripped before rendering). Do NOT inline any CSS — all styling MUST come from `./theme.css` (only the tiny layout shims shown in the recipes are allowed)."*

Expected file shape:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{Page Title} — Preview</title>
    <link rel="stylesheet" href="./theme.css">
</head>
<body>
    <!-- Per-region HTML per references/html-preview.md, in the order from the plan's Pages table -->
</body>
</html>
```

> ⚠️ `<link rel="stylesheet" href="./theme.css">` is load-bearing. `ScaffoldPlanViewController` replaces it at runtime with inline `<style>`, making iframe `srcDoc` self-contained. Inline CSS or different `href` prevents substitution and yields unstyled HTML.

#### 3.5c. (Optional) Flip statuses to `ready` after each page lands

Webview renders when `<slug>.html` exists; it does **not** await manifest `status`. For manifest accuracy, SHOULD change each `manifest.json` page `status` to `"ready"` after HTML write. Either:
- update after every sub-agent (more responsive), or
- update once after all complete (simpler).

**Always set `"previewStatus": "ready"` in final manifest update** after all pages to dismiss webview "Generating preview…" overlay.

Webview watcher refreshes on every `.azure/.preview-temp/` change, so tabs render near-real-time.

> **✅ Checkpoint**: `.azure/.preview-temp/{theme.css, manifest.json, *.html}` exist. Every page has non-empty `<slug>.html`, enabling render; manifest `status` is best-effort bookkeeping. `manifest.json` has `"previewStatus": "ready"`. Plan-preview webview shows each rendered HTML iframe.

#### 3.5d. Updating previews after user feedback

For plan changes affecting preview pages (e.g. color, layout, content), MUST update `previewStatus` in `manifest.json`:

1. **Before preview writes**: set `manifest.json` `"previewStatus": "generating"` to immediately show "Generating preview…" overlay.
2. **Edit affected files** — `theme.css`, `project-plan.md`, and/or `<slug>.html` pages.
3. **After all preview writes**: set `manifest.json` `"previewStatus": "ready"` to dismiss overlay.

If feedback changes only plan text (e.g. section rename/description), requiring no `.azure/.preview-temp/` changes, do **not** touch `previewStatus`; leave `"ready"`. This field alone drives overlay; `"generating"` without preview work confuses user.

Webview watches all `.azure/.preview-temp/`, automatically picking up manifest updates. Failing to update `previewStatus` during preview rewrites leaves overlay absent and confuses user.

---

## ═══════════════════════════════════════════════════
## PLANNING QUICK REFERENCE (Inlined — No External Reads)
## ═══════════════════════════════════════════════════

> Complete planning architecture context. **Do NOT read external reference files during Phase 1.**

### Service-to-Environment-Variable Mapping

| Azure Service | Environment Variable | Local Default |
|---------------|---------------------|---------------|
| Blob Storage | `STORAGE_CONNECTION_STRING` | `UseDevelopmentStorage=true` |
| Queue Storage | `STORAGE_CONNECTION_STRING` | `UseDevelopmentStorage=true` |
| Table Storage | `STORAGE_CONNECTION_STRING` | `UseDevelopmentStorage=true` |
| PostgreSQL | `DATABASE_URL` | `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/{dbname}` |
| CosmosDB | `COSMOSDB_CONNECTION_STRING` | `AccountEndpoint=https://localhost:8081/;AccountKey=...` |
| Redis | `REDIS_URL` | `redis://localhost:6379` |
| Azure SQL | `SQL_CONNECTION_STRING` | `Server=localhost,1433;Database={db};...` |
| Azure OpenAI | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` | _(no local emulator)_ |

> ⚠️ **.NET runtime override (C# Functions):** .NET scaffolds use standard `ConnectionStrings:*` config via `IConfiguration.GetConnectionString("...")`, **NOT** generic env vars above. For selected runtime `csharp`, translate per table:
>
> | Generic env var | .NET config key |
> |-----------------|-----------------|
> | `STORAGE_CONNECTION_STRING` | `ConnectionStrings:Storage` |
> | `DATABASE_URL` | `ConnectionStrings:AppDb` |
> | `REDIS_URL` | `ConnectionStrings:Redis` |
> | `COSMOSDB_CONNECTION_STRING` | `ConnectionStrings:Cosmos` |
> | `SQL_CONNECTION_STRING` | `ConnectionStrings:Sql` |
> | `AZURE_OPENAI_ENDPOINT` / `_API_KEY` | `OpenAI:Endpoint` / `OpenAI:ApiKey` (typed `IOptions<T>`) |
>
> Production `ConnectionStrings:*` values must be **resource URIs** (e.g., `https://<account>.blob.core.windows.net`) authenticated by `DefaultAzureCredential` (Managed Identity), never raw account keys. Full mapping: [runtimes/dotnet.md](.github/agents/shared-references/runtimes/dotnet.md#managed-identity--quick-reference).

### Essential vs Enhancement Classification

| Type | Definition | Failure Behavior | Examples |
|------|-----------|-----------------|---------|
| **Essential** | Request cannot succeed without this service | Propagate error (4xx/5xx) | Database, primary storage |
| **Enhancement** | Request can succeed with degraded output | Catch error, use fallback, log warning | AI captions, email notifications, analytics |

> **Key rule**: Enhancement service constructors MUST NOT throw. Defer config validation to method calls or use try/catch.

### Component Library Defaults (Section 6 of the plan)

> **Pick frontend framework default** unless user explicitly names another library. Put chosen value verbatim in Section 6 as `**Component Library**: {value}`; it is load-bearing input for scaffold quality contract `references/frontend-quality-bar.md`.

| Frontend framework | Default `Component Library` | Reasonable alternatives | Use the default unless... |
|---------------|----------------------------|------------------------|---------------------------|
| `React` | **Fluent UI v9** (`@fluentui/react-components`) | shadcn/ui + Radix, Material UI v6, Chakra UI v3 | user explicitly names one of the alternatives, OR project already has another library installed |
| `Vue` | **Vuetify 3** | PrimeVue 4, Element Plus | user explicitly names one |
| `Svelte` | **Skeleton UI** | Melt UI + Tailwind | user explicitly names one |
| `Angular` | **Angular Material** | PrimeNG | user explicitly names one |
| `None` (plain HTML / Static + API) | **Pico.css** + native form controls | Bulma, water.css | user explicitly names one |
| `None` + `Background worker` | omit Section 6 entirely | \u2014 | always omit when there is no UI |

> **Why this matters**: Without `Component Library:`, scaffold treats region tokens (`header`, `hero`, `grid`, ...) as raw layout, producing blocky placeholder `<div>` JSX worse than presentation-quality preview. With `Component Library:`, scaffold renders regions using themed real library primitives: cards, tabs, fields, toolbars, message bars.

> **Plan-preview note**: Webview renders Section 6 as **sandboxed HTML/CSS iframe** from `.azure/.preview-temp/<page>.html`: presentation-quality theme, real inline-SVG icons, elevation, populated content, all four data states. Raw-static limits leave only real webfonts, JavaScript behavior, and real photos to scaffold. Scaffold reproduces this look with planned `Component Library`, adds production capabilities, and must never be less polished.

### Error Response Contract

All errors use this shape:
```json
{ "error": { "code": "NOT_FOUND", "message": "Item not found", "details": null } }
```

| Error Code | HTTP Status | When |
|------------|-------------|------|
| `VALIDATION_ERROR` | 422 | Request body fails validation |
| `BAD_REQUEST` | 400 | Malformed request |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `CONFLICT` | 409 | Duplicate resource |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `INTERNAL_ERROR` | 500 | Unhandled exception |

### Example Project Structure (TypeScript — SPA + API)

> **Default convention for brand-new projects**, not mandate. Follow existing workspace structure; never impose these paths. Names below (`services/functions`, `services/web`, `services/shared`, …) illustrate roles to map onto actual layout.
>
> **Prefer domain-specific deployable app names.** With clear product name, derive kebab-case slug: Functions backend `services/<project>-api`; frontend `services/<project>-<type>` (`-portal`/`-app`/`-web`, whichever fits). Example office-compliance calendar: `services/office-compliance-api`, `services/office-compliance-portal`. Keep shared package generic (`services/shared`). Use generic `functions`/`web` only without clear project name. Record choice in Section 7; use consistently in `workspaces`, imports, and `main`/`rootDir`.

```
project-root/
├── .azure/
│   └── project-plan.md
├── .env.example
├── .gitignore
├── package.json                    ← Root workspace config
├── services/
│   ├── functions/                  ← Azure Functions project
│   │   ├── host.json
│   │   ├── local.settings.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── functions/          ← One handler per file
│   │   │   ├── services/           ← Service abstraction layer
│   │   │   │   ├── interfaces/     ← Service contracts
│   │   │   │   ├── config.ts       ← Config loader + validation
│   │   │   │   └── registry.ts     ← Service factory / DI
│   │   │   ├── errors/             ← Error types and middleware
│   │   │   └── middleware/
│   │   ├── tests/
│   │   │   ├── fixtures/
│   │   │   ├── mocks/
│   │   │   ├── services/
│   │   │   ├── functions/
│   │   │   └── validation/
│   │   └── seeds/
│   ├── web/                        ← Frontend (if applicable)
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── api/client.ts       ← Typed API client
│   │       ├── components/
│   │       ├── pages/
│   │       └── hooks/
│   └── shared/                     ← Shared types and schemas
│       ├── package.json
│       ├── types/
│       │   ├── entities.ts         ← Entity types
│       │   └── api.ts              ← Response contracts + ErrorCode
│       └── schemas/
│           └── validation.ts       ← Zod schemas + inferred request types
```

### Shared Types Design Rule

> **Do NOT define request types in BOTH `types/api.ts` AND `schemas/validation.ts`.** Zod `z.infer<typeof schema>` are canonical request types:
> - `types/entities.ts` → Entity interfaces
> - `types/api.ts` → Response types, ErrorCode union
> - `schemas/validation.ts` → Zod schemas + inferred request types

### Architecture Core Principles

1. **Service boundary isolation** — Every Azure service behind interface
2. **Dependency injection** — Handlers receive services, never import SDKs
3. **Environment-driven config** — Same code for mocks, emulators, Azure
4. **Monorepo by default** — Frontend, backend, shared types in one repo
5. **Contracts first** — Shared types before implementation
6. **One function per file** — Each Function independently testable

---

## Outputs

| Artifact | Location |
|----------|----------|
| **Project Plan** | `.azure/project-plan.md` (Status: Approved) |

---

## Next

> **Automatic** after approval: immediately invoke **azure-project-scaffold**:
> - Generates frontend preview (if applicable) with auto-open in VS Code Simple Browser
> - Scaffolds backend (services, handlers, migrations, types)
> - Auto-invokes **azure-project-integrate** to wire the frontend to live data, smoke-test the backend, and create migrations
>
> **No user action required**; automatic chain.
