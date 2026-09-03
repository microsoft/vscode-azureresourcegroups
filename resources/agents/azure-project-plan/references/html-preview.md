# HTML/CSS Preview — presentation-quality recipes

> **🎨 This preview is a PRESENTATION-QUALITY visual spec — the screen a designer would show a stakeholder to sign off the look.**
>
> It is the **raw-HTML/CSS rendering** of the shared design-quality contract in [`frontend-quality-bar.md`](.github/agents/shared-references/frontend-quality-bar.md) → "Shared design-quality principles". Read that section first: the preview and the eventual scaffolded app must look like the **same professional product** at two fidelities. This is not a wireframe — a flat, gray, boxy result fails the bar even if it is technically correct.
>
> It must confirm, at a polished bar:
>
> 1. **What's on each page** — real regions with real, populated content, in the right order.
> 2. **The themed look** — brand palette applied through surfaces, badges, buttons, and a real hero; multi-tier elevation; consistent radius; clear type hierarchy.
> 3. **All four data states** — `data`, `loading` (skeleton), `empty` (icon + CTA), `error` (banner + retry), depicted at least once across the page set.
>
> **What this raw-static preview intentionally leaves to the scaffold** (raw-static limits, not a license to look unpolished): real webfonts (use system fonts), JavaScript (no working toggles — states are depicted statically), and real photos (use neutral placeholder blocks — a subtle surface + border with a muted icon or initials, **not** a brand-color gradient). Everything else — real inline-SVG icons, elevation, hover/focus styling, skeleton shimmer — the preview DOES do, and must.
>
> **Polish is about *treatment*; content is about *the plan*.** Every `{...}` placeholder token in the recipes below MUST be replaced with the **real, domain-specific Sample Content** handed to you in your prompt (the page's records from the plan's Section 6 Sample Content block). Render the *same* entities, names, numbers, and states the scaffolded app will show — the preview is a faithful view of the real app, not a generic stand-in. **Never** emit generic filler like "Item 1", "Recent items", "Trending", "Card title", or lorem ipsum. **Never** add a banner or note claiming the app "will use" a different framework or component library — render the content directly with no such disclaimer.
>
> **Audience:** the planner sub-agents that fan out from Step 3.5b. Each sub-agent owns one page and writes a single self-contained HTML file linking to the shared `./theme.css`. **No `<script>` tags** — the preview iframe is sandboxed without scripts. **No inline `<style>`** — all styling MUST come from `./theme.css`. Aim high: the scaffold reproduces this look with real primitives, so make it worth reproducing.
>
> **Output shape:** every page file is `<!DOCTYPE html>` + `<head>` (charset + title + single `<link rel="stylesheet" href="./theme.css">`) + `<body>` containing the per-region markup below, in the order from the plan's Section 6 Pages table.

---

## Shared CSS (paste into `theme.css`)

The planner's Step 3.5a writes `:root { ... }` with palette + typography tokens **plus base body styles**. Append everything below to the same `theme.css` so the per-region HTML renders at a **presentation-quality** bar — multi-tier elevation, tasteful CSS-only transitions on hover/focus, real inline-SVG icon sizing, skeleton-shimmer loading, and polished empty/error states. All motion is pure CSS (the iframe has no JavaScript); it stays subtle and respects `prefers-reduced-motion`. Keep every class name exactly as defined so the per-page HTML and the parent webview's palette editors line up.

