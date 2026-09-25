# Frontend Quality Bar — Render Layout Tokens with Real Library Primitives

> **Load this BEFORE writing any frontend page or component.** Read during **Step 1** (Frontend). This is the contract between the plan's Design System & UI section and the scaffolded JSX.

> **Read first:** fidelity-agnostic **Shared design-quality principles** in [`../shared-references/frontend-quality-bar.md`](.github/agents/shared-references/frontend-quality-bar.md), shared design contract for planning preview + scaffold. This file adds **framework rendering layer** (per-library primitive mapping, theming, motion, dark mode).

---

## Core principle

> **Layout tokens are layout INTENT, not implementation.** When the plan's Design System & UI section says a page's layout is `header + hero + grid + footer`, that does NOT mean produce four `<div>`s with placeholder text. It means **render the equivalent of those regions using the real `Component Library` and Color Palette named in that section.**

If you ever emit JSX like this:

```tsx
// ❌ ZERO-EFFORT WIREFRAME REPRODUCTION — DO NOT SHIP
<div className="header">Header</div>
<div className="hero">Hero</div>
<div className="grid">
  <div className="card">Card 1</div>
  <div className="card">Card 2</div>
</div>
```

…fails quality bar: output **looks worse than approved presentation-quality plan preview**, stripping theme, icons, elevation, and state coverage. Preview is promise; honor it.

---

## Design System & UI inputs you MUST consume

| Field in Design System & UI | What it controls                                                      |
|--------------------------|--------------------------------------------------------------------------|
| `Component Library:`     | Mandatory library primitives to import and render.                       |
| `Style Direction:`       | Density, corner radius, elevation, list-vs-hero bias.                    |
| `Typography:`            | App-shell font family.                                                    |
| Color Palette table      | Brand ramp / theme tokens through library theme provider.                |
| Pages table (`Layout`)   | **Library primitives** composed per page (mapping below).                |
| `.azure/.preview-temp/*.html` + `theme.css` | Approved **presentation-quality static HTML/CSS preview**: faithful visual spec for page regions and order, themed palette, real inline-SVG icons, populated content, all four data states. Raw-static limits omit real webfonts, motion, working dark mode, real photos. **Reproduce faithfully with real library primitives; add only production-only capabilities** ("Polish floor" below); never regress. Do not import, embed, or `<iframe>` it. Delete folder in Step 11. |

> If Design System & UI is missing or `Component Library:` is blank, **STOP**. The plan is incomplete — re-run `azure-project-plan` instead of guessing.

---

## Per-library region-token → primitive mapping

Use row matching plan `Component Library:`. Every region token MUST resolve to real themed library primitive, not bare `<div>`. Compound tokens (`split(a|b)`, `two-column(a+b)`) compose two primitives in CSS Grid.

### Fluent UI v9 (`@fluentui/react-components`) — React default

| Region token | Primitive(s) to render                                                                                              |
|--------------|---------------------------------------------------------------------------------------------------------------------|
| `header`     | `<Toolbar>` + `<Subtitle1>` (app title) + `<Link>`s + `<Avatar name=… />` on the right                              |
| `nav`        | Horizontal `<TabList>` + `<Tab icon={<HomeRegular />}>` per route                                                   |
| `sidebar`    | Vertical `<TabList vertical>` + `<Tab icon=…>` per route, with `<Divider>` between groups                           |
| `hero`       | `<Card appearance="filled-alternative">` + `<Title3>` + `<Body1>` + `<Button appearance="primary">`                 |
| `main`       | `<Card>` wrapper with `<CardHeader>` + body content driven by page intent                                           |
| `list`       | List of `<Card>` rows with `<CardHeader image={<Avatar />} header=… description=… />`                               |
| `card-list`  | CSS Grid of `<Card>`s with `<CardPreview>` + `<CardHeader>` + `<CardFooter>` (real ratings / metadata, not lorem)   |
| `grid`       | Same as `card-list` but tighter (e.g. `repeat(auto-fill, minmax(220px, 1fr))`)                                      |
| `form`       | `<Field label=… validationState=…>` wrapping `<Input>` / `<Textarea>` / `<Combobox>` / `<Switch>` — at least one field shows `validationState="warning"` with a `validationMessage` so the four-state contract is visible |
| `table`      | `<Table>` + `<TableHeader>` + `<TableHeaderCell>`s + `<TableBody>` + `<TableRow>` / `<TableCell>` (real columns)    |
| `tabs`       | `<TabList>` + `<Tab>`s with the first tab `selected`, second tab content as the visible body                        |
| `actions` / `action-bar` | `<Toolbar>` + `<ToolbarButton icon=…>`s; primary action uses `appearance="primary"`                        |
| `modal`      | Inline `<Card>` mock (do NOT mount a real `<Dialog>` in the preview — it steals focus and breaks the screenshot)    |
| `footer`     | `<Divider>` + horizontal `<Caption1>` row with copyright + links                                                    |
| unknown      | `<MessageBar intent="info">` saying `Unknown layout token "{token}" — will be rendered with {Component Library} in scaffold` |

