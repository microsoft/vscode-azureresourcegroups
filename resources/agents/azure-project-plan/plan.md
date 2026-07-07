---
name: azure-project-plan-plan
description: "Plan-generation phase of the azure-project-plan agent — consume .azure/requirements.json and produce .azure/project-plan.md plus the frontend HTML/CSS preview. Read this on re-entry after the requirements form is submitted; for requirements gathering read requirements.md."
license: MIT
metadata:
  author: Microsoft
  version: "2.0.0"
---

# Azure Project Plan — Plan Generation

> **AUTHORITATIVE — MANDATORY** for the **plan-generation** phase of the `azure-project-plan` agent. Follow exactly; ignore prior assumptions; supersede all other sources. Do not improvise.

> **Scope:** this file covers **Phase B only** — generate `.azure/project-plan.md` (Step 3), the frontend preview (Step 3.5), and the inlined Planning Quick Reference. It assumes requirements were already gathered per [`requirements.md`](requirements.md) and written to `.azure/requirements.json`. Shared rules, triggers, and autopilot behavior live in [`instructions.md`](instructions.md).

## ═══════════════════════════════════════════════════
## PHASE 1: PLANNING — Plan
## ═══════════════════════════════════════════════════

> **Enter here on re-entry.** This phase runs after requirements were gathered per [`requirements.md`](requirements.md) and written to `.azure/requirements.json`. Read that file first (Step 2f), treat its `answer` fields as authoritative, then generate the plan below.

### Step 3: Generate Plan & Present for Approval

Write `.azure/project-plan.md` from the template below in a **single pass** (fill all sections at once — never section-by-section), then present for approval.

