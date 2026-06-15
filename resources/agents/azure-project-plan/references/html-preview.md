# HTML/CSS Preview — directional sketch recipes

> **🎨 This preview is a DIRECTIONAL SKETCH, not production UI.**
>
> It exists to confirm three things with the user during planning, and **only** these three:
>
> 1. **What's on each page** — the regions, in roughly the right order.
> 2. **The brand color story** — primary/accent ramp and how surfaces feel.
> 3. **Content density** — list-heavy vs. card-grid vs. hero-led.
>
> Things the preview deliberately **does not** attempt: real icons, real fonts, animations, dark mode, polished hero treatments, illustration art, micro-interactions, or production typography hierarchy. Those are the scaffold's job — see [`frontend-quality-bar.md`](../../azure-project-scaffold/references/frontend-quality-bar.md) "Polish floor" — and the scaffolded app MUST visibly out-polish this sketch.
>
> **Low fidelity is about *polish*, never about *content*.** Every `{...}` placeholder token in the recipes below MUST be replaced with the **real, domain-specific Sample Content** handed to you in your prompt (the page's records from the plan's Section 5 Sample Content block). Render the *same* entities, names, numbers, and states the scaffolded app will show — the preview is a faithful low-fidelity view of the real app, not a generic stand-in. **Never** emit generic filler like "Item 1", "Recent items", "Trending", "Card title", or lorem ipsum. **Never** add a banner or note claiming the app "will use" a different framework or component library — render the content directly with no such disclaimer.
>
> **Audience:** the planner sub-agents that fan out from Step 3.5b. Each sub-agent owns one page and writes a single self-contained HTML file linking to the shared `./theme.css`. **No `<script>` tags** — the preview iframe is sandboxed without scripts. **No inline `<style>`** — all styling MUST come from `./theme.css`. Keep the visual ambition low; the scaffold will exceed it.
>
> **Output shape:** every page file is `<!DOCTYPE html>` + `<head>` (charset + title + single `<link rel="stylesheet" href="./theme.css">`) + `<body>` containing the per-region markup below, in the order from the plan's Section 5 Pages table.

---

## Shared CSS (paste into `theme.css`)

The planner's Step 3.5a writes `:root { ... }` with palette + typography tokens **plus base body styles**. Append everything below to the same `theme.css` so the per-region HTML below renders as a clean, calm sketch — single elevation tier, no animations, no gradients except the hero, no hover effects. The scaffold raises the visual ambition; this file deliberately does not.

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

/* ───── Header (flat, no blur, no sticky) ───── */
.preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-6);
    background: var(--color-surface-raised, var(--color-surface));
    border-bottom: 1px solid var(--color-border);
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
    grid-template-columns: repeat(4, minmax(0, 1fr));
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

/* ───── Cards (list + grid) — flat, no hover lift ───── */
.preview-card-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.preview-card-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
}
.preview-card {
    background: var(--color-surface-raised, var(--color-surface));
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
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
    height: 96px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-primary) 14%, var(--color-surface));
    margin-bottom: var(--space-1);
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

/* ───── Form (flat surface, no focus glow) ───── */
.preview-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    background: var(--color-surface-raised, var(--color-surface));
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
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

/* ───── Buttons (flat — no gradient, no shadow, no hover lift) ───── */
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
}
.preview-btn--primary {
    background: var(--color-primary);
    color: var(--color-on-primary);
}
.preview-btn--secondary {
    background: var(--color-surface);
    color: var(--color-text);
    border-color: var(--color-border);
}
.preview-btn--ghost {
    background: transparent;
    color: var(--color-text);
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

/* ───── Empty state (flat, dashed border, no illustration) ───── */
.preview-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-6) var(--space-4);
    text-align: center;
    background: var(--color-surface-raised, var(--color-surface));
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-md);
    gap: var(--space-2);
}
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
```

---

## Token → HTML recipes

For each layout token in the plan's Pages table, copy the corresponding snippet into the page's `<body>`. Tokens are **layout intent**, not literal element names — feel free to enrich text/labels with content derived from the page's `purpose` column.

### `header`
```html
<header class="preview-header">
    <div class="preview-header__brand">
        <span class="preview-header__logo">{1–2 letter initials of app name}</span>
        {App Name}
    </div>
    <div class="preview-header__actions">
        <a class="preview-header__action" href="#">Docs</a>
        <a class="preview-header__action" href="#">Help</a>
    </div>
