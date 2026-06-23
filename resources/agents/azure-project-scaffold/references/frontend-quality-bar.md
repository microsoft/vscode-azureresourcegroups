# Frontend Quality Bar — Render Layout Tokens with Real Library Primitives

> **Load this BEFORE writing any frontend page or component.** Read during **Step 1** (Frontend). This is the contract between the plan's Section 5 (Design System & UI) and the scaffolded JSX.

---

## Core principle

> **Layout tokens are layout INTENT, not implementation.** When the plan's Section 6 says a page's layout is `header + hero + grid + footer`, that does NOT mean produce four `<div>`s with placeholder text. It means **render the equivalent of those regions using the real `Component Library` named in Section 6, themed by the Section 6 Color Palette.**

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

…you have failed the quality bar. That output **looks worse than the plan-preview wireframe** the user already approved, because it strips the library primitives, the theme, the icons, and the state coverage the preview implied. The preview is a promise; this contract is how you keep it.

---

## Section 6 inputs you MUST consume

| Field in plan §5         | What it controls                                                         |
|--------------------------|--------------------------------------------------------------------------|
| `Component Library:`     | Which library's primitives you import and render (mandatory).            |
| `Style Direction:`       | Density, corner radius, elevation, list-vs-hero bias.                    |
| `Typography:`            | Font family applied at the app shell level.                              |
| Color Palette table      | Brand ramp / theme tokens — wire through the library's theme provider.   |
| Pages table (`Layout`)   | Which **library primitives** to compose per page (see mapping below).    |
| `.azure/.preview-temp/*.html` + `theme.css` | The HTML/CSS **directional sketch** the user approved during planning. Tells you three things only: (1) page regions and rough order, (2) brand color story, (3) content density. The sketch deliberately ships with **no** icons, fonts, motion, dark mode, or polished hero treatments — those are your job. **The scaffold MUST visibly exceed the sketch** (see "Polish floor" below). Do not import, embed, or `<iframe>` it. Folder is deleted in Step 11. |

> If Section 6 is missing or `Component Library:` is blank, **STOP**. The plan is incomplete — re-run `azure-project-plan` instead of guessing.

---

## Per-library region-token → primitive mapping

Pick the row that matches the plan's `Component Library:` value. Every region token below MUST resolve to a real, themed library primitive — not a bare `<div>`. Compound tokens (`split(a|b)`, `two-column(a+b)`) compose two of these in a CSS Grid.

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

**Theming**: Wrap the app shell in `<FluentProvider theme={appTheme}>` where `appTheme = createLightTheme(brandRamp)` and `brandRamp` is a 16-step `BrandVariants` derived from Section 6's `primary` color. Body font comes from Section 6's `Typography`.

**Icons**: Use real icons from `@fluentui/react-icons` (Regular variants) — never emoji and never inline SVG hand-drawn placeholders. Reasonable defaults: `HomeRegular`, `SearchRegular`, `SettingsRegular`, `PersonRegular`, `GridRegular`, `DocumentRegular`, `BookmarkRegular`, `MailRegular`, `CalendarRegular`, `ChevronDownRegular`, `AppsRegular`, `TableSimpleRegular`.

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

**Theming**: Configure `vuetify({ theme: { themes: { light: { colors: { primary: '…', surface: '…', … } } } } })` from Section 6's palette.

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

**Theming**: Define a Material 3 theme via `mat.define-theme(...)` using Section 6's primary as the seed color.

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

**Theming**: Build a Skeleton theme module from Section 6's palette and set `data-theme="…"` on the root.

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

**Theming**: Set CSS custom properties (`--pico-primary`, `--pico-background-color`, `--pico-color`, `--pico-muted-color`) from Section 6's palette on `:root` or `[data-theme=light]`.

---

## State coverage contract (every data-bearing page)

Every page that displays data MUST cover all four states with real library primitives — not text-only fallbacks:

| State    | Fluent UI v9                                  | Vuetify 3                            | Angular Material                                | Skeleton                                | Pico                               |
|----------|-----------------------------------------------|--------------------------------------|-------------------------------------------------|-----------------------------------------|------------------------------------|
| loading  | `<Skeleton>` + `<SkeletonItem>` rows          | `<v-skeleton-loader type="card">`    | `<ngx-skeleton-loader>` or `<mat-progress-bar>` | `<div class="placeholder animate-pulse">` | `<progress indeterminate>`        |
| error    | `<MessageBar intent="error">` + retry `<Button>` | `<v-alert type="error">` + retry `<v-btn>` | `<mat-card>` + `<mat-icon>error</mat-icon>` + retry button | `<aside class="alert variant-filled-error">` + retry | `<article><mark>` + retry `<button>` |
| empty    | `<Card>` with illustration + `<Body1>` + primary `<Button>` CTA | `<v-empty-state>` or `<v-card>` with `<v-icon>` + `<v-btn>` CTA | `<mat-card>` + `<mat-icon>` + primary action | `<div class="card">` + icon + primary CTA `<button>` | `<article>` + `<p>` + primary `<button>` |
| data     | Real list/grid/table from mock fixtures       | Real list/grid/table                 | Real list/grid/table                            | Real list/grid/table                    | Real list/grid/table               |