```css
/* ───── Layout primitives ───── */
.preview-root {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
}

.preview-shell {
    display: flex;
    flex: 1;
    min-height: 0;
}

.preview-main {
    flex: 1;
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-width: 0;
}

.preview-split {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: var(--space-5);
}

.preview-two-column {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-5);
}

/* ───── Header (raised surface, subtle elevation, sticky) ───── */
.preview-header {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-6);
    background: var(--color-surface-raised, var(--color-surface));
    border-bottom: 1px solid var(--color-border);
    box-shadow: var(--shadow-sm);
}
.preview-header__brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-weight: 700;
    font-size: var(--text-base);
    color: var(--color-text);
}
.preview-header__logo {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    background: var(--color-primary);
    display: grid;
    place-items: center;
    color: var(--color-on-primary);
    font-weight: 700;
    font-size: 0.85em;
}
.preview-header__actions {
    display: flex;
    gap: var(--space-3);
    align-items: center;
}
.preview-header__action {
    color: var(--color-muted);
    text-decoration: none;
    font-size: var(--text-sm);
}

/* ───── Nav (horizontal, flat) ───── */
.preview-nav {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-6);
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
}
.preview-nav__link {
    color: var(--color-muted);
    text-decoration: none;
    font-size: var(--text-sm);
    font-weight: 500;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
}
.preview-nav__link--active {
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    font-weight: 600;
}

/* ───── Sidebar (flat surface, no gradient) ───── */
.preview-sidebar {
    width: 220px;
    flex-shrink: 0;
    padding: var(--space-4) var(--space-3);
    background: var(--color-surface-sunken, var(--color-surface));
    border-right: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.preview-sidebar__section {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: var(--text-xs);
    color: var(--color-muted);
    font-weight: 600;
    padding: var(--space-3) var(--space-2) var(--space-1);
}
.preview-sidebar__item {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    text-decoration: none;
    font-size: var(--text-sm);
    opacity: 0.78;
}
.preview-sidebar__item--active {
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
    font-weight: 600;
    opacity: 1;
}

/* ───── Hero (one gradient — keeps the brand story visible) ───── */
.preview-hero {
    padding: var(--space-6);
    border-radius: var(--radius-md);
    background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
    color: var(--color-on-primary);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.preview-hero__eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: var(--text-xs);
    font-weight: 700;
    opacity: 0.85;
}
.preview-hero__title {
    font-size: var(--text-2xl);
    font-weight: 700;
    line-height: 1.15;
    max-width: 28ch;
}
.preview-hero__subtitle {
    font-size: var(--text-base);
    max-width: 60ch;
    opacity: 0.9;
    line-height: 1.5;
}
.preview-hero__actions {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-2);
    flex-wrap: wrap;
}

/* ───── KPI tiles (still useful — communicates "this is a dashboard") ───── */
.preview-kpi-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--space-3);
}
.preview-kpi {
    background: var(--color-surface-raised, var(--color-surface));
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.preview-kpi__label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-muted);
    font-weight: 600;
}
.preview-kpi__value {
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--color-text);
    line-height: 1.1;
}
.preview-kpi__delta {
    font-size: var(--text-xs);
    color: var(--color-muted);
}

/* ───── Section title (in-page heading row) ───── */
.preview-section-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-2);
}
.preview-section-title__h {
    font-size: var(--text-lg);
    font-weight: 700;
}
.preview-section-title__hint {
    font-size: var(--text-xs);
    color: var(--color-muted);
}

/* ───── Cards (list + grid) — elevated, gentle hover lift ───── */
.preview-card-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.preview-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-4);
}
.preview-card {
    background: var(--color-surface-raised, var(--color-surface));
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    box-shadow: var(--shadow-sm);
    transition: box-shadow 160ms ease, transform 160ms ease, border-color 160ms ease;
}
.preview-card:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
}
@media (prefers-reduced-motion: reduce) {
    .preview-card { transition: none; }
    .preview-card:hover { transform: none; }
}
.preview-card__title {
    font-size: var(--text-base);
    font-weight: 600;
    margin: 0;
}
.preview-card__body {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-muted);
    line-height: 1.5;
}
.preview-card__meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-muted);
}
.preview-card__media {
    height: 128px;
    border-radius: var(--radius-sm);
    background: var(--color-surface-sunken, var(--color-surface));
    border: 1px solid var(--color-border);
    margin-bottom: var(--space-1);
    display: grid;
    place-items: center;
    color: color-mix(in srgb, var(--color-text) 32%, transparent);
    overflow: hidden;
}

/* ───── Status pills / badges ───── */
.preview-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px var(--space-2);
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.4;
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
}
.preview-badge--success { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
.preview-badge--warning { background: color-mix(in srgb, var(--color-warning) 14%, transparent); color: var(--color-warning); }
.preview-badge--danger  { background: color-mix(in srgb, var(--color-danger)  14%, transparent); color: var(--color-danger); }
.preview-badge--neutral { background: color-mix(in srgb, var(--color-text)    8%,  transparent); color: var(--color-muted); }
.preview-badge__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
}

/* ───── Form (raised surface, clear focus ring) ───── */
.preview-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    background: var(--color-surface-raised, var(--color-surface));
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    box-shadow: var(--shadow-sm);
}
.preview-form__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.preview-form__label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text);
}
.preview-form__hint {
    font-size: var(--text-xs);
    color: var(--color-muted);
}
.preview-form__input,
.preview-form__textarea,
.preview-form__select {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font: inherit;
    background: var(--color-surface);
    color: var(--color-text);
    transition: border-color 140ms ease, box-shadow 140ms ease;
}
.preview-form__input:focus,
.preview-form__textarea:focus,
.preview-form__select:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 22%, transparent);
}
.preview-form__field--error .preview-form__input,
.preview-form__field--error .preview-form__textarea {
    border-color: var(--color-danger);
}
.preview-form__error {
    font-size: var(--text-xs);
    color: var(--color-danger);
    font-weight: 600;
}
.preview-form__textarea {
    min-height: 96px;
    resize: vertical;
}
.preview-form__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding-top: var(--space-2);
}

/* ───── Buttons (themed, subtle depth + hover/focus) ───── */
.preview-btn {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    font: inherit;
    font-weight: 600;
    font-size: var(--text-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    line-height: 1.2;
    transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease, border-color 120ms ease;
}
.preview-btn:hover { transform: translateY(-1px); }
.preview-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 30%, transparent);
}
@media (prefers-reduced-motion: reduce) {
    .preview-btn { transition: none; }
    .preview-btn:hover { transform: none; }
}
.preview-btn--primary {
    background: var(--color-primary);
    color: var(--color-on-primary);
    box-shadow: var(--shadow-sm);
}
.preview-btn--primary:hover {
    background: color-mix(in srgb, var(--color-primary) 88%, #000);
    box-shadow: var(--shadow-md);
}
.preview-btn--secondary {
    background: var(--color-surface);
    color: var(--color-text);
    border-color: var(--color-border);
}
.preview-btn--secondary:hover {
    border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
}
.preview-btn--ghost {
    background: transparent;
    color: var(--color-text);
}
.preview-btn--ghost:hover {
    background: color-mix(in srgb, var(--color-text) 6%, transparent);
}

/* ───── Table (flat container) ───── */
.preview-table-wrap {
    background: var(--color-surface-raised, var(--color-surface));
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
}
.preview-table {
    width: 100%;
    border-collapse: collapse;
}
.preview-table th,
.preview-table td {
    text-align: left;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-bottom: 1px solid var(--color-border);
}
.preview-table th {
    background: var(--color-surface-sunken, var(--color-surface));
    font-weight: 600;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-muted);
}
.preview-table tr:last-child td { border-bottom: none; }

/* ───── Action bar ───── */
.preview-action-bar {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--color-border);
}

/* ───── Tabs ───── */
.preview-tabs {
    display: flex;
    gap: var(--space-1);
    border-bottom: 1px solid var(--color-border);
}
.preview-tabs__tab {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
}
.preview-tabs__tab--active {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
    font-weight: 600;
}

/* ───── Empty state (soft surface + centered icon) ───── */
.preview-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-7) var(--space-4);
    text-align: center;
    background: var(--color-surface-raised, var(--color-surface));
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    gap: var(--space-3);
    box-shadow: var(--shadow-sm);
}
.preview-empty__icon {
    width: 64px;
    height: 64px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
}
.preview-empty__icon svg { width: 32px; height: 32px; }
.preview-empty__title { font-size: var(--text-base); font-weight: 700; }
.preview-empty__body { color: var(--color-muted); max-width: 40ch; font-size: var(--text-sm); }

/* ───── Modal (flat — preview only, no backdrop overlay) ───── */
.preview-modal {
    max-width: 480px;
    background: var(--color-surface-raised, var(--color-surface));
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.preview-modal__title { font-size: var(--text-lg); font-weight: 700; margin: 0; }
.preview-modal__body { color: var(--color-muted); font-size: var(--text-sm); margin: 0; }

/* ───── Footer ───── */
.preview-footer {
    padding: var(--space-3) var(--space-6);
    border-top: 1px solid var(--color-border);
    color: var(--color-muted);
    font-size: var(--text-xs);
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
}

/* ───── Inline-SVG icons (sizing only — stroke is set on the SVG) ───── */
.preview-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    display: inline-block;
    vertical-align: middle;
    stroke: currentColor;
    fill: none;
}
.preview-icon--sm { width: 14px; height: 14px; }
.preview-icon--lg { width: 24px; height: 24px; }

/* ───── Avatar / initials substitute for a person or entity photo ───── */
.preview-avatar {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-pill);
    display: grid;
    place-items: center;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    flex-shrink: 0;
}

/* ───── KPI delta trend colors ───── */
.preview-kpi__delta--up   { color: var(--color-success); font-weight: 600; }
.preview-kpi__delta--down { color: var(--color-danger);  font-weight: 600; }

/* ───── Skeleton loading (pure-CSS shimmer, no JS) ───── */
.preview-skeleton {
    background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--color-text) 8%, var(--color-surface)) 25%,
        color-mix(in srgb, var(--color-text) 14%, var(--color-surface)) 37%,
        color-mix(in srgb, var(--color-text) 8%, var(--color-surface)) 63%
    );
    background-size: 400% 100%;
    border-radius: var(--radius-sm);
    animation: preview-shimmer 1.4s ease infinite;
}
.preview-skeleton--line { height: 12px; margin-bottom: var(--space-2); }
.preview-skeleton--title { height: 18px; width: 40%; margin-bottom: var(--space-3); }
.preview-skeleton--block { height: 96px; }
@keyframes preview-shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: 0 0; }
}
@media (prefers-reduced-motion: reduce) {
    .preview-skeleton { animation: none; }
}

/* ───── Error banner (inline alert + retry) ───── */
.preview-error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-danger) 8%, var(--color-surface));
    border: 1px solid color-mix(in srgb, var(--color-danger) 30%, var(--color-border));
    color: var(--color-text);
}
.preview-error__icon { color: var(--color-danger); }
.preview-error__body { display: flex; flex-direction: column; gap: var(--space-1); }
.preview-error__title { font-weight: 700; font-size: var(--text-sm); }
.preview-error__text { font-size: var(--text-sm); color: var(--color-muted); }

/* ───── Hero ambient mesh backdrop (layered behind the gradient) ───── */
.preview-hero { position: relative; overflow: hidden; }
.preview-hero__mesh {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.7;
    background:
        radial-gradient(60% 80% at 0% 0%, color-mix(in srgb, var(--color-on-primary) 30%, transparent), transparent 70%),
        radial-gradient(60% 80% at 100% 100%, color-mix(in srgb, var(--color-accent) 50%, transparent), transparent 70%);
}
.preview-hero > *:not(.preview-hero__mesh) { position: relative; z-index: 1; }
```