</header>
```

### `nav` (top horizontal nav)
```html
<nav class="preview-nav">
    <a class="preview-nav__link preview-nav__link--active" href="#">Overview</a>
    <a class="preview-nav__link" href="#">Library</a>
    <a class="preview-nav__link" href="#">Settings</a>
</nav>
```

### `sidebar`
```html
<aside class="preview-sidebar">
    <div class="preview-sidebar__section">Workspace</div>
    <a class="preview-sidebar__item preview-sidebar__item--active" href="#">Home</a>
    <a class="preview-sidebar__item" href="#">Items</a>
    <a class="preview-sidebar__item" href="#">Reports</a>
    <div class="preview-sidebar__section">Account</div>
    <a class="preview-sidebar__item" href="#">Settings</a>
</aside>
```

### `hero`
```html
<section class="preview-hero">
    <span class="preview-hero__eyebrow">{Eyebrow — e.g. "What's new" or "Featured"}</span>
    <h1 class="preview-hero__title">{Page headline derived from purpose}</h1>
    <p class="preview-hero__subtitle">{1–2 sentences from page purpose}</p>
    <div class="preview-hero__actions">
        <button class="preview-btn preview-btn--primary" type="button">{Primary CTA}</button>
        <button class="preview-btn preview-btn--ghost" type="button" style="color: var(--color-on-primary);">{Secondary CTA}</button>
    </div>
</section>
```

> The `style="color: var(--color-on-primary);"` on the ghost button is the **one** intentional inline-style exception (alongside `modal`) — needed because the ghost variant inherits `--color-text` (dark) which is illegible on the gradient hero. The hero is the **only** place this preview uses a gradient; everywhere else is flat by design.

### `kpi-row` (4 tiles, ideal for dashboards)
```html
<div class="preview-kpi-row">
    <div class="preview-kpi">
        <span class="preview-kpi__label">{Metric label}</span>
        <span class="preview-kpi__value">{Value, e.g. 12.4k}</span>
        <span class="preview-kpi__delta">▲ 8.2%</span>
    </div>
    <div class="preview-kpi">
        <span class="preview-kpi__label">{Metric label}</span>
        <span class="preview-kpi__value">{Value}</span>
        <span class="preview-kpi__delta">▲ 2.1%</span>
    </div>
    <div class="preview-kpi">
        <span class="preview-kpi__label">{Metric label}</span>
        <span class="preview-kpi__value">{Value}</span>
        <span class="preview-kpi__delta">▼ 1.4%</span>
    </div>
    <div class="preview-kpi">
        <span class="preview-kpi__label">{Metric label}</span>
        <span class="preview-kpi__value">{Value}</span>
        <span class="preview-kpi__delta">— stable</span>
    </div>
</div>
```

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
            <h3 class="preview-card__title">{Item name}</h3>
            <span class="preview-badge preview-badge--success"><span class="preview-badge__dot"></span>Active</span>
        </div>
        <p class="preview-card__body">{One-line description.}</p>
        <div class="preview-card__meta">
            <span>{Owner name}</span><span>·</span><span>Updated 2h ago</span>
        </div>
    </article>
    <article class="preview-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3);">
            <h3 class="preview-card__title">{Item name}</h3>
            <span class="preview-badge preview-badge--warning"><span class="preview-badge__dot"></span>Pending</span>
        </div>
        <p class="preview-card__body">{One-line description.}</p>
        <div class="preview-card__meta">
            <span>{Owner name}</span><span>·</span><span>Updated yesterday</span>
        </div>
    </article>
    <article class="preview-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3);">
            <h3 class="preview-card__title">{Item name}</h3>
            <span class="preview-badge preview-badge--neutral">Draft</span>
        </div>
        <p class="preview-card__body">{One-line description.}</p>
        <div class="preview-card__meta">
            <span>{Owner name}</span><span>·</span><span>Updated last week</span>
        </div>
    </article>
</div>
```

> The few inline `style="…"` attributes above are intentional layout shims (flex row). Keep them — they don't override colors or fonts.