**Theming**: Wrap the app shell in `<FluentProvider theme={appTheme}>` where `appTheme = createLightTheme(brandRamp)` and `brandRamp` is a 16-step `BrandVariants` derived from the Design System's `primary` color. Body font comes from its `Typography`.

**Icons**: Use real `@fluentui/react-icons` Regular variants; never emoji or hand-drawn inline SVG placeholders. Defaults: `HomeRegular`, `SearchRegular`, `SettingsRegular`, `PersonRegular`, `GridRegular`, `DocumentRegular`, `BookmarkRegular`, `MailRegular`, `CalendarRegular`, `ChevronDownRegular`, `AppsRegular`, `TableSimpleRegular`.

### Vuetify 3 — Vue default

| Region token | Primitive(s) to render                                                                          |
|--------------|--------------------------------------------------------------------------------------------------|
| `header`     | `<v-app-bar>` + `<v-app-bar-title>` + `<v-spacer>` + `<v-avatar>`                                |
| `nav`        | `<v-tabs>` + `<v-tab prepend-icon="…">`                                                          |
| `sidebar`    | `<v-navigation-drawer permanent>` + `<v-list>` + `<v-list-item prepend-icon=…>`                   |
| `hero`       | `<v-card variant="tonal">` + `<v-card-title>` + `<v-card-text>` + `<v-btn color="primary">`      |
| `main`       | `<v-card>` + `<v-card-title>` + body slot                                                        |
| `list`       | `<v-list>` of `<v-list-item>` with `prepend-avatar` + `title` + `subtitle`                       |
| `card-list` / `grid` | `<v-row>` of `<v-col cols="12" sm="6" md="4">` wrapping `<v-card>`s with `<v-img>` + `<v-card-title>` + `<v-card-actions>` |
| `form`       | `<v-form>` + `<v-text-field>` / `<v-textarea>` / `<v-select>` / `<v-switch>` (at least one with `:error-messages` set) |
| `table`      | `<v-data-table>` with real `headers` + `items`                                                   |
| `tabs`       | `<v-tabs>` + `<v-tab>` + `<v-window>` + `<v-window-item>`                                         |
| `actions`    | `<v-toolbar density="compact">` + `<v-btn color="primary">`                                      |
| `modal`      | Inline `<v-card>` (NOT `<v-dialog>` in preview)                                                  |
| `footer`     | `<v-divider />` + `<v-footer>` row                                                               |
| unknown      | `<v-alert type="info">Unknown layout token "{token}"</v-alert>`                                  |

**Theming**: Configure `vuetify({ theme: { themes: { light: { colors: { primary: '…', surface: '…', … } } } } })` from the Design System palette.

### Angular Material — Angular default