---

## Token → HTML recipes

For each layout token in the plan's Pages table, copy the corresponding snippet into the page's `<body>`. Tokens are **layout intent**, not literal element names.

> **Every human-readable label and every count in these snippets is an illustrative placeholder — adapt it to the app, never ship it verbatim.** Source the replacements from the plan:
> - **Nav / sidebar labels** → the page names from Section 6's Pages table (link to the app's actual pages, not "Overview / Library / Settings").
> - **Table headers, form field labels, KPI labels** → the real fields of the page's primary entity.
> - **Rows, cards, values, badge states** → the page's records from Section 6's **Sample Content** block, using the entity's real status values.
> - **Counts & sizing** → render as many KPI tiles, grid columns, table rows, list cards, tabs, and form fields as the plan's data actually calls for — the `repeat(4, …)` / `repeat(3, …)` and the three-row stubs below are **defaults, not quotas**. A 2-KPI dashboard renders two tiles; a 6-field form renders six fields. See *Adapting sizing to the domain* below.
>
> The literal strings left in the snippets (e.g. `Active`, `Owner`, `2 min ago`) only show the *shape*. A preview that still reads "Overview / Library / Settings" or "Jane Doe" has not been wired to the plan — that's the bug this contract exists to prevent. Only the **CSS / design tokens** (spacing scale, radii, the `theme.css` classes) stay fixed; all visible text and all counts are plan-driven.