> **🔒 STRUCTURAL CONTRACT — non-negotiable.** The plan-preview webview (`azureResourceGroups.openPlanView`) is a **structured parser**, not a markdown renderer. It only understands the exact skeleton below. If you improvise a different structure, the webview parses **zero sections** and shows the user a *"couldn't render this plan — didn't match the expected layout"* error instead of the plan.
> - **Copy the skeleton below verbatim**, replacing only `{placeholders}`. Do **not** invent your own sections.
> - Every section heading MUST be `## <N>. <Title>` — a number, a period, a space, then the title (e.g. `## 1. Project Overview`, `## 2. Backend — Azure Functions`). Headings without the `N.` number prefix (e.g. `## Overview`, `## Architecture`, `## Services`, `## Data Stores`, `## Authentication`) are **invalid** and will not render.
> - Metadata at the top MUST be `**Status**:`, `**Created**:`, `**Mode**:` bold key-value rows — not front-matter, not a table.
> - Do **NOT** add a generic architecture document, a `mermaid` diagram, a standalone `## Authentication` section, or any heading not present in the skeleton. Authentication, data stores, and architecture are captured **inside** the numbered sections (Services Required, the per-service stack sections, Route Definitions), never as their own improvised headings.
> - The set and order of headings is fixed: `# Project Plan` → `## 1. Project Overview` → one `## N. <Service> — <role>` per service → `## N. Services Required` → `## N. Design System & UI` (frontend only) → `## N. Project Structure` → `## N. Route Definitions` → `## N. Next Steps`. Renumber only; never rename or reshape.

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
| {PostgreSQL} | {Primary data store} | {DATABASE_URL} | {postgresql://localdev:localdevpassword@localhost:5432/appdb} | {Essential} |

---

## 5. Prerequisites

Identify the required tools, then inventory them by following [prerequisites.md](../shared-references/prerequisites.md). Always produce **both** groups — `### Run` and `### Debug` — as two sub-tables under this section. The plan webview shows the Run group always and the Debug group only when the user turns on the Autopilot toggle, so do not omit either group yourself.

The required tools are derived from the technology stacks and Azure services associated with each service. Map each stack to its chosen tooling, e.g. runtime - Node, package manager - npm, project type - Azure Functions Core Tools (for Azure Functions), etc. The Run vs Debug distinction is defined in [prerequisites.md](../shared-references/prerequisites.md): Run tools are needed to run the project; Debug tools (Docker, Docker Compose, VS Code extensions) are the local-debugging extras.

The Debug group must include a row for every detected project type's VS Code debug-integration extension from the prerequisites.md Debug Tools table (e.g. an Azure Functions service always adds `ms-azuretools.vscode-azurefunctions`). These extension rows are required and separate from the Run-group CLI/runtime tools — do not omit them just because a related Run tool (like Functions Core Tools) is already listed.

For each tool, record which planned service(s) need it in the `Service(s)` column (use `*` for global toolchain shared by all services, or list each service explicitly). For a container runtime or orchestrator (Docker, Docker Compose), list the service(s) whose Azure dependencies its emulators stand in for, rather than `*`.

After identifying the required tools, run the detection pass to fill the `Installed` column (✅ / ❌) and detected `Version`. In the `Install` column, record the install command/URL the user would run if the tool is missing.

**You must re-run the detection pass every time this section is generated or the plan is rebuilt** — recompute it whenever the plan changes (e.g. a Runtime edit or an added/removed service). Never leave the `Installed` column as a placeholder, `—`, or unknown value; every row must resolve to ✅ or ❌ from an actual scan. Flag any tool marked ❌ — the user must install it before approving.

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

> **Shared content contract — this is what keeps the planning preview and the scaffolded app in parity.** The preview sub-agents (Step 3.5b) and the scaffold agent both read this block and render the **same** records, so the low-fidelity preview faithfully previews what ships instead of generic filler. Author it now, while you have full domain context (Sections 1–4).

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

| # | Method | Path | Description | Request Body | Response Body | Auth | Status Codes |
|---|--------|------|-------------|-------------|--------------|------|-------------|
| 1 | GET | `/api/health` | Health check | — | `{ status, services }` | None | 200, 503 |
| {n} | {METHOD} | {/api/path} | {description} | {body or —} | {response shape} | {auth} | {codes} |

---

## 8. Next Steps

1. Run **azure-project-scaffold** to execute this plan
2. Run **azure-project-integrate** to wire the frontend to live data, smoke-test the backend, and create the migrations
3. Run **azure-debug-plan** → **azure-debug-generate** for Docker emulators and VS Code debugging
4. Run **azure-prepare** → **azure-deploy** when ready to deploy
````

#### After Writing the Plan

> **Order matters — open the plan view BEFORE rendering the per-page previews.** The whole point of the loading state is that the user sees and can interact with the plan document while the page previews are still being generated. If you generate every preview page first and only then open the view, the plan appears late and the flow is broken.

0. **Self-check the structure BEFORE opening the view.** Re-read the `.azure/project-plan.md` you just wrote and confirm ALL of the following. If any check fails, **rewrite the file** to match the skeleton before continuing — do **not** open the view on a malformed plan (the webview would show a parse-error banner instead):
   - The top has `**Status**:`, `**Created**:`, `**Mode**:` bold key-value rows (not YAML front-matter, not a table).
   - Every `##` heading matches `## <N>. <Title>` (numbered). There are **no** un-numbered `##` headings such as `## Overview`, `## Architecture`, `## Services`, `## Data Stores`, or `## Authentication`.
   - There is **no** `mermaid` block and **no** improvised section outside the fixed skeleton.
   - `## 1. Project Overview` exists and contains a `**Goal**:` row, and Section 5 (when a frontend exists) is `## N. Design System & UI` with a `**Component Library**:` row.
1. **Write the preview scaffolding** — Step 3.5a below: write `.azure/.preview-temp/theme.css` + `manifest.json` (every page `status: "pending"`). Skip this and all of Step 3.5 when there is no `frontend` service (derived App Type `API only` / `Background worker` — no UI to preview).
2. **Open the plan preview NOW** — the workflow rules in `azure-project-plan.agent.md` call `azureResourceGroups.openPlanView`. Do this **immediately after `manifest.json` exists and before fanning out the page sub-agents**. The webview starts watching `.azure/.preview-temp/` and shows the plan document plus a *Generating preview…* placeholder per page.
3. **Render the page previews** — Step 3.5b below: fan out one sub-agent per page. The view is already open; its file watcher flips each page from *Generating preview…* to the rendered HTML as soon as its `<slug>.html` lands.
4. **Present plan**, ask for approval.
5. If approved, update status from `Planning` to `Approved`.
6. **Immediately invoke `azure-project-scaffold`** (auto-chain). Do NOT ask user to invoke manually. The scaffold agent treats `.azure/.preview-temp/*.html` as a mock-up reference and translates it into real components using the framework named in the Frontend stack section.

> **❌ STOP** — Do NOT proceed past approval until user approves. Once approved, auto-chain immediately.

---

### Step 3.5: Generate Frontend HTML/CSS Preview (parallel sub-agents)

> **Skip entirely** when Section 6 was omitted (i.e. no `frontend` service — derived App Type `API only` / `Background worker`). For all other app types this step is **mandatory** — without it, the plan-preview webview shows a permanent *Generating preview…* spinner and the user has no UI to approve.

**Output location:** `.azure/.preview-temp/` (note the leading dot on the folder name — it's a transient, gitignored scratch space). The scaffold agent reads it as a mock-up reference, then deletes it as the last step of scaffolding (see scaffold skill Step 13).

**Inputs:** the just-written `.azure/project-plan.md` Section 6 (Color Palette, Typography, Pages, Style Direction, Component Library) plus the per-region recipes in [`references/html-preview.md`](references/html-preview.md). Read that reference file **once** at the start of this step — the parent needs its `## Shared CSS` block for `theme.css` (Step 3.5a) and its `## Token → HTML recipes` to hand per-page slices to the sub-agents (Step 3.5b). The sub-agents never receive the Shared CSS.

#### 3.5a. Write `theme.css` and `manifest.json` (do this BEFORE fan-out)

Both files MUST exist before the plan-preview webview opens, so the controller can render tabs in the loading state. Use the `create_file` tool — it's OS-agnostic and creates parent folders automatically.

**`.azure/.preview-temp/theme.css`** — single shared stylesheet derived from Section 6:

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

    /* ── Elevation (preview = single tier; the scaffold uses real component-library elevation) ── */
    --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06);
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

> **Why so plain?** This stylesheet powers a *directional sketch* — it confirms color story, page regions, and density during planning, nothing more. The scaffold raises the visual ambition (real component library, real icons, motion, dark mode, polished hero treatments). Resist the urge to add depth/shadow tiers/gradients here — that work belongs in the scaffold and is governed by `azure-project-scaffold/references/frontend-quality-bar.md` "Polish floor".

Paste the full Shared CSS block from `references/html-preview.md` into the same file (header, nav, sidebar, hero, etc. — keep names exactly as the reference defines so the per-page HTML matches).

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

- `previewStatus` is a top-level field indicating the overall state of the preview set. Valid values: `"generating"` (initial generation or revision in progress), `"ready"` (all preview work is complete). Set it to `"generating"` before starting any preview file writes and to `"ready"` after all pages have been written. **Always update it, both during initial generation and when revising previews after user feedback**.
- `slug` is the kebab-cased page name (`Photo Upload` → `photo-upload`). It MUST match the eventual filename (`<slug>.html`). Slugs MUST be unique.
- `route` is the path from Section 6's Pages table verbatim. Default to `/<slug>` when missing.
- `status` starts at `"pending"` for every page. You SHOULD flip it to `"ready"` in step 3.5c after the HTML is written (keeps the manifest accurate), but the webview no longer depends on it — **the presence of a non-empty `<slug>.html` file is what makes a page render**. The manifest only supplies the page list (slug/title/route) and the initial loading tabs.

#### 3.5a-open. Open the plan view NOW — before fanning out

The instant `theme.css` and `manifest.json` exist, the agent workflow opens the plan view (`azureResourceGroups.openPlanView`, per `azure-project-plan.agent.md` Step C). **Do this before Step 3.5b.** The user immediately sees the plan document plus one *Generating preview…* tab per manifest page, and can read and interact with the plan while the page sub-agents render in the background. Do **not** wait for the sub-agents to finish before the view opens — that delay is exactly the regression this ordering prevents.

> **Embedded webview only** (see agent Hard rule 8): the preview renders *exclusively* inside the plan webview's **UI Preview** card as sandboxed iframes — never `simpleBrowser.show`, `vscode.env.openExternal`, a dev server, or a `.preview-temp/*.html` editor tab. There is no port or URL for the planning preview.

#### 3.5b. Fan out one sub-agent per page (parallel)

Launch one `runSubagent` call per page, **all in a single tool-call batch** (the platform parallelizes independent sub-agent invocations). Cap at **4 concurrent** — if the plan has more than 4 pages, split into batches of 4. Each sub-agent's prompt MUST contain:

1. The page's row from Section 6's Pages table (page name, route, purpose, layout regions).
2. The Color Palette, Typography, Style Direction, and Component Library values (for visual fidelity hints).
3. **The app's domain context** — a 1–2 sentence summary of what the app does (from Sections 1–2) plus the relevant entity/data model, so the sub-agent knows what the page is actually about.
4. **That page's records from Section 6's Sample Content block** — the real, domain-specific rows/values the page must display. This is the shared content contract; the scaffold reproduces the same records.
5. **Only the region recipes this page needs** — from the `## Token → HTML recipes` section you already read, copy just the recipes for the layout tokens in this page's row, plus the `## Adapting sizing to the domain`, `## Wrapping a full page`, and `## Hard rules` sections. **Do NOT pass the `## Shared CSS` block** (~465 lines) — it was already baked into `theme.css` in Step 3.5a, and sub-agents link to `theme.css` rather than the CSS source. **Do NOT pass recipes for regions this page's layout doesn't name.**
6. The exact output path: `.azure/.preview-temp/<slug>.html`.
7. A directive: *"Write a single self-contained HTML file linking to `./theme.css`. Use the per-region recipes provided above, in the order from the page's Layout. Replace every `{...}` placeholder token in the recipes with the real Sample Content provided above — never generic filler like 'Item 1', 'Recent items', or 'Card title'. Do NOT add a banner claiming the app 'will use' a different library. Do NOT add `<script>` tags — the preview iframe runs sandboxed without scripts. Do NOT inline any CSS — all styling MUST come from `./theme.css`."*

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

> ⚠️ The `<link rel="stylesheet" href="./theme.css">` is load-bearing — the extension's `ScaffoldPlanViewController` substitutes it with an inline `<style>` block at runtime so the iframe `srcDoc` is self-contained. If you inline CSS or use a different `href`, the substitution won't fire and the preview will fall back to unstyled HTML.

#### 3.5c. (Optional) Flip statuses to `ready` after each page lands

The webview renders a page the moment its `<slug>.html` file exists — it does **not** wait for a manifest `status` change — so the preview appears even if you skip this step. Still, for an accurate manifest you SHOULD rewrite `manifest.json` with each page's `status` flipped to `"ready"` once its HTML is written. Either:
- update the manifest after every sub-agent completes (more responsive), or
- update once at the end after all sub-agents complete (simpler).

**Always set `"previewStatus": "ready"` in the final manifest update** after all pages are written — this is what dismisses the "Generating preview…" overlay in the webview.

The webview's file watcher refreshes on every change under `.azure/.preview-temp/`, so the user sees tabs flip from loading to rendered in near-real-time.

> **✅ Checkpoint**: `.azure/.preview-temp/{theme.css, manifest.json, *.html}` all exist. Every page has a non-empty `<slug>.html` (which is what makes it render; the manifest `status` is best-effort bookkeeping). `manifest.json` has `"previewStatus": "ready"`. The plan-preview webview now shows the rendered HTML inside the iframe per page.

#### 3.5d. Updating previews after user feedback

When the user requests changes to the plan that affect preview pages (e.g. color changes, layout changes, content changes), you MUST update `previewStatus` in `manifest.json` to signal the webview:

1. **Before writing any preview files**: update `manifest.json` with `"previewStatus": "generating"`. This shows the "Generating preview…" overlay immediately.
2. **Edit the affected files** — `theme.css`, `project-plan.md`, and/or individual `<slug>.html` pages as needed.
3. **After all preview files are written**: update `manifest.json` with `"previewStatus": "ready"`. This dismisses the overlay.

If the user's feedback only affects the plan text (e.g. renaming a section, adjusting a description) and does **not** require changes to any file in `.azure/.preview-temp/`, do **not** touch `previewStatus` — leave it at `"ready"`. The overlay is driven exclusively by this field; setting it to `"generating"` when no preview work is happening will confuse the user.

The webview watches the entire `.azure/.preview-temp/` folder, so the manifest update is picked up automatically. Skipping the `previewStatus` update when preview files *are* being rewritten will leave the overlay absent during generation, also confusing the user.

---

## ═══════════════════════════════════════════════════
## PLANNING QUICK REFERENCE (Inlined — No External Reads)
## ═══════════════════════════════════════════════════

> All architectural context for planning. **Do NOT read external reference files during Phase 1.**

### Service-to-Environment-Variable Mapping

| Azure Service | Environment Variable | Local Default |
|---------------|---------------------|---------------|
| Blob Storage | `STORAGE_CONNECTION_STRING` | `UseDevelopmentStorage=true` |
| Queue Storage | `STORAGE_CONNECTION_STRING` | `UseDevelopmentStorage=true` |
| Table Storage | `STORAGE_CONNECTION_STRING` | `UseDevelopmentStorage=true` |
| PostgreSQL | `DATABASE_URL` | `postgresql://localdev:localdevpassword@localhost:5432/{dbname}` |
| CosmosDB | `COSMOSDB_CONNECTION_STRING` | `AccountEndpoint=https://localhost:8081/;AccountKey=...` |
| Redis | `REDIS_URL` | `redis://localhost:6379` |
| Azure SQL | `SQL_CONNECTION_STRING` | `Server=localhost,1433;Database={db};...` |
| Azure OpenAI | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` | _(no local emulator)_ |

> ⚠️ **.NET runtime override (C# Functions):** .NET scaffolds use the standard `ConnectionStrings:*` config convention (read via `IConfiguration.GetConnectionString("...")`), **NOT** the generic env var names above. When the selected runtime is `csharp`, translate the table above as follows:
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
> In production, the `ConnectionStrings:*` values should be **resource URIs** (e.g., `https://<account>.blob.core.windows.net`) authenticated via `DefaultAzureCredential` (Managed Identity) — never raw account keys. See [runtimes/dotnet.md](.github/agents/shared-references/runtimes/dotnet.md#managed-identity--quick-reference) for the full mapping.

### Essential vs Enhancement Classification

| Type | Definition | Failure Behavior | Examples |
|------|-----------|-----------------|---------|
| **Essential** | Request cannot succeed without this service | Propagate error (4xx/5xx) | Database, auth provider, primary storage |
| **Enhancement** | Request can succeed with degraded output | Catch error, use fallback, log warning | AI captions, email notifications, analytics |

> **Key rule**: Enhancement service constructors MUST NOT throw. Defer config validation to method calls or wrap in try/catch.

### Component Library Defaults (Section 6 of the plan)

> **Pick the default for the user's frontend framework** unless the user explicitly named a different library. The chosen value goes into Section 6 verbatim as `**Component Library**: {value}` and becomes the load-bearing input for the scaffold quality contract (see scaffold skill `references/frontend-quality-bar.md`).

| Frontend framework | Default `Component Library` | Reasonable alternatives | Use the default unless... |
|---------------|----------------------------|------------------------|---------------------------|
| `React` | **Fluent UI v9** (`@fluentui/react-components`) | shadcn/ui + Radix, Material UI v6, Chakra UI v3 | user explicitly names one of the alternatives, OR project already has another library installed |
| `Vue` | **Vuetify 3** | PrimeVue 4, Element Plus | user explicitly names one |
| `Svelte` | **Skeleton UI** | Melt UI + Tailwind | user explicitly names one |
| `Angular` | **Angular Material** | PrimeNG | user explicitly names one |
| `None` (plain HTML / Static + API) | **Pico.css** + native form controls | Bulma, water.css | user explicitly names one |
| `None` + `Background worker` | omit Section 6 entirely | \u2014 | always omit when there is no UI |

> **Why this matters**: Without `Component Library:`, the scaffold step treats the wireframe's region tokens (`header`, `hero`, `grid`, ...) as raw layout instructions and produces blocky placeholder `<div>` JSX that LOOKS worse than the plan-preview wireframe. With `Component Library:` set, the scaffold renders each region using real library primitives (cards, tabs, fields, toolbars, message bars) themed by the Color Palette.

> **Plan-preview note**: The plan-preview webview renders Section 6 as a **sandboxed HTML/CSS iframe** loaded from `.azure/.preview-temp/<page>.html`. It deliberately does NOT use any component library, real icons, motion, dark mode, or webfonts — the preview is a *directional sketch* (color story + page regions + density), and the scaffolded app is required to visibly exceed it using whatever `Component Library` is named in the plan. The webview disclosure reads *"Directional mock, not the final UI. The scaffold renders this with **{Component Library}**, real icons, motion, and dark mode — it will look noticeably more polished than the sketch below."* and a `MOCK` ribbon overlays the iframe.

### Error Response Contract

All error responses follow this shape:
```json
{ "error": { "code": "NOT_FOUND", "message": "Item not found", "details": null } }
```

| Error Code | HTTP Status | When |
|------------|-------------|------|
| `VALIDATION_ERROR` | 422 | Request body fails validation |
| `BAD_REQUEST` | 400 | Malformed request |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `CONFLICT` | 409 | Duplicate resource |
| `UNAUTHORIZED` | 401 | Missing/invalid auth token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `INTERNAL_ERROR` | 500 | Unhandled exception |

### Example Project Structure (TypeScript — SPA + API)

> This is a **default convention for a brand-new project**, not a mandate. When the workspace already has a structure, follow it; never assume or impose these exact paths. Treat the names below (`services/functions`, `services/web`, `services/shared`, …) as illustrative roles the agent maps onto the user's actual layout.
>
> **Prefer domain-specific names for the deployable apps.** When the project has a clear product name, derive a kebab-case slug and name the Functions backend `services/<project>-api` and the frontend `services/<project>-<type>` (`-portal`/`-app`/`-web`, whichever fits) — e.g. for an office-compliance calendar: `services/office-compliance-api`, `services/office-compliance-portal`. Keep the shared package generic (`services/shared`). Fall back to the generic `functions`/`web` only when there is no clear project name. Whatever you choose, record it in Section 7 and use it consistently across `workspaces`, imports, and `main`/`rootDir`.

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

> **Do NOT define request types in BOTH `types/api.ts` AND `schemas/validation.ts`.** With Zod, `z.infer<typeof schema>` ARE canonical request types:
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

> **Automatic**: After plan approved, immediately invokes **azure-project-scaffold**:
> - Generates frontend preview (if applicable) with auto-open in VS Code Simple Browser
> - Scaffolds backend (services, handlers, migrations, types)
> - Auto-invokes **azure-project-integrate** to wire the frontend to live data, smoke-test the backend, and create migrations
>
> **No user action required** — chain is automatic.
