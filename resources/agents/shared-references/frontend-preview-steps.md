# Frontend Preview Steps

> **Who reads this:**
> - **`azure-project-plan` (Phase 2: Frontend Preview)** — during planning you generate a **single, self-contained static HTML preview** that is a **high-fidelity, presentation-quality mockup of the final UI** — visually pleasing and as close to the shipped product as a no-framework, no-script file can be. No framework, no build step, no dev server. Follow sub-steps **F1–F4** to author `.azure/frontend-preview/index.html` and let the plan webview embed it for approval. The approval loop in F4 is the user's UX sign-off.
> - **`azure-project-scaffold` (Step 1: Regenerate Frontend)** — the static preview is a **visual specification**, not shippable code. The scaffold agent builds the **real framework frontend** (React/Vue/Angular/Svelte per plan) in `src/web/`, reproducing the approved preview's layout, palette, typography, and component look using the chosen library's real primitives. It does NOT copy `.azure/frontend-preview/` into `src/web/`.
>
> Sub-steps F1–F4 below describe the planning case (authoring the static preview). The scaffold case reads the **Scaffold: Regenerate From Spec** section at the bottom.

> **Companion contract**: Before authoring the preview markup, also read [frontend-quality-bar.md](.github/agents/shared-references/frontend-quality-bar.md). It defines the load-bearing contract between the plan's Section 5 (Design System & UI) and what the preview must show — region-token coverage, theming from the brand color, real iconography, and the four-state gate. The sub-steps below cover *how* to produce the preview; the quality bar covers *what* it must contain.

---

## ⚠️ HARD CONSTRAINTS — READ BEFORE AUTHORING THE PREVIEW

The planning-phase preview is a **single static file**. It must render instantly inside the plan webview with zero tooling.

| ✅ Required | ❌ Forbidden |
|------------|-------------|
| One file: `.azure/frontend-preview/index.html` | Multiple files, a `src/`, a `package.json`, a bundler |
| All CSS **inline** in a `<style>` block in that file | External stylesheet links, `@import url(...)` |
| Plain HTML elements styled to look like the target library | React/Vue/Angular/Svelte components, JSX, SFCs |
| Self-contained — opens correctly with no network access | CDN `<script src="https://...">`, web-font CDN links, remote images |
| Inline SVG icons (paste the path data) | Icon-font CDNs, `lucide-react` / `@fluentui/react-icons` / any icon npm package, remote icon packs |
| Imagery via CSS gradients / inline SVG / themed color blocks | Remote `<img src="https://...">`, stock-photo URLs, base64 of real photos |
| Static mock content typed directly into the markup | Fetching data, JS frameworks, a dev server / `vite` / `npm` |

> **Fidelity target — presentation quality, not a wireframe.** Treat the preview as a **demo-ready mockup of the final product**: the screen a designer would show a stakeholder to sign off the look. It must be genuinely *visually pleasing* — balanced spacing, real depth (subtle shadows/elevation), consistent corner radius, a coherent themed palette, polished typography hierarchy, and realistic populated content. "Static" constrains *behavior*, never *visual fidelity*. A flat, gray, boxy result fails this bar even if it is technically self-contained.

> **Imagery without the network:** remote images are forbidden, so represent every image/avatar/thumbnail with a themed substitute — a CSS gradient panel, an inline SVG illustration, or a colored block with a centered initial/icon. Avatars = a themed circle with initials. Card media = a gradient or inline-SVG hero. Never leave an empty box where an image belongs; that reads as unfinished.

**Why these rules:** the preview is read from disk by the plan webview and injected into a sandboxed `<iframe srcdoc>` (no scripts, no remote network). A self-contained inline-CSS document is the only thing guaranteed to render. There is **no terminal, no build, and no localhost** in this workflow — if you find yourself running `npm install` or `vite`, you are doing the planning preview wrong.

A tiny amount of inline `<script>` is acceptable ONLY for cosmetic, no-network behavior (e.g. a tab toggle) — but it will NOT execute in the sandboxed iframe, so never rely on it for the preview to look correct. Treat the preview as static.

---

## Sub-step F1: Derive Design Tokens From the Plan

Read **Section 5 (Design System & UI)** of the plan and extract:

| Token | Source | Use in preview |
|-------|--------|----------------|
| Component library | Plan's chosen library (shadcn/ui, Vuetify, Material, Pico, etc.) | Drives the *look* you emulate in inline CSS |
| Palette | Section 5 color list (`primary`, `surface`, `text`, etc.) | CSS custom properties at `:root` |
| Typography | Section 5 font family / scale | `font-family`, heading/body sizes |
| Pages | Section 5 / route list | One section per page in the preview |
| Layout regions | Per-page region tokens (header, sidebar, content, etc.) | Real layout, not placeholder boxes |

Define every color and font as a CSS custom property at the top of the `<style>` block so the webview's palette/typography editors map cleanly onto them.

---