> **State coverage (across the page set, not every page).** The scaffolded app ships all four data states; the preview must **depict** them so the user can sign them off. Across the whole preview set, show the `data` state everywhere, and depict `loading` (the `loading (skeleton)` recipe), `empty` (the `empty` recipe with an icon), and `error` (the `error (inline banner)` recipe) **at least once each** — e.g. one list page rendered as a skeleton, one tab as an empty state, one panel as an error banner. Pick natural spots; do not stack all three on one page.

## Icons (inline SVG)

Every nav item, sidebar item, KPI tile, section-title row, empty state, error banner, and primary CTA carries a **real inline `<svg>` icon** — never emoji, never a Unicode glyph, never a remote icon font. Paste the path data directly. Use a consistent 24×24 `viewBox`, `stroke="currentColor"`, `fill="none"`, `stroke-width="2"`, and round caps/joins so every icon matches. Add `class="preview-icon"` (or `--sm` / `--lg`) for sizing; the icon inherits the surrounding text color.

```html
<!-- home -->      <svg class="preview-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>
<!-- search -->    <svg class="preview-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
<!-- grid/dashboard --><svg class="preview-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
<!-- chart -->     <svg class="preview-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V4"/><path d="M4 20h16"/><path d="m7 15 3-4 3 2 4-6"/></svg>
<!-- user -->      <svg class="preview-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
<!-- settings -->  <svg class="preview-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.9 1.09V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 6 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9H4.5a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 6 4.6l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 12 3.3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.72 1.05"/></svg>
<!-- inbox -->     <svg class="preview-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13h4l2 3h4l2-3h4"/><path d="M5 6h14l1 7v5H4v-5Z"/></svg>
<!-- plus -->      <svg class="preview-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
<!-- bell -->      <svg class="preview-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>
<!-- alert -->     <svg class="preview-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v5"/><path d="M12 18h.01"/></svg>
```

> Need an icon not listed? Draw any simple 24×24 stroke glyph in the same style, or reuse the closest one above. The goal is a consistent, real icon in every slot — not a specific set.