| Region token | Primitive(s) to render                                                       |
|--------------|------------------------------------------------------------------------------|
| `header`     | `<mat-toolbar color="primary">` + title + spacer + `mat-icon-button`         |
| `nav` / `sidebar` | `<mat-sidenav-container>` + `<mat-sidenav mode="side" opened>` + `<mat-nav-list>` |
| `hero`       | `<mat-card appearance="outlined">` + `<mat-card-title>` + `<button mat-raised-button color="primary">` |
| `list`       | `<mat-list>` + `<mat-list-item>` with `<mat-icon matListItemIcon>`           |
| `card-list` / `grid` | `<mat-grid-list cols="3">` + `<mat-grid-tile>` + `<mat-card>`        |
| `form`       | `<mat-form-field appearance="outline">` + `<input matInput>` / `<mat-select>` / `<mat-slide-toggle>` (at least one with `<mat-error>`) |
| `table`      | `<table mat-table [dataSource]=…>` with `<th mat-header-cell>` + `<td mat-cell>` |
| `tabs`       | `<mat-tab-group>` + `<mat-tab label=…>`                                       |
| `actions`    | `<mat-toolbar>` + `<button mat-raised-button color="primary">`               |
| `modal`      | Inline `<mat-card>` (NOT `<mat-dialog>` in preview)                          |
| `footer`     | `<mat-divider>` + footer row                                                 |
| unknown      | `<mat-card>` with warning icon + `Unknown layout token "{token}"`            |

**Theming**: Define a Material 3 theme via `mat.define-theme(...)` using the Design System primary as the seed color.

### Skeleton UI (Svelte default)

| Region token | Primitive(s) to render                                                                          |
|--------------|--------------------------------------------------------------------------------------------------|
| `header`     | `<AppBar>` with `lead`, `headline`, `trail` slots                                                |
| `nav`        | `<TabGroup>` + `<Tab>`s with `<svelte:fragment slot="lead">` icon                                |
| `sidebar`    | `<AppRail>` + `<AppRailTile>`s, or `<AppShell sidebarLeft>` + `<nav>` + `<a class="list-item">` |
| `hero`       | `<div class="card variant-glass-primary p-8">` + `<h2 class="h2">` + `<button class="btn variant-filled-primary">` |
| `list`       | `<ul class="list">` + `<li>` with avatar `<Avatar>` + title + subtitle                          |
| `card-list` / `grid` | CSS Grid of `<div class="card">` blocks with `<header class="card-header">` + body + footer |
| `form`       | `<label class="label">` + `<input class="input">` / `<textarea class="textarea">` / `<select class="select">` / `<SlideToggle>` (at least one with `input-error`) |
| `table`      | `<Table source={…} />` (Skeleton) or `<table class="table table-hover">`                         |
| `tabs`       | `<TabGroup>` + `<Tab>`s                                                                          |
| `actions`    | `<div class="card-footer">` + `<button class="btn variant-filled-primary">`                      |
| `modal`      | Inline `<div class="card">` (NOT `<Modal>` in preview)                                          |
| `footer`     | `<hr class="hr">` + footer `<div>`                                                               |
| unknown      | `<aside class="alert variant-ghost-surface">Unknown layout token "{token}"</aside>`             |

**Theming**: Build a Skeleton theme module from the Design System palette and set `data-theme="…"` on the root.

### Pico.css / plain HTML

| Region token | Primitive(s) to render                                                       |
|--------------|------------------------------------------------------------------------------|
| `header`     | `<header><nav><ul>…</ul></nav></header>` (Pico styles `<nav>` automatically) |
| `nav`        | `<nav><ul>` of `<li><a>`                                                     |
| `sidebar`    | `<aside><nav>` of `<li><a>`                                                  |
| `hero`       | `<article>` + `<hgroup>` + `<button>`                                        |
| `list` / `card-list` / `grid` | `<div class="grid">` of `<article>` cards with `<hgroup>`   |
| `form`       | `<form>` + `<label>` + `<input>` / `<select>` / `<textarea>` (one with `aria-invalid="true"`) |
| `table`      | `<figure><table>` + `<thead>` / `<tbody>`                                    |
| `tabs`       | `<nav>` of `<a role="button">` (Pico has no native tabs — flatten to nav)    |
| `actions`    | `<footer><button class="primary">`                                           |
| `modal`      | Inline `<dialog open>` (rendered, not toggled)                               |
| `footer`     | `<footer>` with small text                                                   |
| unknown      | `<mark>Unknown layout token "{token}"</mark>`                                |

**Theming**: Set CSS custom properties (`--pico-primary`, `--pico-background-color`, `--pico-color`, `--pico-muted-color`) from the Design System palette on `:root` or `[data-theme=light]`.