## Sub-step F2: Build the App Shell

| Task | Details |
|------|---------|
| Theme variables | `:root { --primary: ...; --surface: ...; --text: ...; --font: ...; }` derived from Section 5 |
| App chrome | Header/top bar + navigation (sidebar or nav rail) styled like the target library |
| Authenticated view | Render the **main authenticated content directly** — the preview is the signed-in app, NOT a login page |
| Library look | Match the target library's visual language: corner radius, elevation/shadows, spacing rhythm, button shape, control density |

---

## Sub-step F3: Build Each Page

| Task | Details |
|------|---------|
| One section per page | A clearly delineated block per major feature/route from the plan |
| Real layout regions | Reproduce each page's region tokens (header, toolbar, list, detail, cards…) with actual structure — never raw unstyled `<div>` placeholders |
| Representative mock content | Type realistic sample rows/cards/fields directly into the markup so the page looks populated |
| Four data states | Show the **data** state populated; also depict **loading** (skeleton bars), **empty** (illustration + call-to-action), and **error** (inline error banner + retry button) at least once across the preview so the user can validate them |
| Real icons | Inline SVG matching the target library's icon set silhouette (shadcn/ui = Lucide, Material = Material symbols, etc.). No emoji, no remote icon fonts |
| Destructive actions | Show confirmation affordances (e.g. a confirm dialog mock) for delete/irreversible actions |

---

## Sub-step F4: Write the File & Approval Loop

1. **Write the single file** to `.azure/frontend-preview/index.html`. It must be valid standalone HTML with all CSS inline. Do not create any sibling files.
2. **The plan webview embeds it automatically.** When the plan is (re)opened, the plan webview detects `.azure/frontend-preview/index.html` and renders it inline in a sandboxed iframe in the **UI Preview** card. You do **not** open a browser, start a server, or run any command. There is no port and no `simpleBrowser.show`.
3. **Ask the user for approval** (use `ask_user`): _"Your frontend preview is embedded in the plan. Do you approve this UI, or would you like changes?"_
4. **If the user requests changes** → edit `.azure/frontend-preview/index.html` in place and re-ask. The webview watches the file and re-injects the iframe on each change, so the user sees the new version after you rewrite the file. Loop until approved.
5. **If the user approves** → the static preview is now the **visual spec** the scaffold agent will reproduce as a real framework frontend. Record approval in the plan.

> **Why no browser / no server:** the preview is embedded directly in the plan webview. The old "open localhost in the Simple Browser" workflow is gone — it was slow, depended on a dev server in the right working directory, and opened an external tab. A static inline-CSS file rendered in-panel is instant and can't break on a wrong `cwd`.
>
> **Parallelism unchanged:** the preview is a *planning* artifact. Backend/contract work still derives from the plan's routes and entity types, independent of the preview.

---

## Frontend Quality Bar (preview baseline)

Even as a static approximation, the preview MUST meet these standards. The full per-library contract lives in [frontend-quality-bar.md](.github/agents/shared-references/frontend-quality-bar.md) — read it before authoring markup. Baseline rules:

- **Self-contained**: one file, inline CSS, no external network, no scripts required to look correct.
- **Theme from the brand color**: derive the palette from Section 5's `primary`, expressed as `:root` custom properties.
- **Render layout tokens as real structure** — never raw placeholder boxes. See [frontend-quality-bar.md](.github/agents/shared-references/frontend-quality-bar.md) for the region-token → visual-treatment mapping per library.
- **Emulate the target library's visual language** in inline CSS (corner radius, elevation, spacing, control shape) so the user previews something close to the final product.
- **Presentation-quality polish**: balanced whitespace, real depth (subtle shadows), consistent radius, clear typographic hierarchy, hover/focus affordances on interactive-looking elements. It should look like a finished product screenshot, not a sketch.
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
| Read the spec | Open `.azure/frontend-preview/index.html` and the plan's Section 5. Treat the preview as the source of truth for layout, palette, typography, page set, and component look. |
| Build the real frontend | Initialize the **framework chosen in the plan** (React + Vite / Vue + Vite / Angular / Svelte) in `src/web/` with a proper `package.json`, real components, and the library's real primitives + theme provider. |
| Reproduce the approved look | Recreate each previewed page using the library's actual components, theming from the same brand color, matching the approved layout regions and the four data states. |
| Wire real data | Replace the preview's static mock markup with the real mock data layer / API client, then (at the wiring step) the real backend contracts. |
| Do NOT copy the preview | Never move or import `.azure/frontend-preview/index.html` into `src/web/`. It is a spec to reproduce, not code to reuse. |

> **Working directory (scaffold only):** once `src/web/` exists, every `npm install` / `npm run build` / framework command MUST run with `cwd` set to `src/web/` (the folder containing `package.json`). Running from the workspace root is the #1 cause of build failures. Pass `cwd` explicitly on every terminal call — do not rely on a previous `cd`.
