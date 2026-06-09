# Frontend Quality Bar — Reproduce the Library's Visual Language

> **Load this BEFORE producing any frontend.** Two readers, two modes:
> - **`azure-project-plan` (Phase 2: Frontend Preview)** authors a **single static inline-CSS `index.html`** that *emulates* the library named in Section 5. There are no imports and no components — you reproduce each primitive's **look** (shape, spacing, color, typography, icon silhouette) with plain HTML + inline CSS. Every "render `<Component>`" instruction below means "produce HTML styled to look like that component."
> - **`azure-project-scaffold` (Step 1: Regenerate Frontend, Step 12: Wire Frontend)** builds the **real framework frontend** and MUST use the library's actual primitives, theme provider, and icon package per the tables below.
>
> Either way this is the contract between the plan's Section 5 (Design System & UI) and what the user sees.

---

## Core principle

> **Layout tokens are layout INTENT, not implementation.** When the plan's Section 5 says a page's layout is `header + hero + grid + footer`, that does NOT mean produce four unstyled `<div>`s with placeholder text. It means **reproduce the equivalent of those regions in the visual language of the `Component Library` named in Section 5, themed by the Section 5 Color Palette** — using real components in the scaffolded app, and high-fidelity inline-CSS HTML in the planning preview.

If you ever emit output like this:

```html
<!-- ❌ ZERO-EFFORT WIREFRAME — DO NOT SHIP (preview OR scaffold) -->
<div class="header">Header</div>
<div class="hero">Hero</div>
<div class="grid">
  <div class="card">Card 1</div>
  <div class="card">Card 2</div>
</div>
```

…you have failed the quality bar. Unstyled placeholder boxes strip the library look, the theme, the icons, and the state coverage. In the **preview** the same regions must be styled (corner radius, elevation, spacing, themed colors, real icon silhouettes) so it approximates the final product; in the **scaffold** they must be real library primitives.

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

Pick the row that matches the plan's `Component Library:` value. **Scaffold:** every region token MUST resolve to a real, themed library primitive — not a bare `<div>`. **Preview:** reproduce the same primitive's *look* with inline-CSS HTML (e.g. style a `<div>`/`<button>` to match a shadcn/ui `<Card>` / `<Button>` — rounded corners, subtle border, themed `--primary` fill). Compound tokens (`split(a|b)`, `two-column(a+b)`) compose two of these in a CSS Grid.

### Tailwind CSS + shadcn/ui (`lucide-react` icons) — React default

| Region token | Primitive(s) to render                                                                                              |
|--------------|---------------------------------------------------------------------------------------------------------------------|
| `header`     | Sticky top bar (`<header className="border-b">`) + brand `<h1 className="font-semibold">` + `<Button variant="ghost">` nav links + `<Avatar>` on the right |
| `nav`        | Horizontal `<NavigationMenu>` or a row of `<Button variant="ghost">` links, each with a leading `lucide-react` icon  |
| `sidebar`    | Vertical nav column: `<Button variant="ghost" className="w-full justify-start">` per route + `<Separator>` between groups |
| `hero`       | `<Card className="bg-muted">` + `<CardHeader><CardTitle>` + `<CardDescription>` + `<Button>` (default = primary)     |
| `main`       | `<Card>` with `<CardHeader>` + `<CardContent>` driven by page intent                                                |
| `list`       | List of `<Card>` rows, each with `<Avatar>` + title/description text + a trailing `<Button variant="ghost" size="icon">` |
| `card-list`  | CSS Grid of `<Card>`s with media (`<AspectRatio>` gradient) + `<CardHeader>` + `<CardFooter>` `<Badge>`s (real metadata, not lorem) |
| `grid`       | Same as `card-list` but tighter (e.g. `grid-cols-[repeat(auto-fill,minmax(220px,1fr))]`)                            |
| `form`       | `<Form>` + `<Label>` wrapping `<Input>` / `<Textarea>` / `<Select>` / `<Switch>` — at least one field shows an error via `<p className="text-sm text-destructive">` so the four-state contract is visible |
| `table`      | `<Table>` + `<TableHeader>` + `<TableHead>`s + `<TableBody>` + `<TableRow>` / `<TableCell>` (real columns)          |
| `tabs`       | `<Tabs>` + `<TabsList>` + `<TabsTrigger>`s (first `active`) + `<TabsContent>` as the visible body                   |
| `actions` / `action-bar` | Flex row of `<Button>`s; primary action uses the default variant, secondary `variant="outline"`            |
| `modal`      | Inline `<Card>` mock (do NOT mount a real `<Dialog>` in the preview — it steals focus and breaks the screenshot)    |
| `footer`     | `<Separator>` + horizontal `text-sm text-muted-foreground` row with copyright + links                              |
| unknown      | `<Alert>` saying `Unknown layout token "{token}" — will be rendered with {Component Library} in scaffold`           |

**Theming**: shadcn/ui themes via CSS variables on `:root` (`--background`, `--foreground`, `--primary`, `--primary-foreground`, `--muted`, `--border`, `--radius`, …) consumed by Tailwind. Derive `--primary` from Section 5's `primary` color and set `--radius`/density from `Style Direction`. Body font (`font-sans`) comes from Section 5's `Typography`. In the **preview**, declare the same custom properties in the inline `<style>` `:root` block so the webview's palette editor maps onto them.

**Icons**: Use real icons from `lucide-react` — never emoji and never hand-drawn placeholders. In the preview, inline the Lucide SVG (24×24, `stroke-width="2"`, rounded caps) so the silhouette matches. Reasonable defaults: `Home`, `Search`, `Settings`, `User`, `LayoutGrid`, `FileText`, `Bookmark`, `Mail`, `Calendar`, `ChevronDown`, `LayoutDashboard`, `Table`.

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