---

## State coverage contract (every data-bearing page)

Every data page MUST cover all four states with real library primitives, not text-only fallbacks:

| State    | Fluent UI v9                                  | Vuetify 3                            | Angular Material                                | Skeleton                                | Pico                               |
|----------|-----------------------------------------------|--------------------------------------|-------------------------------------------------|-----------------------------------------|------------------------------------|
| loading  | `<Skeleton>` + `<SkeletonItem>` rows          | `<v-skeleton-loader type="card">`    | `<ngx-skeleton-loader>` or `<mat-progress-bar>` | `<div class="placeholder animate-pulse">` | `<progress indeterminate>`        |
| error    | `<MessageBar intent="error">` + retry `<Button>` | `<v-alert type="error">` + retry `<v-btn>` | `<mat-card>` + `<mat-icon>error</mat-icon>` + retry button | `<aside class="alert variant-filled-error">` + retry | `<article><mark>` + retry `<button>` |
| empty    | `<Card>` with illustration + `<Body1>` + primary `<Button>` CTA | `<v-empty-state>` or `<v-card>` with `<v-icon>` + `<v-btn>` CTA | `<mat-card>` + `<mat-icon>` + primary action | `<div class="card">` + icon + primary CTA `<button>` | `<article>` + `<p>` + primary `<button>` |
| data     | Real list/grid/table from mock fixtures       | Real list/grid/table                 | Real list/grid/table                            | Real list/grid/table                    | Real list/grid/table               |

> All four states MUST be reachable in running app. Wire small dev-only toggle (URL hash, query param, or corner button gated by `import.meta.env.DEV`) to exercise `loading`, `error`, `empty`, `data`; toggle verifies contract.

---

## Theming contract

1. **Build a brand ramp from the Design System's `primary`** and pass it to the library's theme provider — do **not** ship the library's default brand color.
   - Fluent UI v9: `createLightTheme(brandRamp)` where `brandRamp: BrandVariants` is a 16-step ramp from HSL lightening/darkening of `primary`.
   - Vuetify: `theme.themes.light.colors.primary`.
   - Angular Material: `mat.define-theme({ color: { primary: $palette } })`.
   - Skeleton: custom theme module with `--color-primary-*` CSS variables.
   - Pico: `--pico-primary` CSS variable.
2. **Map `surface` / `text` / `muted` / `border`** to library neutral tokens; no hard-coded component JSX colors. Use library built-in semantic tokens, not plan palette, for success / warning / error.
3. **Apply `Typography`** at app-shell level (Fluent: `FluentProvider` style override; Vuetify: `<v-app>` font-family; Angular: `--mat-sys-body-large-font`; Skeleton: theme module; Pico: `:root { font-family: … }`).
4. Plan-preview webview renders sandboxed, presentational **HTML/CSS**: no JavaScript or real component library. Each page at `.azure/.preview-temp/<slug>.html` shares `.azure/.preview-temp/theme.css`. Treat as **presentation-quality visual spec** for approved regions, themed palette, real icons, populated content, all four states. Reproduce with real library primitives; **add static-file omissions**: real webfont, motion, dark mode, real imagery. Do not import, embed, or `<iframe>` preview. Delete `.azure/.preview-temp/` in Step 11.

---

## Quality gate (run this checklist before claiming the preview is ready)