### `header`
```html
<header class="preview-header">
    <div class="preview-header__brand">
        <span class="preview-header__logo">{1–2 letter initials of app name}</span>
        {App Name}
    </div>
    <div class="preview-header__actions">
        <a class="preview-header__action" href="#" aria-label="Search"><svg class="preview-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></a>
        <a class="preview-header__action" href="#" aria-label="Notifications"><svg class="preview-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/></svg></a>
        <span class="preview-avatar">{initials of the signed-in user}</span>
    </div>
</header>
```

> The header shows the **signed-in** app chrome (search, notifications, user avatar) — the preview is the authenticated app, never a login screen.

### `nav` (top horizontal nav)
```html
<nav class="preview-nav">
    <a class="preview-nav__link preview-nav__link--active" href="#"><svg class="preview-icon preview-icon--sm" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>{This page's name, from Pages table}</a>
    <a class="preview-nav__link" href="./{sibling-slug}.html"><svg class="preview-icon preview-icon--sm" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V4"/><path d="M4 20h16"/><path d="m7 15 3-4 3 2 4-6"/></svg>{Sibling page from Pages table}</a>
    <a class="preview-nav__link" href="./{sibling-slug}.html"><svg class="preview-icon preview-icon--sm" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.9 1.09V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 6 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9H4.5a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 6 4.6l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 12 3.3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.72 1.05"/></svg>{Sibling page from Pages table}</a>
</nav>
```

> One link per page in the Pages table — not a fixed three. Give each a matching icon from the `## Icons` set. The current page's link uses `href="#"` and gets `--active`; **every sibling link uses `href="./<sibling-slug>.html"`** (the page's kebab-cased slug) so the host wires it to that page's tab.

### `sidebar`
```html
<aside class="preview-sidebar">
    <div class="preview-sidebar__section">{Nav group label}</div>
    <a class="preview-sidebar__item preview-sidebar__item--active" href="#"><svg class="preview-icon preview-icon--sm" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>{This page's name}</a>
    <a class="preview-sidebar__item" href="./{sibling-slug}.html"><svg class="preview-icon preview-icon--sm" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13h4l2 3h4l2-3h4"/><path d="M5 6h14l1 7v5H4v-5Z"/></svg>{Sibling page from Pages table}</a>
    <a class="preview-sidebar__item" href="./{sibling-slug}.html"><svg class="preview-icon preview-icon--sm" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V4"/><path d="M4 20h16"/><path d="m7 15 3-4 3 2 4-6"/></svg>{Sibling page from Pages table}</a>
    <div class="preview-sidebar__section">{Nav group label}</div>
    <a class="preview-sidebar__item" href="./{sibling-slug}.html"><svg class="preview-icon preview-icon--sm" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.9 1.09V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 6 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9H4.5a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 6 4.6l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 12 3.3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.72 1.05"/></svg>{Settings or account page}</a>
</aside>
```

> Group the app's real pages under however many section headers fit — a small app may need none. Give each item a matching icon from the `## Icons` set. The active item uses `href="#"`; **every other item uses `href="./<sibling-slug>.html"`** so the host wires it to that page's tab. Drop the second group if there's nothing to put in it.

### `hero`
```html
<section class="preview-hero">
    <span class="preview-hero__mesh" aria-hidden="true"></span>
    <span class="preview-hero__eyebrow">{Eyebrow — e.g. "What's new" or "Featured"}</span>
    <h1 class="preview-hero__title">{Page headline derived from purpose}</h1>
    <p class="preview-hero__subtitle">{1–2 sentences from page purpose}</p>
    <div class="preview-hero__actions">
        <button class="preview-btn preview-btn--primary" type="button"><svg class="preview-icon preview-icon--sm" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>{Primary CTA — name the action}</button>
        <button class="preview-btn preview-btn--ghost" type="button" style="color: var(--color-on-primary);">{Secondary CTA}</button>
    </div>
</section>
```

> The `<span class="preview-hero__mesh">` is a pure-CSS ambient backdrop layered behind the hero content (the `.preview-hero > *` rule lifts the text above it). The `style="color: var(--color-on-primary);"` on the ghost button is an intentional inline-style exception (alongside `modal`) — the ghost variant inherits `--color-text` (dark), illegible on the gradient hero. Primary CTAs **name the action** (`Create project`, not `Submit`).

### `kpi-row` (metric tiles, ideal for dashboards)
```html
<div class="preview-kpi-row">
    <div class="preview-kpi">
        <span class="preview-kpi__label">{Metric label}</span>
        <span class="preview-kpi__value">{Value, e.g. 12.4k}</span>
        <span class="preview-kpi__delta preview-kpi__delta--up">▲ {8.2%} vs last week</span>
    </div>
    <div class="preview-kpi">
        <span class="preview-kpi__label">{Metric label}</span>
        <span class="preview-kpi__value">{Value}</span>
        <span class="preview-kpi__delta preview-kpi__delta--down">▼ {1.4%} vs last week</span>
    </div>
    <!-- One tile per metric the dashboard actually tracks (typically 2–4). -->
</div>
```

