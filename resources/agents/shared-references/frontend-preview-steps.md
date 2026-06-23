# Frontend Preview Steps

> **Who reads this:**
> - **`azure-project-plan` (Phase 2: Frontend Preview)** — during planning you generate a **small set of cross-linked static HTML pages** in `.azure/frontend-preview/` (a shared `styles.css` + `index.html` + one `*.html` file per page) that together are a **high-fidelity, presentation-quality mockup of the final UI** — visually pleasing and as close to the shipped product as a no-framework, no-script set of files can be. **Navigation between pages works** via relative `<a href>` links; every other control (buttons, inputs, toggles) is **non-functional**. No framework, no build step, no dev server, no JavaScript. **Author the per-page files in parallel with subagents** (one page each) for speed. Follow sub-steps **F1–F4** to author the files and let the plan webview embed the navigable preview for approval. The approval loop in F4 is the user's UX sign-off.
> - **`azure-project-scaffold` (Step 1: Regenerate Frontend)** — the static preview is a **visual specification**, not shippable code. The scaffold agent builds the **real framework frontend** (React/Vue/Angular/Svelte per plan) in the project's frontend folder (e.g. `services/web/`, or the user's existing structure), reproducing the approved preview's layout, palette, typography, and component look using the chosen library's real primitives. It does NOT copy `.azure/frontend-preview/` into the frontend folder.
>
> Sub-steps F1–F4 below describe the planning case (authoring the static preview). The scaffold case reads the **Scaffold: Regenerate From Spec** section at the bottom.

> **Companion contract**: Before authoring the preview markup, also read [frontend-quality-bar.md](.github/agents/shared-references/frontend-quality-bar.md). It defines the load-bearing contract between the plan's Section 6 (Design System & UI) and what the preview must show — region-token coverage, theming from the brand color, real iconography, and the four-state gate. The sub-steps below cover *how* to produce the preview; the quality bar covers *what* it must contain.

---

## ⚠️ HARD CONSTRAINTS — READ BEFORE AUTHORING THE PREVIEW

The planning-phase preview is a **single static file**. It must render instantly inside the plan webview with zero tooling.

| ✅ Required | ❌ Forbidden |
|------------|-------------|
| A small set of static files in `.azure/frontend-preview/`: `index.html` + one `*.html` per page + a shared `styles.css` | A `src/`, a `package.json`, a bundler, a dev server |
| CSS in the shared `styles.css` (linked with a **relative** `<link rel="stylesheet" href="styles.css">`) and/or an inline `<style>` block | Remote stylesheet CDNs, `@import url(https://...)` |
| Plain HTML elements styled to look polished & production-ready | React/Vue/Angular/Svelte components, JSX, SFCs |
| Self-contained — every file opens correctly with no network access | CDN `<script src="https://...">`, web-font CDN links, remote images |
| Inline SVG icons (paste the path data) | Icon-font CDNs, `lucide-react` / `@fluentui/react-icons` / any icon npm package, remote icon packs |
| Imagery via CSS gradients / inline SVG / themed color blocks | Remote `<img src="https://...">`, stock-photo URLs, base64 of real photos |
| Static mock content typed directly into the markup | Fetching data, JS frameworks, a dev server / `vite` / `npm` |
| **Page-to-page navigation links work** (relative `<a href="other.html">`); all other controls (buttons, inputs, tabs, toggles) are visual only | JavaScript/`<script>`, form submission, working toggles, event handlers, any behavior beyond plain link navigation |

> **Fidelity target — presentation quality, not a wireframe.** Treat the preview as a **demo-ready mockup of the final product**: the screen a designer would show a stakeholder to sign off the look. It must be genuinely *visually pleasing* — balanced spacing, real depth (subtle shadows/elevation), consistent corner radius, a coherent themed palette, polished typography hierarchy, and realistic populated content. "Static" constrains *behavior*, never *visual fidelity*. A flat, gray, boxy result fails this bar even if it is technically self-contained.

> **Imagery without the network:** remote images are forbidden, so represent every image/avatar/thumbnail with a themed substitute — a CSS gradient panel, an inline SVG illustration, or a colored block with a centered initial/icon. Avatars = a themed circle with initials. Card media = a gradient or inline-SVG hero. Never leave an empty box where an image belongs; that reads as unfinished.