- [ ] Every page imports primitives from the library named in Design System & UI — **zero raw `<div className="card">` / `<div className="header">` placeholders** outside the layout grid wrappers.
- [ ] App shell is wrapped in the library's theme provider; brand ramp is derived from the Design System `primary`.
- [ ] Every icon is a real library icon (Fluent: `*Regular` from `@fluentui/react-icons`; Material: `<mat-icon>name</mat-icon>` with real names; Vuetify: `mdi-*`; Skeleton/Pico: native SVG icons via a real icon set such as Lucide or Tabler). **No emoji, no `<svg viewBox="0 0 1 1">` placeholders.**
- [ ] Every `form` region has at least one field with a visible validation state (warning/error) and an inline message.
- [ ] Every data-bearing page exposes all four states (loading / error / empty / data) via a dev-only toggle.
- [ ] `Style Direction:` is reflected in density and corner radius (e.g. "data-dense" → compact toolbars, tight list rows; "calm and spacious" → generous padding, larger cards).
- [ ] No `any`; four-state contract holds; locally seeded identity works when `API Login` is `Yes`, and no auth UI exists when `No`.
- [ ] When `API Login` is `Yes`, logout reveals visible **Create account** button on login page; button opens complete create-account page with validation/error states.
- [ ] Scaffolded UI **reproduces approved `.azure/.preview-temp/<slug>.html` preview and adds production-only layer**: same regions, brand color, density, populated content; real library primitives, webfont, motion, dark mode, imagery. **Less** polished than preview fails.

---

## Polish floor — every scaffolded app, regardless of library

These eight requirements are **non-negotiable**. Missing any fails bar; transform component-swapped sketch into shippable app.

### 1. Hero treatment (every landing / dashboard / list-index page)

A flat colored panel is **not** hero. Every hero MUST have:

- A **brand-gradient card** (linear or radial) using two stops from the Design System palette (typically `primary` → `accent`, or `primary` → a 12-step-lighter `primary`).
- An **eyebrow line** above the headline: uppercased, letter-spaced ~0.12em, ~11–12px, with a 6px dot prefix — distinct from the headline.
- A **headline** at the library's `display`/`Title1`/`h1` token, max-width ~24ch, line-height ~1.1, sub-tight letter-spacing.
- A **subtitle** at the body token, max-width ~60ch, opacity 0.85–0.95.
- **Two CTAs**: a primary library button (named action, see microcopy below) + a secondary/ghost variant.
- An **ambient SVG mesh backdrop** layered behind the gradient. Concrete pattern:

```tsx
<svg className="hero-mesh" aria-hidden="true" viewBox="0 0 800 400" preserveAspectRatio="none">
  <defs>
    <radialGradient id="m1" cx="0%" cy="0%" r="80%">
      <stop offset="0%" stopColor="var(--brand-accent)" stopOpacity="0.55" />
      <stop offset="100%" stopColor="var(--brand-accent)" stopOpacity="0" />
    </radialGradient>
    <radialGradient id="m2" cx="100%" cy="100%" r="80%">
      <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity="0.55" />
      <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity="0" />
    </radialGradient>
  </defs>
  <rect width="800" height="400" fill="url(#m1)" />
  <rect width="800" height="400" fill="url(#m2)" />
</svg>
```

Position SVG `position: absolute; inset: 0; pointer-events: none; opacity: 0.7;`; layer gradient panel above. `aria-hidden` required.

### 2. Real icons — everywhere (no exceptions)

Every navigation and sidebar item, KPI tile, empty state, primary CTA, and section-title row MUST have real named icon from library official icon set:

| Library          | Icon source                       | Concrete sample imports                                                                          |
|------------------|-----------------------------------|--------------------------------------------------------------------------------------------------|
| Fluent UI v9     | `@fluentui/react-icons` Regular   | `HomeRegular`, `SearchRegular`, `SettingsRegular`, `PersonRegular`, `GridRegular`, `BookmarkRegular`, `ChevronRightRegular`, `AddRegular`, `DocumentRegular`, `InboxRegular`, `CalendarRegular`, `ChartMultipleRegular` |
| Vuetify 3        | Material Design Icons (`mdi-*`)   | `mdi-home`, `mdi-magnify`, `mdi-cog`, `mdi-account`, `mdi-view-dashboard`, `mdi-bookmark`, `mdi-chevron-right`, `mdi-plus`, `mdi-file-document`, `mdi-inbox`, `mdi-calendar`, `mdi-chart-line` |
| Angular Material | Material Symbols / `mat-icon`     | `home`, `search`, `settings`, `person`, `dashboard`, `bookmark`, `chevron_right`, `add`, `description`, `inbox`, `calendar_today`, `show_chart` |
| Skeleton (Svelte)| Lucide-Svelte                     | `Home`, `Search`, `Settings`, `User`, `LayoutGrid`, `Bookmark`, `ChevronRight`, `Plus`, `FileText`, `Inbox`, `Calendar`, `LineChart` |
| Pico             | Lucide (`lucide-static` or `lucide` web) | Same Lucide names above; render via inline SVG or `<i data-lucide="home">`                  |