> Render **one tile per real metric** from the plan, not a fixed four. The `.preview-kpi-row` grid auto-flows, so 2 or 3 tiles lay out cleanly too. Use `--up` (green) / `--down` (red) on the delta to match the real trend; drop the `__delta` line for metrics with no trend.


### `section-title` (in-page heading row with hint)
```html
<div class="preview-section-title">
    <h2 class="preview-section-title__h">{Section heading}</h2>
    <span class="preview-section-title__hint">{Short hint or count, e.g. "24 items"}</span>
</div>
```

### `main` (generic content block)
```html
<section class="preview-main">
    <!-- Place the remaining region snippets inside here when "main" is the wrapper. -->
</section>
```

### `list` / `card-list` (with status badge + meta)
```html
<div class="preview-card-list">
    <article class="preview-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3);">
            <h3 class="preview-card__title">{Record name from Sample Content}</h3>
            <span class="preview-badge preview-badge--success"><span class="preview-badge__dot"></span>{State}</span>
        </div>
        <p class="preview-card__body">{One-line description.}</p>
        <div class="preview-card__meta">
            <span>{Meta field}</span><span>·</span><span>{Meta field}</span>
        </div>
    </article>
    <article class="preview-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3);">
            <h3 class="preview-card__title">{Record name from Sample Content}</h3>
            <span class="preview-badge preview-badge--warning"><span class="preview-badge__dot"></span>{State}</span>
        </div>
        <p class="preview-card__body">{One-line description.}</p>
        <div class="preview-card__meta">
            <span>{Meta field}</span><span>·</span><span>{Meta field}</span>
        </div>
    </article>
    <article class="preview-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3);">
            <h3 class="preview-card__title">{Record name from Sample Content}</h3>
            <span class="preview-badge preview-badge--neutral">{State}</span>
        </div>
        <p class="preview-card__body">{One-line description.}</p>
        <div class="preview-card__meta">
            <span>{Meta field}</span><span>·</span><span>{Meta field}</span>
        </div>
    </article>
</div>
```

> Render **one card per record** in this page's Sample Content (not a fixed three). Pick the badge variant (`--success` / `--warning` / `--danger` / `--neutral`) whose color fits each record's real state, and replace `{State}` with the entity's actual status word — never the literal "Active / Pending / Draft".

### `grid` (responsive card grid)
```html
<div class="preview-card-grid">
    <article class="preview-card">
        <div class="preview-card__media">
            <svg class="preview-icon preview-icon--lg" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="m3 15 5-4 4 3 4-5 5 4"/><circle cx="9" cy="9" r="1.4"/></svg>
        </div>
        <h3 class="preview-card__title">{Record name from Sample Content}</h3>
        <p class="preview-card__body">{Description.}</p>
    </article>
    <!-- One card per record in this page's Sample Content. -->
</div>
```

> Render **one card per record**, not a fixed three. The grid auto-fills columns, so any count reflows cleanly. The `.preview-card__media` block is a **neutral placeholder** standing in for the record's image — a subtle surface tint with a border; drop a representative inline-SVG icon (or the entity's initials) inside it. Keep it neutral (surface + border), **not** a brand-color gradient, so it reads as "a photo goes here" rather than a colored panel that shifts every time the palette changes. Never leave it empty.


### `form`
```html
<form class="preview-form">
    <div class="preview-form__field">
        <label class="preview-form__label" for="preview-f1">{Field label}</label>
        <input class="preview-form__input" id="preview-f1" type="text" placeholder="{example value}">
    </div>
    <div class="preview-form__field">
        <label class="preview-form__label" for="preview-f2">{Field label}</label>
        <input class="preview-form__input" id="preview-f2" type="text" placeholder="{example value}">
        <span class="preview-form__hint">{Optional helper text.}</span>
    </div>
    <div class="preview-form__field">
        <label class="preview-form__label" for="preview-f3">{Field label}</label>
        <textarea class="preview-form__textarea" id="preview-f3" placeholder="{example value}"></textarea>
    </div>
    <div class="preview-form__actions">
        <button class="preview-btn preview-btn--secondary" type="button">Cancel</button>
        <button class="preview-btn preview-btn--primary" type="submit">{Submit label}</button>
    </div>
</form>
```

> Render **one field per real field** of this form's entity (from Section 6) — not a fixed three. Use input types that fit (`text`, `email`, `number`, `date`, `select`, `textarea`). Keep `Cancel`; tailor the submit label to the action (e.g. "Save", "Create", "Send").