Every page that displays data MUST cover all four states with the library's visual treatment — not text-only fallbacks. **Scaffold** uses the real primitives below; **preview** reproduces their look in inline-CSS HTML:

| State    | Tailwind + shadcn/ui                                  | Vuetify 3                            | Angular Material                                | Skeleton                                | Pico                               |
|----------|-----------------------------------------------|--------------------------------------|-------------------------------------------------|-----------------------------------------|------------------------------------|
| loading  | `<Skeleton className="h-4 w-full">` rows          | `<v-skeleton-loader type="card">`    | `<ngx-skeleton-loader>` or `<mat-progress-bar>` | `<div class="placeholder animate-pulse">` | `<progress indeterminate>`        |
| error    | `<Alert variant="destructive">` + retry `<Button>` | `<v-alert type="error">` + retry `<v-btn>` | `<mat-card>` + `<mat-icon>error</mat-icon>` + retry button | `<aside class="alert variant-filled-error">` + retry | `<article><mark>` + retry `<button>` |
| empty    | `<Card>` + icon + `<CardDescription>` + primary `<Button>` CTA | `<v-empty-state>` or `<v-card>` with `<v-icon>` + `<v-btn>` CTA | `<mat-card>` + `<mat-icon>` + primary action | `<div class="card">` + icon + primary CTA `<button>` | `<article>` + `<p>` + primary `<button>` |
| data     | Real list/grid/table from mock fixtures       | Real list/grid/table                 | Real list/grid/table                            | Real list/grid/table                    | Real list/grid/table               |

> **Scaffold (real frontend):** the four states MUST be reachable from the running app — wire a small dev-only toggle (URL hash, query param, or a corner button gated by `import.meta.env.DEV`) so reviewers can flip between `loading`, `error`, `empty`, `data`. This is also how `azure-project-test` later verifies the four-state contract.
>
> **Preview (static HTML):** there is no toggle and no server — **depict** each of the four states somewhere in the single `index.html` (e.g. a loading skeleton block, an error banner with a retry button, an empty-state block with a CTA, and the populated data) so the reviewer can see all four treatments at once.

---

## Theming contract

1. **Build a brand ramp from Section 5's `primary`** and pass it to the library's theme provider — do **not** ship the library's default brand color.
   - Tailwind + shadcn/ui: set the HSL theme tokens on `:root` (`--primary`, `--primary-foreground`, `--ring`) derived from `primary`; Tailwind consumes them — no JS theme provider needed.
   - Vuetify: `theme.themes.light.colors.primary`.
   - Angular Material: `mat.define-theme({ color: { primary: $palette } })`.
   - Skeleton: custom theme module with `--color-primary-*` CSS variables.
   - Pico: `--pico-primary` CSS variable.
2. **Map `surface` / `text` / `muted` / `border`** onto the library's neutral tokens — do not hard-code colors in component JSX. Semantic states (success / warning / error) come from the library's built-in semantic tokens, not from the plan palette.
3. **Apply `Typography`** at the app shell level (shadcn/Tailwind: `font-sans` family via `:root { font-family: … }` / `tailwind.config`; Vuetify: `<v-app>` font-family; Angular: `--mat-sys-body-large-font`; Skeleton: theme module; Pico: `:root { font-family: … }`).
4. **Preview vs scaffold fidelity.** The planning preview is static inline-CSS HTML that *emulates* the library named in Section 5 — it does not import the real library. Reproduce the library's look (color ramp, radius, elevation, icon silhouettes) as faithfully as inline CSS allows. The **scaffolded** app MUST use the actual library named in the plan with its real theme provider — never a different library and never the preview's hand-rolled CSS.

---

## Quality gate (run this checklist before claiming the frontend is ready)

- [ ] Every region is styled to the library's visual language — **zero unstyled `<div class="card">` / `<div class="header">` placeholders**. (Scaffold: real imported primitives. Preview: inline-CSS HTML styled to match.)
- [ ] App shell carries the theme — scaffold wraps it in the library's theme provider; preview sets `:root` custom properties — with a brand ramp derived from Section 5 `primary`.
- [ ] Every icon is a real icon silhouette (scaffold: the library's icon package — shadcn/ui Lucide (`lucide-react`), Material `<mat-icon>name</mat-icon>`, Vuetify `mdi-*`, Skeleton/Pico Lucide/Tabler; preview: inline SVG matching that set). **No emoji, no `<svg viewBox="0 0 1 1">` placeholders.**
- [ ] Every image / avatar / thumbnail slot shows a **real sample image** — **no empty grey boxes**. Scaffold: bundled sample asset, a deterministic source keyed by id (`picsum.photos/seed/{id}/...`, `ui-avatars.com/api/?name=...`), or a themed inline-SVG thumbnail. Preview: a CSS-gradient or inline-SVG placeholder with the item's label.
- [ ] Every `form` region has at least one field with a visible validation state (warning/error) and an inline message.
- [ ] All four states (loading / error / empty / data) are present — scaffold via a dev-only toggle, preview depicted inline.
- [ ] `Style Direction:` is reflected in density and corner radius (e.g. "data-dense" → compact toolbars, tight list rows; "calm and spacious" → generous padding, larger cards).
- [ ] Scaffold only: no `any` types; auto-auth still works (if applicable).
- [ ] Preview only: single self-contained `index.html`, inline CSS, no external network, no build step.