**Hard fail**: emoji (🏠, 📊), Unicode glyphs (▲, ★), or hand-drawn `<svg>` nav/section/CTA iconography.

### 3. Motion (lightweight, library-aligned)

Every app MUST add motion in three places and respect `prefers-reduced-motion`:

| Library          | Motion tool                           | Where it must appear                                                          |
|------------------|---------------------------------------|-------------------------------------------------------------------------------|
| Fluent UI v9     | `framer-motion` or `motion/react`     | Route change (fade+12px slide), card hover (1–2px lift), dialog/popover open  |
| Vuetify 3        | `@vueuse/motion` or built-in `<v-fade-transition>` / `<v-slide-y-transition>` | Route change, card hover, dialog open |
| Angular Material | Angular Animations (`@angular/animations`) | Route change (`fadeInUp`), card hover, dialog open                       |
| Skeleton         | Svelte built-in `transition:fade` / `crossfade` | Route change, card hover, drawer open                              |

Duration: 150–300ms. Easing: `cubic-bezier(0.4, 0, 0.2, 1)` or library default. Without exception, wrap all motion in `prefers-reduced-motion: reduce` media query / `useReducedMotion()` hook.

### 4. All four states — visibly, with library illustrations

State table is **minimum**. Every empty state MUST include real visual (library illustration, 64–96px Lucide/Tabler icon, or domain-specific SVG), not text only:

- Fluent: empty card with centered 64px `*Regular` icon above `<Title3>` + body + primary CTA.
- Vuetify: `<v-empty-state>` (built-in illustration slot) or `<v-card>` with `<v-icon size="64">`.
- Angular Material: `<mat-card>` with `<mat-icon style="font-size: 64px; width: 64px; height: 64px;">`.
- Skeleton: `<div class="card">` with `<Inbox size={64} />` (Lucide) above text.

### 5. Density + radius derived from Style Direction

Translate the `Style Direction:` literal from Design System & UI into concrete library tokens:

| Style Direction keyword         | Density / radius / weight choices                                              |
|---------------------------------|--------------------------------------------------------------------------------|
| `playful`, `friendly`, `consumer` | Large radii (12–20px on cards, full-pill on buttons), comfortable padding, heavier headlines (700+), saturated palette |
| `professional`, `enterprise`, `serious` | Small radii (4–8px), compact padding, semibold headlines (600), muted palette |
| `editorial`, `magazine`, `content-led` | Mixed radii (cards 4px, hero 0–4px), generous whitespace, large display type, serif option for headings |
| `minimal`, `calm`, `data-dense`   | Tight radii (2–6px), compressed padding, regular weight body, restrained palette, hairline 1px borders |

Wire through library density/spacing/radius tokens (Fluent: `tokens.borderRadiusMedium`; Vuetify: `density="compact"` + theme `defaults`; Material: M3 density CSS vars; Skeleton: theme module radius variables).

### 6. Dark mode (required, with persistence)

Every app ships light + dark themes:

- A theme toggle in the header (uses the library's icon button).
- Persistence via `localStorage` key `app-theme` (`'light' | 'dark' | 'system'`).
- Initial value reads `prefers-color-scheme` when key is missing or set to `'system'`.
- Live update on `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', …)` while in `'system'` mode.
- Both themes derive from the **same** Design System brand palette — only neutrals and surfaces flip.

### 7. Real webfont, mapped from Style Direction

Apply webfont through `<head>` (CSS `@import` or `<link>`) and library font token. Choose by Style Direction:

| Style Direction keyword         | Webfont                            |
|---------------------------------|------------------------------------|
| `playful`, `friendly`           | `Inter` (variable) or `Geist Sans` |
| `professional`, `enterprise`    | `Inter` or `IBM Plex Sans`         |
| `editorial`, `magazine`         | `Source Sans 3` body + `Source Serif 4` headings |
| `minimal`, `calm`, `data-dense` | `Geist Sans` or `IBM Plex Sans`    |

Load with `<link rel="preconnect">` + `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=…">` or self-host. Fall back to `system-ui, -apple-system, "Segoe UI", sans-serif`.

### 8. Microcopy — primary CTAs name the action

Primary buttons MUST name committed action. **Hard fail**: generic verbs.

| ❌ Generic (fails)    | ✅ Named (passes)                                                |
|----------------------|-------------------------------------------------------------------|
| `Submit`             | `Save changes`, `Create project`, `Send invite`, `Publish post`   |
| `OK`                 | `Got it`, `Acknowledge`, `Mark as read`                           |
| `Continue`           | `Continue to billing`, `Review and confirm`                       |
| `Delete`             | `Delete project permanently`, `Remove from team`                  |

Secondary/ghost buttons may be generic (`Cancel`, `Back`). Modal confirms follow same rule (`Delete 3 items`, not `Confirm`).

### 9. Imagery & art direction (domain fit beats stock chrome)

A page passing items 1–8 can still look templated with empty media or identical generic cards. Every app MUST:

- **Render real images for every media-bearing entity.** Bind mock-data image URL (Sub-step F2) into real `<img>` / Fluent `<CardPreview image>` / Vuetify `<v-img>` / Angular `mat-card-image` / Skeleton-Pico `<img>`. **Never** use empty tinted `<CardPreview>` or solid-color `<div>` photo stand-in. Media card without visible photo hard-fails.
- **Match domain visual idiom.** Photo-sharing: gallery (edge-to-edge imagery, scrapbook/polaroid framing, captions); finance: data-dense tables; editorial: magazine; chat: message bubbles. Never flatten all apps into generic SaaS card grid.
- **Use bespoke, domain-specific component treatments**—tilted polaroid frames, ticket stubs, chat bubbles, kanban cards, gallery tiles, etc.—**layered on top of** region-token library primitives. Encouraged, not forbidden (self-review item 12). Ban only empty placeholder `<div>`s re-skinning wireframe, never domain-fit art direction.

---

## Polish self-review checklist (per page, before marking complete)

Run this 12-item yes/no list for **each generated page**. Any "no": page unfinished; do not proceed.

1. Does the hero use a brand gradient (not flat color) with eyebrow + headline + subtitle + 2 CTAs + ambient SVG mesh backdrop?
2. Does every nav/sidebar item carry a real named icon from the library's icon set (not emoji, not glyph)?
3. Does every KPI tile / section-title row / empty state / primary CTA carry a real icon?
4. Is there at least one motion: route change, card hover, OR dialog/popover open, wired through the library's motion tool, with `prefers-reduced-motion` respected?
5. For data-bearing pages: are all four states (loading / error / empty / data) reachable via a dev toggle, and does the empty state include a 64–96px icon or illustration (not just text)?
6. Is dark mode wired through a header toggle, persisted in `localStorage`, with a `prefers-color-scheme` initial read?
7. Is a real webfont loaded via `<link>` / `@import` and applied through the library's font token?
8. Do density + corner radius tokens reflect the Design System's `Style Direction:` (playful → larger radii; professional → tighter)?
9. Do all primary CTAs name the action (`Save changes`, `Create project`) — no generic `Submit` / `OK` / `Continue`?
10. Is the brand ramp derived from the Design System's `primary` (16-step / theme-provider-driven), with both themes sharing it?
11. Does the page **match or exceed** the approved static preview — same regions and content, now with real library elevation, motion, real webfont, and real imagery — so a reviewer comparing them would say "yes, this is the preview, brought to life" (never "this looks worse than the mock")?
12. Does every region **resolve to a real library primitive** (no zero-effort `<div className="card">Card 1</div>` wireframe stubs)? Bespoke, domain-styled components (polaroid frames, ticket stubs, gallery tiles, chat bubbles) are **encouraged** as long as they wrap or extend a real library primitive and carry real content + imagery — the ban is on empty placeholder `<div>`s that merely re-skin the wireframe, not on domain art direction.
13. Does every media-bearing entity render a **real image** (from the mock data's image URL), not an empty tinted surface or solid-color block?