### `table`
```html
<div class="preview-table-wrap">
    <table class="preview-table">
        <thead>
            <tr><th>{Field 1}</th><th>{Field 2}</th><th>{Field 3}</th><th>{Field 4}</th></tr>
        </thead>
        <tbody>
            <tr>
                <td>{record 1 value}</td>
                <td>{value}</td>
                <td><span class="preview-badge preview-badge--success"><span class="preview-badge__dot"></span>{State}</span></td>
                <td>{value}</td>
            </tr>
            <tr>
                <td>{record 2 value}</td>
                <td>{value}</td>
                <td><span class="preview-badge preview-badge--warning"><span class="preview-badge__dot"></span>{State}</span></td>
                <td>{value}</td>
            </tr>
            <tr>
                <td>{record 3 value}</td>
                <td>{value}</td>
                <td><span class="preview-badge preview-badge--neutral">{State}</span></td>
                <td>{value}</td>
            </tr>
        </tbody>
    </table>
</div>
```

> Columns are the primary entity's real fields (as many as the entity has — not a fixed four); rows are the page's records from Section 6's Sample Content (one `<tr>` per record).

### `actions` / `action-bar`
```html
<div class="preview-action-bar">
    <button class="preview-btn preview-btn--secondary" type="button">Discard</button>
    <button class="preview-btn preview-btn--primary" type="button">Continue</button>
</div>
```

### `tabs`
```html
<div class="preview-tabs">
    <div class="preview-tabs__tab preview-tabs__tab--active">{Tab 1}</div>
    <div class="preview-tabs__tab">{Tab 2}</div>
    <div class="preview-tabs__tab">{Tab 3}</div>
</div>
```

> Use the tab names the page's purpose implies — as many as it needs.

### `modal` (rendered inline as a preview — no overlay backdrop in the preview)
```html
<div class="preview-modal">
    <h3 class="preview-modal__title">{Confirm action}</h3>
    <p class="preview-modal__body">
        {Body copy — describe what the dialog confirms or asks. The real app will mount this above an overlay.}
    </p>
    <div class="preview-form__actions">
        <button class="preview-btn preview-btn--secondary" type="button">Cancel</button>
        <button class="preview-btn preview-btn--primary" type="button">Confirm</button>
    </div>
</div>
```

### `empty` (empty-state panel — use for tabs with no items)
```html
<div class="preview-empty">
    <span class="preview-empty__icon"><svg class="preview-icon" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13h4l2 3h4l2-3h4"/><path d="M5 6h14l1 7v5H4v-5Z"/></svg></span>
    <h3 class="preview-empty__title">{No items yet}</h3>
    <p class="preview-empty__body">{1–2 lines explaining how to add the first item.}</p>
    <button class="preview-btn preview-btn--primary" type="button"><svg class="preview-icon preview-icon--sm" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>{Primary action — name it}</button>
</div>
```

> Depict this on at least one page/tab so the user can sign off the empty state. Swap the icon for one that fits the entity.

### `loading (skeleton)`
```html
<div class="preview-card-list" aria-busy="true" aria-label="Loading">
    <article class="preview-card">
        <div class="preview-skeleton preview-skeleton--title"></div>
        <div class="preview-skeleton preview-skeleton--line"></div>
        <div class="preview-skeleton preview-skeleton--line" style="width: 70%;"></div>
    </article>
    <article class="preview-card">
        <div class="preview-skeleton preview-skeleton--title"></div>
        <div class="preview-skeleton preview-skeleton--line"></div>
        <div class="preview-skeleton preview-skeleton--line" style="width: 55%;"></div>
    </article>
</div>
```

> Depict the **loading** state once across the page set — e.g. render one list/grid region as skeleton cards instead of data. The shimmer is pure CSS (`preview-shimmer` keyframes); the inline `width` on the last line is a permitted layout shim. For a `grid`, use `<div class="preview-skeleton preview-skeleton--block"></div>` in place of `.preview-card__media`.

### `error (inline banner)`
```html
<div class="preview-error" role="alert">
    <span class="preview-error__icon"><svg class="preview-icon" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v5"/><path d="M12 18h.01"/></svg></span>
    <div class="preview-error__body">
        <span class="preview-error__title">{Couldn't load {entity} — short, specific}</span>
        <span class="preview-error__text">{One line on what failed and what retry does.}</span>
    </div>
    <button class="preview-btn preview-btn--secondary" type="button" style="margin-left: auto;">Retry</button>
</div>
```

> Depict the **error** state once across the page set — place this banner above (or in place of) a data region. The `margin-left: auto` is a permitted layout shim to push Retry to the end.

### `footer`
```html
<footer class="preview-footer">
    <span>© {App Name}</span>
    <span>v0.1.0 · preview</span>
</footer>
```

### Compound: `split(a|b)` (1:2 columns)
```html
<div class="preview-split">
    <div>{snippet for a}</div>
    <div>{snippet for b}</div>
</div>
```