> The four states MUST be reachable in the running app — wire a small dev-only toggle (URL hash, query param, or a corner button gated by `import.meta.env.DEV`) so `loading`, `error`, `empty`, and `data` can each be exercised. The toggle is the verification path for the four-state contract.

---

## Theming contract

1. **Build a brand ramp from Section 6's `primary`** and pass it to the library's theme provider — do **not** ship the library's default brand color.
   - Fluent UI v9: `createLightTheme(brandRamp)` where `brandRamp: BrandVariants` is a 16-step ramp from HSL lightening/darkening of `primary`.
   - Vuetify: `theme.themes.light.colors.primary`.
   - Angular Material: `mat.define-theme({ color: { primary: $palette } })`.
   - Skeleton: custom theme module with `--color-primary-*` CSS variables.
   - Pico: `--pico-primary` CSS variable.
2. **Map `surface` / `text` / `muted` / `border`** onto the library's neutral tokens — do not hard-code colors in component JSX. Semantic states (success / warning / error) come from the library's built-in semantic tokens, not from the plan palette.
3. **Apply `Typography`** at the app shell level (Fluent: `FluentProvider` style override; Vuetify: `<v-app>` font-family; Angular: `--mat-sys-body-large-font`; Skeleton: theme module; Pico: `:root { font-family: … }`).
4. The plan-preview webview renders a sandboxed **HTML/CSS** mock-up — purely presentational, no JavaScript, no real component library involved. Each page lives at `.azure/.preview-temp/<slug>.html` and shares a single `.azure/.preview-temp/theme.css`. Treat those files as a **directional sketch** — they confirm regions, color story, and density. They are **not** the polish bar. Your scaffolded app MUST out-polish the sketch in every visible dimension: real library primitives, real icons, real webfont, motion, dark mode, four states with illustrations, and library elevation. Do not import, embed, or `<iframe>` the mock-up. `.azure/.preview-temp/` is deleted in Step 11.

---

## Quality gate (run this checklist before claiming the preview is ready)

- [ ] Every page imports primitives from the library named in Section 6 — **zero raw `<div className="card">` / `<div className="header">` placeholders** outside the layout grid wrappers.
- [ ] App shell is wrapped in the library's theme provider; brand ramp is derived from Section 6 `primary`.
- [ ] Every icon is a real library icon (Fluent: `*Regular` from `@fluentui/react-icons`; Material: `<mat-icon>name</mat-icon>` with real names; Vuetify: `mdi-*`; Skeleton/Pico: native SVG icons via a real icon set such as Lucide or Tabler). **No emoji, no `<svg viewBox="0 0 1 1">` placeholders.**
- [ ] Every `form` region has at least one field with a visible validation state (warning/error) and an inline message.
- [ ] Every data-bearing page exposes all four states (loading / error / empty / data) via a dev-only toggle.
- [ ] `Style Direction:` is reflected in density and corner radius (e.g. "data-dense" → compact toolbars, tight list rows; "calm and spacious" → generous padding, larger cards).
- [ ] No `any` types; the four-state contract still holds; auto-auth still works (if applicable).
- [ ] The scaffolded UI **visibly exceeds** the directional sketch at `.azure/.preview-temp/<slug>.html` — same regions, same primary brand color, same density bias, but with real library primitives, real icons, real webfont, motion, dark mode, and library elevation that the static HTML sketch could not show. If a generated page looks like a re-skin of the sketch, the page has failed the bar.

---

## Polish floor — every scaffolded app, regardless of library

These eight requirements are **non-negotiable**. They are the gap between "the sketch with components swapped in" and "an app the user wants to ship". A page that misses any of them fails the bar.

### 1. Hero treatment (every landing / dashboard / list-index page)

A flat colored panel is **not** a hero. Every hero region MUST have:

- A **brand-gradient card** (linear or radial) using two stops from Section 6's palette (typically `primary` → `accent`, or `primary` → a 12-step-lighter `primary`).
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

Position the SVG `position: absolute; inset: 0; pointer-events: none; opacity: 0.7;`. Layer the gradient panel above it. The `aria-hidden` is required.

### 2. Real icons — everywhere (no exceptions)

Every navigation item, sidebar item, KPI tile, empty state, primary CTA, and section title row MUST carry a real, named icon from the library's official icon set:

| Library          | Icon source                       | Concrete sample imports                                                                          |
|------------------|-----------------------------------|--------------------------------------------------------------------------------------------------|
| Fluent UI v9     | `@fluentui/react-icons` Regular   | `HomeRegular`, `SearchRegular`, `SettingsRegular`, `PersonRegular`, `GridRegular`, `BookmarkRegular`, `ChevronRightRegular`, `AddRegular`, `DocumentRegular`, `InboxRegular`, `CalendarRegular`, `ChartMultipleRegular` |
| Vuetify 3        | Material Design Icons (`mdi-*`)   | `mdi-home`, `mdi-magnify`, `mdi-cog`, `mdi-account`, `mdi-view-dashboard`, `mdi-bookmark`, `mdi-chevron-right`, `mdi-plus`, `mdi-file-document`, `mdi-inbox`, `mdi-calendar`, `mdi-chart-line` |
| Angular Material | Material Symbols / `mat-icon`     | `home`, `search`, `settings`, `person`, `dashboard`, `bookmark`, `chevron_right`, `add`, `description`, `inbox`, `calendar_today`, `show_chart` |
| Skeleton (Svelte)| Lucide-Svelte                     | `Home`, `Search`, `Settings`, `User`, `LayoutGrid`, `Bookmark`, `ChevronRight`, `Plus`, `FileText`, `Inbox`, `Calendar`, `LineChart` |
| Pico             | Lucide (`lucide-static` or `lucide` web) | Same Lucide names above; render via inline SVG or `<i data-lucide="home">`                  |

**Hard fail**: emoji (🏠, 📊), Unicode glyphs (▲, ★), or hand-drawn `<svg>` shapes used as nav/section/CTA iconography.

### 3. Motion (lightweight, library-aligned)

Every app MUST add motion in three places, with `prefers-reduced-motion` respected:

| Library          | Motion tool                           | Where it must appear                                                          |
|------------------|---------------------------------------|-------------------------------------------------------------------------------|
| Fluent UI v9     | `framer-motion` or `motion/react`     | Route change (fade+12px slide), card hover (1–2px lift), dialog/popover open  |
| Vuetify 3        | `@vueuse/motion` or built-in `<v-fade-transition>` / `<v-slide-y-transition>` | Route change, card hover, dialog open |
| Angular Material | Angular Animations (`@angular/animations`) | Route change (`fadeInUp`), card hover, dialog open                       |
| Skeleton         | Svelte built-in `transition:fade` / `crossfade` | Route change, card hover, drawer open                              |

Duration: 150–300ms. Easing: `cubic-bezier(0.4, 0, 0.2, 1)` or library default. Wrap all motion in a `prefers-reduced-motion: reduce` media query / `useReducedMotion()` hook — no exceptions.

### 4. All four states — visibly, with library illustrations

The state contract in the table above is the **minimum**. Every empty state MUST also include a real visual element (library illustration component, Lucide/Tabler icon at 64–96px, or a domain-specific SVG), not just text:

- Fluent: empty card with a 64px `*Regular` icon centered above the `<Title3>` + body + primary CTA.
- Vuetify: `<v-empty-state>` (built-in, has illustration slot) or `<v-card>` with `<v-icon size="64">`.
- Angular Material: `<mat-card>` with a `<mat-icon style="font-size: 64px; width: 64px; height: 64px;">`.
- Skeleton: `<div class="card">` with `<Inbox size={64} />` (Lucide) above text.

### 5. Density + radius derived from Style Direction

Translate the `Style Direction:` literal from Section 6 into concrete library tokens:

| Style Direction keyword         | Density / radius / weight choices                                              |
|---------------------------------|--------------------------------------------------------------------------------|
| `playful`, `friendly`, `consumer` | Large radii (12–20px on cards, full-pill on buttons), comfortable padding, heavier headlines (700+), saturated palette |
| `professional`, `enterprise`, `serious` | Small radii (4–8px), compact padding, semibold headlines (600), muted palette |
| `editorial`, `magazine`, `content-led` | Mixed radii (cards 4px, hero 0–4px), generous whitespace, large display type, serif option for headings |
| `minimal`, `calm`, `data-dense`   | Tight radii (2–6px), compressed padding, regular weight body, restrained palette, hairline 1px borders |

Wire these through the library's density/spacing/radius tokens (Fluent: `tokens.borderRadiusMedium`; Vuetify: `density="compact"` + theme `defaults`; Material: M3 density CSS vars; Skeleton: theme module radius variables).

### 6. Dark mode (required, with persistence)

Every app ships with light + dark themes from day one:

- A theme toggle in the header (uses the library's icon button).
- Persistence via `localStorage` key `app-theme` (`'light' | 'dark' | 'system'`).
- Initial value reads `prefers-color-scheme` when key is missing or set to `'system'`.
- Live update on `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', …)` while in `'system'` mode.
- Both themes derive from the **same** Section 6 brand palette — only neutrals and surfaces flip.

### 7. Real webfont, mapped from Style Direction

Apply a webfont via the `<head>` (CSS `@import` or `<link>`) and wire it through the library's font token. Choose by Style Direction:

| Style Direction keyword         | Webfont                            |
|---------------------------------|------------------------------------|
| `playful`, `friendly`           | `Inter` (variable) or `Geist Sans` |
| `professional`, `enterprise`    | `Inter` or `IBM Plex Sans`         |
| `editorial`, `magazine`         | `Source Sans 3` body + `Source Serif 4` headings |
| `minimal`, `calm`, `data-dense` | `Geist Sans` or `IBM Plex Sans`    |

Load via `<link rel="preconnect">` + `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=…">` or self-host. Fall back to `system-ui, -apple-system, "Segoe UI", sans-serif`.

### 8. Microcopy — primary CTAs name the action

Primary buttons MUST name the action being committed. **Hard fail**: generic verbs.

| ❌ Generic (fails)    | ✅ Named (passes)                                                |
|----------------------|-------------------------------------------------------------------|
| `Submit`             | `Save changes`, `Create project`, `Send invite`, `Publish post`   |
| `OK`                 | `Got it`, `Acknowledge`, `Mark as read`                           |
| `Continue`           | `Continue to billing`, `Review and confirm`                       |
| `Delete`             | `Delete project permanently`, `Remove from team`                  |

Secondary/ghost buttons may be generic (`Cancel`, `Back`). Modal confirm buttons follow the same rule (`Delete 3 items` not `Confirm`).

### 9. Imagery & art direction (domain fit beats stock chrome)

A page can pass items 1–8 and still look templated if it renders empty media surfaces and identical generic cards for every app. Every app MUST:

- **Render real images for every media-bearing entity.** Bind the mock data's image URL (see Sub-step F2) into a real `<img>` / Fluent `<CardPreview image>` / Vuetify `<v-img>` / Angular `mat-card-image` / Skeleton-Pico `<img>` — **never** an empty tinted `<CardPreview>` or a solid-color `<div>` standing in for a photo. A media card with no visible photo is a hard fail.
- **Match the domain's visual idiom.** A photo-sharing app reads as a gallery (edge-to-edge imagery, scrapbook/polaroid framing, captions), a finance app as data-dense tables, an editorial app as a magazine, a chat app as message bubbles. Do not flatten every app into the same generic SaaS card grid.
- **Use bespoke, domain-specific component treatments** — tilted polaroid frames, ticket stubs, chat bubbles, kanban cards, gallery tiles, etc. — **layered on top of** the library primitives from the region-token mapping. This is encouraged, not forbidden (see self-review item 12). The ban is only on empty placeholder `<div>`s that re-skin the wireframe, never on art direction that fits the domain.

---

## Polish self-review checklist (per page, before marking complete)

Run through this 12-item yes/no list for **each page** generated. A "no" on any item means the page is not done. Do not move on.

1. Does the hero use a brand gradient (not flat color) with eyebrow + headline + subtitle + 2 CTAs + ambient SVG mesh backdrop?
2. Does every nav/sidebar item carry a real named icon from the library's icon set (not emoji, not glyph)?
3. Does every KPI tile / section-title row / empty state / primary CTA carry a real icon?
4. Is there at least one motion: route change, card hover, OR dialog/popover open, wired through the library's motion tool, with `prefers-reduced-motion` respected?
5. For data-bearing pages: are all four states (loading / error / empty / data) reachable via a dev toggle, and does the empty state include a 64–96px icon or illustration (not just text)?
6. Is dark mode wired through a header toggle, persisted in `localStorage`, with a `prefers-color-scheme` initial read?
7. Is a real webfont loaded via `<link>` / `@import` and applied through the library's font token?
8. Do density + corner radius tokens reflect Section 6's `Style Direction:` (playful → larger radii; professional → tighter)?
9. Do all primary CTAs name the action (`Save changes`, `Create project`) — no generic `Submit` / `OK` / `Continue`?
10. Is the brand ramp derived from Section 6's `primary` (16-step / theme-provider-driven), with both themes sharing it?
11. Is the layout meaningfully **different from** the static HTML sketch — better elevation, real icons, motion, polished spacing — so a reviewer comparing them would say "yes, this exceeds the mock"?
12. Does every region **resolve to a real library primitive** (no zero-effort `<div className="card">Card 1</div>` wireframe stubs)? Bespoke, domain-styled components (polaroid frames, ticket stubs, gallery tiles, chat bubbles) are **encouraged** as long as they wrap or extend a real library primitive and carry real content + imagery — the ban is on empty placeholder `<div>`s that merely re-skin the wireframe, not on domain art direction.
13. Does every media-bearing entity render a **real image** (from the mock data's image URL), not an empty tinted surface or solid-color block?