**Why these rules:** the preview files are loaded by the plan webview as **webview-resource URIs** inside an iframe (scripts disabled, no remote network). Real files served from disk are what make page-to-page navigation work — and they appear instantly with no `npm install` and no dev server. There is **no terminal, no build, and no localhost** in this workflow — if you find yourself running `npm install` or `vite`, you are doing the planning preview wrong.

> **No JavaScript — navigation via plain links only.** The only working interaction is **navigating between pages** through relative `<a href="other.html">` links. Every other control (buttons, form fields, tabs, toggles) is styled to look real but does **nothing**. Do **not** add `<script>` or event handlers — the iframe runs with scripts disabled, so any JS is dead weight. Pure-CSS `:hover` / `:focus` *styling* is fine; functional behavior (beyond link navigation) is not. The real, interactive app is built later by the scaffold agent in the framework — the preview only has to *look* finished and let the user click between pages.

---

## Sub-step F1: Derive Design Tokens From the Plan

Read **Section 6 (Design System & UI)** of the plan and extract:

| Token | Source | Use in preview |
|-------|--------|----------------|
| Component library | Plan's chosen library (shadcn/ui, Vuetify, Material, Pico, etc.) | Informational only — you do **not** need to emulate it; aim for a clean, production-ready look |
| Palette | Section 6 color list (`primary`, `surface`, `text`, etc.) | CSS custom properties at `:root` |
| Typography | Section 6 font family / scale | `font-family`, heading/body sizes |
| Pages | Section 6 / route list | One `*.html` file per page |
| Layout regions | Per-page region tokens (header, sidebar, content, etc.) | Real layout, not placeholder boxes |

Define every color and font as a CSS custom property in `:root` inside the shared `styles.css` so the webview's palette/typography editors map cleanly onto them, and so every page inherits one consistent design system.

---

## Sub-step F2: Build the Shared Shell & Stylesheet

| Task | Details |
|------|---------|
| Shared stylesheet | Author `styles.css` with the `:root` theme variables plus reusable component classes (buttons, cards, tables, nav, badges, form fields). Every page links it with `<link rel="stylesheet" href="styles.css">` so all pages share one look |
| Theme variables | `:root { --primary: ...; --surface: ...; --text: ...; --font: ...; }` derived from Section 6 |
| App chrome | A header/top bar + navigation (sidebar or nav rail) that is **identical on every page** and whose nav items are real relative `<a href="page.html">` links so the embedded preview is navigable |
| Authenticated view | Render the **main authenticated content directly** — the preview is the signed-in app, NOT a login page |
| Production-ready polish | Apply a clean, modern look: consistent corner radius, subtle elevation/shadows, balanced spacing rhythm, clear button shapes, comfortable control density — you do **not** need to mimic any specific component library |

---

## Sub-step F3: Build Each Page (in parallel)

Write **one HTML file per page** (`index.html` for the landing/home page, then `dashboard.html`, `settings.html`, etc.). Each page file: links the shared `styles.css`, embeds the identical shell/nav from F2, and fills the content region with that page's UI. Author these page files **in parallel using subagents** — dispatch one subagent per page with the shared design tokens, the shell markup, and that page's spec — then write them all to `.azure/frontend-preview/`.

| Task | Details |
|------|---------|
| One file per page | A self-contained `*.html` for each major feature/route from the plan, all sharing the F2 shell + `styles.css` |
| Cross-links | Every page's nav points to its siblings with relative `<a href="other.html">` so the user can click through the whole app |
| Real layout regions | Reproduce each page's region tokens (header, toolbar, list, detail, cards…) with actual structure — never raw unstyled `<div>` placeholders |
| Representative mock content | Type realistic sample rows/cards/fields directly into the markup so the page looks populated |
| Four data states | Show the **data** state populated; also depict **loading** (skeleton bars), **empty** (illustration + call-to-action), and **error** (inline error banner + retry button) at least once across the preview so the user can validate them |
| Real icons | Inline SVG line icons (clean, consistent stroke width). No emoji, no remote icon fonts |
| Destructive actions | Show confirmation affordances (e.g. a confirm dialog mock) for delete/irreversible actions |

---

## Sub-step F4: Write the Files & Approval Loop

