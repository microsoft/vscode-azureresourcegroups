# Frontend Quality Bar — Render Layout Tokens with Real Library Primitives

> **Load this BEFORE writing any frontend page or component.** Read during **Step 1** (Frontend Preview) and **Step 12** (Wire Frontend). This is the contract between the plan's Section 5 (Design System & UI) and the scaffolded JSX.

---

## Core principle

> **Layout tokens are layout INTENT, not implementation.** When the plan's Section 5 says a page's layout is `header + hero + grid + footer`, that does NOT mean produce four `<div>`s with placeholder text. It means **render the equivalent of those regions using the real `Component Library` named in Section 5, themed by the Section 5 Color Palette.**

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

## Section 5 inputs you MUST consume

| Field in plan §5         | What it controls                                                         |
|--------------------------|--------------------------------------------------------------------------|
| `Component Library:`     | Which library's primitives you import and render (mandatory).            |
| `Style Direction:`       | Density, corner radius, elevation, list-vs-hero bias.                    |
| `Typography:`            | Font family applied at the app shell level.                              |
| Color Palette table      | Brand ramp / theme tokens — wire through the library's theme provider.   |
| Pages table (`Layout`)   | Which **library primitives** to compose per page (see mapping below).    |

> If Section 5 is missing or `Component Library:` is blank, **STOP**. The plan is incomplete — re-run `azure-project-plan` instead of guessing.

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

**Theming**: Wrap the app shell in `<FluentProvider theme={appTheme}>` where `appTheme = createLightTheme(brandRamp)` and `brandRamp` is a 16-step `BrandVariants` derived from Section 5's `primary` color. Body font comes from Section 5's `Typography`.

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

**Theming**: Configure `vuetify({ theme: { themes: { light: { colors: { primary: '…', surface: '…', … } } } } })` from Section 5's palette.

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

**Theming**: Define a Material 3 theme via `mat.define-theme(...)` using Section 5's primary as the seed color.

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

**Theming**: Build a Skeleton theme module from Section 5's palette and set `data-theme="…"` on the root.

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

**Theming**: Set CSS custom properties (`--pico-primary`, `--pico-background-color`, `--pico-color`, `--pico-muted-color`) from Section 5's palette on `:root` or `[data-theme=light]`.

---

## State coverage contract (every data-bearing page)

Every page that displays data MUST cover all four states with real library primitives — not text-only fallbacks:

| State    | Fluent UI v9                                  | Vuetify 3                            | Angular Material                                | Skeleton                                | Pico                               |
|----------|-----------------------------------------------|--------------------------------------|-------------------------------------------------|-----------------------------------------|------------------------------------|
| loading  | `<Skeleton>` + `<SkeletonItem>` rows          | `<v-skeleton-loader type="card">`    | `<ngx-skeleton-loader>` or `<mat-progress-bar>` | `<div class="placeholder animate-pulse">` | `<progress indeterminate>`        |
| error    | `<MessageBar intent="error">` + retry `<Button>` | `<v-alert type="error">` + retry `<v-btn>` | `<mat-card>` + `<mat-icon>error</mat-icon>` + retry button | `<aside class="alert variant-filled-error">` + retry | `<article><mark>` + retry `<button>` |
| empty    | `<Card>` with illustration + `<Body1>` + primary `<Button>` CTA | `<v-empty-state>` or `<v-card>` with `<v-icon>` + `<v-btn>` CTA | `<mat-card>` + `<mat-icon>` + primary action | `<div class="card">` + icon + primary CTA `<button>` | `<article>` + `<p>` + primary `<button>` |
| data     | Real list/grid/table from mock fixtures       | Real list/grid/table                 | Real list/grid/table                            | Real list/grid/table                    | Real list/grid/table               |

> The four states MUST be reachable from the running preview — wire a small dev-only toggle (URL hash, query param, or a corner button gated by `import.meta.env.DEV`) so reviewers can flip between `loading`, `error`, `empty`, `data` without restarting the server. This is also how `azure-project-test` later verifies the four-state contract.

---

## Theming contract

1. **Build a brand ramp from Section 5's `primary`** and pass it to the library's theme provider — do **not** ship the library's default brand color.
   - Fluent UI v9: `createLightTheme(brandRamp)` where `brandRamp: BrandVariants` is a 16-step ramp from HSL lightening/darkening of `primary`.
   - Vuetify: `theme.themes.light.colors.primary`.
   - Angular Material: `mat.define-theme({ color: { primary: $palette } })`.
   - Skeleton: custom theme module with `--color-primary-*` CSS variables.
   - Pico: `--pico-primary` CSS variable.
2. **Map `surface` / `text` / `muted` / `border`** onto the library's neutral tokens — do not hard-code colors in component JSX. Semantic states (success / warning / error) come from the library's built-in semantic tokens, not from the plan palette.
3. **Apply `Typography`** at the app shell level (Fluent: `FluentProvider` style override; Vuetify: `<v-app>` font-family; Angular: `--mat-sys-body-large-font`; Skeleton: theme module; Pico: `:root { font-family: … }`).
4. The plan-preview webview always uses Fluent UI v9 (it's the only library bundled in the extension). When `Component Library` is anything else, the preview shows a footnote: *"Preview rendered with Fluent UI v9 — your scaffolded app will use **{Component Library}** with equivalent components."* The scaffolded app itself MUST use the library named in the plan, not Fluent.

---

## Quality gate (run this checklist before claiming the preview is ready)

- [ ] Every page imports primitives from the library named in Section 5 — **zero raw `<div className="card">` / `<div className="header">` placeholders** outside the layout grid wrappers.
- [ ] App shell is wrapped in the library's theme provider; brand ramp is derived from Section 5 `primary`.
- [ ] Every icon is a real library icon (Fluent: `*Regular` from `@fluentui/react-icons`; Material: `<mat-icon>name</mat-icon>` with real names; Vuetify: `mdi-*`; Skeleton/Pico: native SVG icons via a real icon set such as Lucide or Tabler). **No emoji, no `<svg viewBox="0 0 1 1">` placeholders.**
- [ ] Every `form` region has at least one field with a visible validation state (warning/error) and an inline message.
- [ ] Every data-bearing page exposes all four states (loading / error / empty / data) via a dev-only toggle.
- [ ] `Style Direction:` is reflected in density and corner radius (e.g. "data-dense" → compact toolbars, tight list rows; "calm and spacious" → generous padding, larger cards).
- [ ] No `any` types; the four-state contract still holds; auto-auth still works (if applicable).
- [ ] If `Component Library` ≠ Fluent UI v9, the preview shows the disclosure footnote above the iframe.