### `grid` (3-column card grid)
```html
<div class="preview-card-grid">
    <article class="preview-card">
        <div class="preview-card__media"></div>
        <h3 class="preview-card__title">{Title}</h3>
        <p class="preview-card__body">{Description.}</p>
    </article>
    <article class="preview-card">
        <div class="preview-card__media"></div>
        <h3 class="preview-card__title">{Title}</h3>
        <p class="preview-card__body">{Description.}</p>
    </article>
    <article class="preview-card">
        <div class="preview-card__media"></div>
        <h3 class="preview-card__title">{Title}</h3>
        <p class="preview-card__body">{Description.}</p>
    </article>
</div>
```

### `form`
```html
<form class="preview-form">
    <div class="preview-form__field">
        <label class="preview-form__label" for="preview-name">Name</label>
        <input class="preview-form__input" id="preview-name" type="text" placeholder="Jane Doe">
    </div>
    <div class="preview-form__field">
        <label class="preview-form__label" for="preview-email">Email</label>
        <input class="preview-form__input" id="preview-email" type="email" placeholder="jane@example.com">
        <span class="preview-form__hint">We'll never share your email.</span>
    </div>
    <div class="preview-form__field">
        <label class="preview-form__label" for="preview-notes">Notes</label>
        <textarea class="preview-form__textarea" id="preview-notes" placeholder="Add any context…"></textarea>
    </div>
    <div class="preview-form__actions">
        <button class="preview-btn preview-btn--secondary" type="button">Cancel</button>
        <button class="preview-btn preview-btn--primary" type="submit">Save</button>
    </div>
</form>
```

### `table`
```html
<div class="preview-table-wrap">
    <table class="preview-table">
        <thead>
            <tr><th>Name</th><th>Owner</th><th>Status</th><th>Updated</th></tr>
        </thead>
        <tbody>
            <tr>
                <td>{Row title}</td>
                <td>{Owner}</td>
                <td><span class="preview-badge preview-badge--success"><span class="preview-badge__dot"></span>Active</span></td>
                <td>2 min ago</td>
            </tr>
            <tr>
                <td>{Row title}</td>
                <td>{Owner}</td>
                <td><span class="preview-badge preview-badge--warning"><span class="preview-badge__dot"></span>Pending</span></td>
                <td>1 hr ago</td>
            </tr>
            <tr>
                <td>{Row title}</td>
                <td>{Owner}</td>
                <td><span class="preview-badge preview-badge--neutral">Archived</span></td>
                <td>Yesterday</td>
            </tr>
        </tbody>
    </table>
</div>
```

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
    <div class="preview-tabs__tab preview-tabs__tab--active">Overview</div>
    <div class="preview-tabs__tab">Activity</div>
    <div class="preview-tabs__tab">Settings</div>
</div>
```

### `modal` (rendered inline as a preview — no overlay backdrop in the sketch)
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
    <h3 class="preview-empty__title">{No items yet}</h3>
    <p class="preview-empty__body">{1–2 lines explaining how to add the first item.}</p>
    <button class="preview-btn preview-btn--primary" type="button">{Primary action}</button>
</div>
```

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

---

## Hard rules — read before writing any HTML

1. **One `<link rel="stylesheet" href="./theme.css">` only.** The `ScaffoldPlanViewController` rewrites this exact tag into an inline `<style>` block so the iframe is self-contained. Any other stylesheet reference is dropped.
2. **No `<script>` tags.** The preview iframe runs with `sandbox="allow-same-origin"` (no `allow-scripts`). Inline JS won't run; external JS won't load.
3. **No external assets.** No `<img src="https://…">`, no Google Fonts `<link>`, no Font Awesome CDN. Use CSS gradients / emoji glyphs for visual variety if needed.
4. **Inline `style="…"` is allowed only for layout shims and color overrides shown in the recipes above** (flex row wrappers, avatar resizing, hero ghost-button text color, KPI delta neutral color). All semantic styling — fonts, palette colors, shadows, spacing scale — MUST come from `theme.css` so the live palette swatches in the parent webview meaningfully describe what's rendered. Never invent new inline styles to recolor or restyle components.
5. **File size sanity:** each page HTML should be **< 16 KB**. The richer recipes (KPI rows, status badges, full headers) raise the floor; if you're past 16 KB you're inventing content the plan didn't call for.