1. **Write the files** to `.azure/frontend-preview/`: the shared `styles.css`, `index.html`, and one `*.html` per page. Each HTML file must be valid standalone HTML that links `styles.css` with a relative `<link>`. Prefer authoring the page files **in parallel with subagents** (one page per subagent).
2. **The plan webview embeds them automatically.** When the plan is (re)opened, the plan webview detects `.azure/frontend-preview/index.html` and serves the folder as webview resources, rendering it inline in an iframe in the **UI Preview** card. Because the pages are real files, the user can **navigate between them** by clicking nav links. You do **not** open a browser, start a server, or run any command. There is no port and no `simpleBrowser.show`.
3. **Ask the user for approval** (use `ask_user`): _"Your frontend preview is embedded in the plan. Do you approve this UI, or would you like changes?"_
4. **If the user requests changes** → edit the relevant file(s) under `.azure/frontend-preview/` in place and re-ask. The webview watches the folder and re-loads the preview on each change, so the user sees the new version after you rewrite the file(s). Loop until approved.
5. **If the user approves** → the static preview is now the **visual spec** the scaffold agent will reproduce as a real framework frontend. Record approval in the plan.

> **Why no browser / no server:** the preview is embedded directly in the plan webview. The old "open localhost in the Simple Browser" workflow is gone — it was slow, depended on a dev server in the right working directory, and opened an external tab. Static files served in-panel are instant and can't break on a wrong `cwd`.
>
> **Parallelism:** author the per-page files concurrently with subagents — the shell + `styles.css` from F2 give every subagent a shared contract, so the pages stay consistent while being written at the same time. Backend/contract work still derives from the plan's routes and entity types, independent of the preview.

---

## Frontend Quality Bar (preview baseline)

Even as a static approximation, the preview MUST meet these standards. The full per-library contract lives in [frontend-quality-bar.md](.github/agents/shared-references/frontend-quality-bar.md) — read it before authoring markup. Baseline rules:

- **Self-contained**: one file, inline CSS, no external network, no scripts required to look correct.
- **Theme from the brand color**: derive the palette from Section 6's `primary`, expressed as `:root` custom properties.
- **Render layout tokens as real structure** — never raw placeholder boxes. See [frontend-quality-bar.md](.github/agents/shared-references/frontend-quality-bar.md) for the region-token → visual-treatment mapping per library.
- **Emulate the target library's visual language** in inline CSS (corner radius, elevation, spacing, control shape) so the user previews something close to the final product.
- **Presentation-quality polish**: balanced whitespace, real depth (subtle shadows), consistent radius, clear typographic hierarchy, purely visual `:hover`/`:focus` *styling* on interactive-looking elements (no working behavior). It should look like a finished product screenshot, not a sketch.
- **Every image slot is filled** with a themed substitute (CSS gradient, inline SVG, or initials/icon block) — never an empty or unstyled placeholder box.
- **All four data states depicted** at least once: loading (skeleton), error (banner + retry), empty (illustration + CTA), data (populated). See the quality-bar's State Coverage Contract.
- **Authenticated view first** — the preview shows the signed-in app content, not a login page.
- **Real icon silhouettes** via inline SVG matching the chosen library's icon set. No emoji, no SVG placeholder rectangles, no remote icon fonts.

---

## Scaffold: Regenerate From Spec (Step 1)

The approved `.azure/frontend-preview/index.html` is a **visual specification**, not the shipped frontend. During scaffolding:

> 🚫 **No second UI approval.** The frontend design was already signed off during planning (the F4 approval loop). The scaffold phase **must not** ask the user to approve, confirm, or "sign off" the regenerated frontend. Opening it in the Simple Browser is **informational only** — show it and keep going. The only approval that ever gates the frontend is the planning-phase one; never re-open an approval gate here.

| Task | Details |
|------|---------|
| Read the spec | Open `.azure/frontend-preview/index.html` and the plan's Section 6. Treat the preview as the source of truth for layout, palette, typography, page set, and component look. |
| Build the real frontend | Initialize the **framework chosen in the plan** (React + Vite / Vue + Vite / Angular / Svelte) in `services/web/` with a proper `package.json`, real components, and the library's real primitives + theme provider. |
| Reproduce the approved look | Recreate each previewed page using the library's actual components, theming from the same brand color, matching the approved layout regions and the four data states. |
| Wire real data | Replace the preview's static mock markup with the real mock data layer / API client, then (at the wiring step) the real backend contracts. |
| Do NOT copy the preview | Never move or import `.azure/frontend-preview/index.html` into `services/web/`. It is a spec to reproduce, not code to reuse. |

> **Working directory (scaffold only):** once `services/web/` exists, every `npm install` / `npm run build` / framework command MUST run with `cwd` set to `services/web/` (the folder containing `package.json`). Running from the workspace root is the #1 cause of build failures. Pass `cwd` explicitly on every terminal call — do not rely on a previous `cd`.