### Compound: `two-column(a+b)` (1:1 columns)
```html
<div class="preview-two-column">
    <div>{snippet for a}</div>
    <div>{snippet for b}</div>
</div>
```

---

## Adapting sizing to the domain

The snippets above show a *shape*; the **counts and proportions** must follow the plan's actual data, or every preview collapses back into the same generic four-tile / three-card layout. Match these to the domain:

| Knob | Default in the snippets | Adapt it to… |
|------|------------------------|--------------|
| **KPI tiles** | 4 | One per metric the dashboard tracks (a 2-metric app shows 2). The row auto-fits. |
| **Grid / list cards** | 3 | One per record in this page's Sample Content. The grid auto-fills columns. |
| **Table rows** | 3 | One `<tr>` per Sample Content record; columns = the entity's real fields. |
| **Form fields** | 3 | One per real field of the entity (a sign-up form may have 6, a search box 1). |
| **Nav / sidebar links** | 3 | One per page in Section 6's Pages table. |
| **Tabs** | 3 | As many as the page's purpose implies. |
| **Content density** | medium | A list-heavy admin tool packs rows tight; a marketing landing page leans hero + few cards. Let Section 6's Style Direction steer this. |

These are the **only** things that should vary per page. The **design tokens** (`--space-*` scale, `--radius-*`, `--text-*`, the `.preview-*` class definitions) stay fixed — they are the shared contract the parent webview's palette/typography editors key off. Customize *what* and *how many*, never the spacing scale or class CSS.

---

## Wrapping a full page

Wrap the page body in `<div class="preview-root">` so the header → shell → footer flow lays out vertically. When the page uses a `sidebar`, wrap `<aside>` + `<main>` in `<div class="preview-shell">`:

```html
<body>
    <div class="preview-root">
        <header class="preview-header"> … </header>
        <nav class="preview-nav"> … </nav>
        <div class="preview-shell">
            <aside class="preview-sidebar"> … </aside>
            <section class="preview-main">
                <!-- hero / grid / form / etc. snippets here -->
            </section>
        </div>
        <footer class="preview-footer"> … </footer>
    </div>
</body>
```

Pages without a sidebar can put `<section class="preview-main">` directly inside `.preview-root`.

> **Only emit the regions this page's Layout actually lists.** The wrapper above shows the full nesting *order*, not a required set — drop any region the page's Section 6 Layout column doesn't name (no `sidebar` token → no `<aside>`; no `hero` token → no hero block; a bare `form` page is just `header + form`). Never add chrome a page didn't ask for to make it look fuller.

---

## Hard rules — read before writing any HTML

1. **One `<link rel="stylesheet" href="./theme.css">` only.** The `ScaffoldPlanViewController` rewrites this exact tag into an inline `<style>` block so the iframe is self-contained. Any other stylesheet reference is dropped.
2. **No `<script>` tags, no inline `on*=` handlers.** Author JavaScript is stripped before the preview renders — the only script that runs is the host's trusted navigation bridge. Do not rely on any JS behavior. **Cross-page navigation DOES work:** a nav/sidebar link with `href="./<sibling-slug>.html"` is turned into a tab switch by the host, so the preview navigates between pages. Every other control (buttons, inputs, tabs, toggles) is visual only.
3. **No external assets.** No `<img src="https://…">`, no Google Fonts `<link>`, no Font Awesome CDN. Represent imagery with neutral placeholder blocks (surface + border with a muted icon or initials) — never a remote URL, never a brand-color gradient fill (it overstates the palette's impact), and never an empty tinted box. Icons are **inline `<svg>`** (see the `## Icons` recipe), never emoji or remote icon fonts.
4. **Inline `style="…"` is allowed only for the small layout shims shown in the recipes above** (flex row wrappers, the hero ghost-button text color, skeleton-line widths, the error-banner Retry `margin-left`). All semantic styling — fonts, palette colors, shadows, spacing scale, elevation, radius — MUST come from `theme.css` so the live palette swatches in the parent webview meaningfully describe what's rendered. Never invent new inline styles to recolor or restyle components.
5. **File size sanity:** each page HTML should be **< 24 KB**. The richer recipes (KPI rows, status badges, full headers, inline-SVG icons, skeleton/error states) raise the floor; if you're past 24 KB you're inventing content the plan didn't call for.
6. **Never open these files in a browser or editor tab.** Each `.azure/.preview-temp/*.html` page is consumed *only* by the plan webview's **UI Preview** card, which renders it in a sandboxed iframe. Do not preview it with `simpleBrowser.show`, `vscode.env.openExternal`, a dev/web server, or by opening the `.html` in an editor/preview tab — there is no port or URL, and these files are deleted by the scaffold step.
