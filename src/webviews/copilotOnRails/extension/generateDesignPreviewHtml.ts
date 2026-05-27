/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PlanContent, type PlanData, type PlanSection } from "../views/utils/parseScaffoldPlanMarkdown";

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{3,8}$/;

interface DesignSpec {
    componentLibrary: string;
    typography?: string;
    styleDirection?: string;
    palette: PaletteEntry[];
    pages: PageSpec[];
}

interface PaletteEntry {
    token: string;
    hex: string;
}

interface PageSpec {
    name: string;
    route?: string;
    regions: ParsedRegion[];
}

interface ParsedRegion {
    token: string;
    label: string;
    children?: ParsedRegion[];
    orientation?: 'vertical' | 'horizontal';
}

/**
 * Build a self-contained HTML preview from the parsed plan's Design System
 * section. Returns undefined if the plan has no usable design content (no
 * component library + no pages) — caller should skip preview generation.
 */
export function generateDesignPreviewHtml(plan: PlanData): string | undefined {
    const spec = extractDesignSpec(plan);
    if (!spec) {
        return undefined;
    }
    return renderHtml(spec);
}

/**
 * Build a scoped HTML fragment (style + markup + script) for embedding the
 * preview inside the plan webview. All CSS selectors are scoped under
 * `.dpEmbed` so they don't leak into the host webview, and the script's
 * queries / CSS-var writes target the wrapper element only.
 */
export function generateEmbeddedDesignPreviewHtml(plan: PlanData): string | undefined {
    const spec = extractDesignSpec(plan);
    if (!spec) {
        return undefined;
    }
    return renderEmbeddedFragment(spec);
}

function extractDesignSpec(plan: PlanData): DesignSpec | undefined {
    const section = plan.sections.find(s => s.title.toLowerCase().includes('design system'));
    if (!section) {
        return undefined;
    }

    const kvFor = (key: string): string | undefined => {
        const found = section.content.find(c => c.type === 'keyValue' && c.key.toLowerCase() === key.toLowerCase());
        return found?.type === 'keyValue' ? found.value : undefined;
    };

    const componentLibrary = (kvFor('Component Library') ?? '').trim();
    const typography = kvFor('Typography')?.trim();
    const styleDirection = kvFor('Style Direction')?.trim();

    const palette = extractPalette(section);
    const pages = extractPages(section);

    if ((!componentLibrary || componentLibrary === '—') && pages.length === 0) {
        return undefined;
    }

    return {
        componentLibrary: componentLibrary || 'Custom CSS',
        typography,
        styleDirection,
        palette,
        pages,
    };
}

function extractPalette(section: PlanSection): PaletteEntry[] {
    const tables = section.content.filter((c): c is Extract<PlanContent, { type: 'table' }> => c.type === 'table');
    const swatchTable = tables.find(t => t.headers.length >= 2 && t.rows.some(r => HEX_COLOR_RE.test((r[1] ?? '').trim())));
    if (!swatchTable) {
        return [];
    }
    return swatchTable.rows
        .map(r => ({ token: (r[0] ?? '').trim(), hex: (r[1] ?? '').trim() }))
        .filter(e => HEX_COLOR_RE.test(e.hex));
}

function extractPages(section: PlanSection): PageSpec[] {
    const tables = section.content.filter((c): c is Extract<PlanContent, { type: 'table' }> => c.type === 'table');
    const pagesTable = tables.find(t => t.headers.some(h => h.toLowerCase() === 'layout'));
    if (!pagesTable) {
        return [];
    }
    const layoutIdx = pagesTable.headers.findIndex(h => h.toLowerCase() === 'layout');
    const routeIdx = pagesTable.headers.findIndex(h => h.toLowerCase() === 'route');
    return pagesTable.rows.map((row, i) => ({
        name: (row[0] ?? `Page ${i + 1}`).trim(),
        route: routeIdx >= 0 ? stripBackticks((row[routeIdx] ?? '').trim()) : undefined,
        regions: parseLayoutCell(row[layoutIdx] ?? ''),
    }));
}

function parseLayoutCell(layout: string): ParsedRegion[] {
    if (!layout || layout.trim().length === 0) {
        return [{ token: 'placeholder', label: 'layout TBD' }];
    }
    const tokens: string[] = [];
    let depth = 0;
    let buf = '';
    for (const ch of layout) {
        if (ch === '(') { depth++; buf += ch; continue; }
        if (ch === ')') { depth--; buf += ch; continue; }
        if (ch === ',' && depth === 0) {
            if (buf.trim()) { tokens.push(buf.trim()); }
            buf = '';
            continue;
        }
        buf += ch;
    }
    if (buf.trim()) { tokens.push(buf.trim()); }
    return tokens.map(parseRegionToken).filter((r): r is ParsedRegion => r !== null);
}

function parseRegionToken(raw: string): ParsedRegion | null {
    const trimmed = raw.trim();
    if (!trimmed) { return null; }
    const composite = trimmed.match(/^(two-column|split)\s*\(\s*(.+?)\s*\)$/i);
    if (composite) {
        const isSplit = composite[1].toLowerCase() === 'split';
        const parts = composite[2].split(isSplit ? '|' : '+').map(p => p.trim()).filter(Boolean);
        return {
            token: composite[1].toLowerCase(),
            label: composite[0],
            orientation: 'horizontal',
            children: parts.map(p => ({ token: 'pane', label: p })),
        };
    }
    return { token: trimmed.toLowerCase(), label: trimmed };
}

function stripBackticks(s: string): string {
    return s.replace(/^`+|`+$/g, '');
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
}

function paletteVar(palette: PaletteEntry[], token: string, fallback: string): string {
    const entry = palette.find(e => e.token.toLowerCase() === token.toLowerCase());
    return entry?.hex ?? fallback;
}

function paletteSlug(token: string): string {
    return token.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'token';
}

// Re-exported so the controller can map slugs (sent by the webview color
// picker) back to plan-palette row tokens when rewriting preview/index.html.
export { paletteSlug };

/**
 * Rewrite the hex column of the Color Palette markdown table in-place so
 * picker edits survive the next plan regeneration. We only touch rows that
 * already have a bare hex in column 2 — header and separator lines won't
 * match, and template placeholder rows like `| Primary | {#0078D4} |` are
 * left alone so we never accidentally fill in a draft plan.
 */
export function rewritePaletteInPlanMarkdown(
    markdown: string,
    overrideBySlug: Map<string, string>,
): string {
    if (overrideBySlug.size === 0) {
        return markdown;
    }
    const lines = markdown.split('\n');
    let inColorPalette = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^###\s+Color\s+Palette\b/i.test(line)) {
            inColorPalette = true;
            continue;
        }
        if (inColorPalette && /^(?:##\s|###\s|----*\s*$)/.test(line)) {
            inColorPalette = false;
            // Fall through so the new section header is also evaluated below.
        }
        if (!inColorPalette) {
            continue;
        }
        const m = line.match(/^(\|\s*)([^|]+?)(\s*\|\s*)(#[0-9A-Fa-f]{3,8})(\s*\|.*)$/);
        if (!m) {
            continue;
        }
        const override = overrideBySlug.get(paletteSlug(m[2].trim()));
        if (!override) {
            continue;
        }
        lines[i] = `${m[1]}${m[2]}${m[3]}${override.toUpperCase()}${m[5]}`;
    }
    return lines.join('\n');
}

// `<input type="color">` only accepts #rrggbb. Expand #rgb shorthand, drop
// alpha from #rrggbbaa, and reject anything that doesn't look like a hex color.
function normalizeHex(hex: string): string {
    const m = hex.match(/^#([0-9a-f]{3,8})$/i);
    if (!m) { return '#000000'; }
    const h = m[1].toLowerCase();
    if (h.length === 3) {
        return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    if (h.length === 6) {
        return `#${h}`;
    }
    if (h.length === 8) {
        return `#${h.substring(0, 6)}`;
    }
    return '#000000';
}

function renderHtml(spec: DesignSpec): string {
    const styles = buildPreviewCss(spec);
    const body = buildPreviewBody(spec);
    const script = buildPreviewScript(':root');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Design Preview</title>
<style>${styles}</style>
</head>
<body>
${body}
${script}
</body>
</html>
`;
}

function renderEmbeddedFragment(spec: DesignSpec): string {
    const scope = '.dpEmbed';
    const styles = scopeCss(buildPreviewCss(spec), scope);
    const body = buildPreviewBody(spec);

    // Note: NO <script> tag. The host plan webview enforces a strict CSP
    // (`script-src cspSource 'nonce-${nonce}'`) that blocks any inline
    // <script> embedded here, even when cloned into a fresh element after
    // innerHTML injection. Page-tab switching and the live color picker are
    // wired up from the React component (`DesignSystemCard`) instead, which
    // runs in the trusted bundle and can attach event listeners directly.
    return `<style>${styles}</style>
<div class="dpEmbed">
${body}
</div>`;
}

// Mechanically prefix every CSS rule in the generated stylesheet with `scope`.
// We rely on the generated CSS being flat (no @media, no nesting, single-line
// or simple multi-line rules), so a regex pass is sufficient.
function scopeCss(css: string, scope: string): string {
    if (!scope) { return css; }
    return css.replace(/([^{}]+)\{([^}]*)\}/g, (_match, rawSelectors: string, body: string) => {
        const selectors = rawSelectors
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .map(s => {
                if (s === ':root' || s === 'html' || s === 'body') { return scope; }
                if (s === '*') { return `${scope}, ${scope} *`; }
                return `${scope} ${s}`;
            });
        const deduped = Array.from(new Set(selectors)).join(', ');
        return `${deduped} { ${body.trim()} }`;
    });
}

function buildPreviewCss(spec: DesignSpec): string {
    const fontFamily = spec.typography ? cssFontFamily(spec.typography) : "'Inter', system-ui, -apple-system, sans-serif";
    const primary = paletteVar(spec.palette, 'Primary', '#0078D4');
    const accent = paletteVar(spec.palette, 'Accent', '#FFB900');
    const neutral = paletteVar(spec.palette, 'Neutral', '#323130');
    const surface = paletteVar(spec.palette, 'Surface', '#FAF9F8');
    const success = paletteVar(spec.palette, 'Success', '#107C10');
    const warning = paletteVar(spec.palette, 'Warning', '#F7630C');
    const danger = paletteVar(spec.palette, 'Danger', '#D13438');

    // Per-palette CSS vars so non-standard tokens still get a `--color-${slug}`
    // var the chip background can bind to. Standard slugs (primary/accent/…)
    // will overwrite the hardcoded values above with the user's chosen hex.
    const paletteRootVars = spec.palette
        .map(p => `            --color-${paletteSlug(p.token)}: ${normalizeHex(p.hex)};`)
        .join('\n');

    return `
        :root {
            --color-primary: ${primary};
            --color-accent: ${accent};
            --color-neutral: ${neutral};
            --color-surface: ${surface};
            --color-success: ${success};
            --color-warning: ${warning};
            --color-danger: ${danger};
${paletteRootVars}
            --color-border: rgba(0, 0, 0, 0.1);
            --color-muted: rgba(0, 0, 0, 0.55);
            --radius: 6px;
            --font-body: ${fontFamily};
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; font-family: var(--font-body); color: var(--color-neutral); background: var(--color-surface); }
        body { padding: 24px; }
        .previewBanner {
            background: rgba(0, 0, 0, 0.04);
            border: 1px dashed var(--color-border);
            border-radius: var(--radius);
            padding: 10px 14px;
            margin-bottom: 18px;
            font-size: 13px;
            color: var(--color-muted);
        }
        .previewBanner strong { color: var(--color-neutral); }
        .pageTabs {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 16px;
        }
        .pageTab {
            background: transparent;
            border: 1px solid var(--color-border);
            color: var(--color-neutral);
            border-radius: 999px;
            padding: 6px 14px;
            font: inherit;
            font-size: 12px;
            cursor: pointer;
        }
        .pageTab[aria-selected="true"] {
            background: var(--color-primary);
            color: #fff;
            border-color: var(--color-primary);
        }
        .pageFrame {
            background: #fff;
            border: 1px solid var(--color-border);
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.05);
            display: none;
        }
        .pageFrame.active { display: block; }
        .browserChrome {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 12px;
            background: #f3f3f3;
            border-bottom: 1px solid var(--color-border);
        }
        .browserChrome .dot { width: 10px; height: 10px; border-radius: 50%; background: #ccc; }
        .browserChrome .url {
            flex: 1;
            margin-left: 8px;
            font-family: ui-monospace, 'Cascadia Mono', Menlo, monospace;
            font-size: 12px;
            color: var(--color-muted);
            background: #fff;
            border-radius: 4px;
            padding: 4px 10px;
            border: 1px solid var(--color-border);
        }
        .pageBody { display: flex; flex-direction: column; }
        .region {
            padding: 16px 18px;
            border-bottom: 1px solid var(--color-border);
        }
        .region:last-child { border-bottom: none; }
        .region-header { background: #fff; display: flex; align-items: center; justify-content: space-between; }
        .region-header h1 { margin: 0; font-size: 18px; }
        .region-header .actions { display: flex; gap: 8px; }
        .region-nav { background: #fafafa; padding: 10px 18px; }
        .region-nav ul { list-style: none; padding: 0; margin: 0; display: flex; gap: 18px; }
        .region-nav a { color: var(--color-neutral); text-decoration: none; font-size: 13px; }
        .region-nav a.active { color: var(--color-primary); font-weight: 600; }
        .region-sidebar { background: #fafafa; }
        .region-sidebar ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
        .region-sidebar a { color: var(--color-neutral); text-decoration: none; font-size: 13px; padding: 6px 10px; border-radius: 4px; display: block; }
        .region-sidebar a.active { background: var(--color-primary); color: #fff; }
        .region-hero {
            background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
            color: #fff;
            padding: 40px 24px;
            text-align: center;
        }
        .region-hero h1 { margin: 0 0 8px 0; font-size: 28px; }
        .region-hero p { margin: 0; opacity: 0.9; }
        .region-main p { margin: 0 0 10px 0; line-height: 1.5; }
        .region-list ul { padding-left: 18px; margin: 0; }
        .region-list li { padding: 4px 0; }
        .region-card-list, .region-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 12px;
        }
        .region-card-list .card, .region-grid .tile {
            background: #fff;
            border: 1px solid var(--color-border);
            border-radius: var(--radius);
            padding: 14px;
        }
        .region-card-list .card h3 { margin: 0 0 6px 0; font-size: 14px; }
        .region-card-list .card p { margin: 0; color: var(--color-muted); font-size: 13px; }
        .region-grid .tile { height: 64px; display: flex; align-items: center; justify-content: center; color: var(--color-muted); font-size: 12px; }
        .region-form { display: flex; flex-direction: column; gap: 12px; max-width: 480px; }
        .region-form label { font-size: 13px; color: var(--color-muted); }
        .region-form input, .region-form select, .region-form textarea {
            font: inherit;
            padding: 8px 10px;
            border: 1px solid var(--color-border);
            border-radius: 4px;
            background: #fff;
        }
        .region-form .formRow { display: flex; flex-direction: column; gap: 4px; }
        .region-table table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .region-table th, .region-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--color-border); }
        .region-table th { background: #fafafa; font-weight: 600; }
        .region-actions, .region-action-bar { display: flex; gap: 8px; justify-content: flex-end; }
        .region-tabs { display: flex; gap: 0; padding: 0; }
        .region-tabs .tab { padding: 8px 14px; border-bottom: 2px solid transparent; font-size: 13px; color: var(--color-muted); cursor: default; }
        .region-tabs .tab.active { color: var(--color-primary); border-bottom-color: var(--color-primary); font-weight: 600; }
        .region-modal { background: rgba(0, 0, 0, 0.04); padding: 32px; }
        .region-modal .modalCard {
            max-width: 360px; margin: 0 auto; background: #fff;
            border: 1px solid var(--color-border); border-radius: 8px;
            padding: 16px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
        }
        .region-footer { background: #fafafa; color: var(--color-muted); font-size: 12px; text-align: center; }
        .region-two-column, .region-split { padding: 0; }
        .region-two-column .panes, .region-split .panes { display: flex; min-height: 160px; }
        .region-two-column .pane, .region-split .pane { flex: 1; padding: 16px 18px; }
        .region-split .pane + .pane { border-left: 1px solid var(--color-border); }
        .region-two-column .pane + .pane { border-left: 1px solid var(--color-border); background: #fafafa; }
        .region-placeholder, .region-unknown {
            background: repeating-linear-gradient(45deg, #fafafa, #fafafa 6px, #f0f0f0 6px, #f0f0f0 12px);
            color: var(--color-muted);
            text-align: center;
            font-size: 12px;
            padding: 24px;
        }
        .btn {
            font: inherit; font-size: 13px;
            padding: 6px 14px; border-radius: 4px; cursor: default;
            border: 1px solid transparent;
        }
        .btn-primary { background: var(--color-primary); color: #fff; }
        .btn-secondary { background: transparent; color: var(--color-primary); border-color: var(--color-primary); }
        .btn-ghost { background: transparent; color: var(--color-neutral); border-color: var(--color-border); }
        .badge {
            display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px;
            background: var(--color-accent); color: var(--color-neutral);
        }
        .paletteRow { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 10px; }
        .paletteSwatch {
            display: inline-flex; align-items: center; gap: 6px;
            font-size: 12px; color: var(--color-muted);
            padding: 4px 6px; border-radius: 4px;
            cursor: pointer; user-select: none;
            transition: background 120ms ease;
        }
        .paletteSwatch:hover { background: rgba(0, 0, 0, 0.05); }
        .paletteSwatch:focus-within { outline: 2px solid var(--color-primary); outline-offset: 1px; }
        .paletteChip {
            position: relative;
            width: 18px; height: 18px; border-radius: 4px;
            border: 1px solid var(--color-border);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
        }
        .paletteSwatch input[type="color"] {
            position: absolute; inset: 0;
            width: 100%; height: 100%;
            opacity: 0; cursor: pointer;
            border: none; padding: 0; background: transparent;
        }
        .paletteHex { font-family: ui-monospace, 'Cascadia Mono', Menlo, monospace; }
        .paletteReset {
            font: inherit; font-size: 11px;
            padding: 4px 10px; border-radius: 4px;
            background: transparent; color: var(--color-muted);
            border: 1px solid var(--color-border);
            cursor: pointer;
        }
        .paletteReset:hover { color: var(--color-neutral); border-color: var(--color-neutral); }
        .paletteReset[hidden] { display: none; }
    `;
}

function buildPreviewBody(spec: DesignSpec): string {
    const palette = spec.palette.map(p => ({ token: p.token, slug: paletteSlug(p.token), hex: normalizeHex(p.hex) }));

    const paletteMarkup = palette.length === 0 ? '' : `
        <div class="paletteRow" role="group" aria-label="Color palette">
            ${palette.map(p => `
                <label class="paletteSwatch" title="Click to edit ${escapeHtml(p.token)}">
                    <span class="paletteChip" style="background: var(--color-${escapeHtml(p.slug)});">
                        <input type="color"
                            data-token="${escapeHtml(p.slug)}"
                            data-initial="${escapeHtml(p.hex)}"
                            value="${escapeHtml(p.hex)}"
                            aria-label="${escapeHtml(p.token)} color" />
                    </span>
                    <span>${escapeHtml(p.token)}</span>
                    <code class="paletteHex" data-token="${escapeHtml(p.slug)}">${escapeHtml(p.hex.toUpperCase())}</code>
                </label>
            `).join('')}
            <button type="button" class="paletteReset" hidden>Reset colors</button>
        </div>
    `;

    const banner = `
        <div class="previewBanner">
            <strong>Design preview</strong> — rough HTML/CSS prototype generated from your project plan's
            Design System section (${escapeHtml(spec.componentLibrary)}${spec.typography ? `, ${escapeHtml(spec.typography)}` : ''}).
            ${spec.styleDirection ? `<div style="margin-top:6px;font-style:italic;">${escapeHtml(spec.styleDirection)}</div>` : ''}
            ${paletteMarkup}
        </div>
    `;

    const tabs = spec.pages.length === 0 ? '' : `
        <div class="pageTabs" role="tablist">
            ${spec.pages.map((p, i) => `<button class="pageTab" role="tab" data-page="${escapeHtml(slugify(p.name))}" aria-selected="${i === 0 ? 'true' : 'false'}">${escapeHtml(p.name)}</button>`).join('')}
        </div>
    `;

    const pages = spec.pages.length === 0
        ? `<div class="previewBanner">No pages defined in Section 5. Add a <code>### Pages</code> table to the plan to see per-page wireframes.</div>`
        : spec.pages.map((p, i) => `
            <div class="pageFrame ${i === 0 ? 'active' : ''}" data-page="${escapeHtml(slugify(p.name))}">
                <div class="browserChrome">
                    <span class="dot" style="background:#ff5f57"></span>
                    <span class="dot" style="background:#febc2e"></span>
                    <span class="dot" style="background:#28c840"></span>
                    <span class="url">${escapeHtml(p.route ?? '/')}</span>
                </div>
                <div class="pageBody">
                    ${p.regions.map(r => renderRegion(r, p.name)).join('')}
                </div>
            </div>
        `).join('');

    return `${banner}\n${tabs}\n${pages}`;
}

// `rootSelector` resolves to the element that owns the CSS vars and scopes all
// queries. Use `:root` for the standalone full-document preview, or a wrapper
// class like `.dpEmbed` for the embedded fragment inside the plan webview.
function buildPreviewScript(rootSelector: string): string {
    const selectorLiteral = JSON.stringify(rootSelector);
    return `
        <script>
            (function() {
                var root = document.querySelector(${selectorLiteral}) || document.documentElement;
                var tabs = root.querySelectorAll('.pageTab');
                var frames = root.querySelectorAll('.pageFrame');
                tabs.forEach(function(tab) {
                    tab.addEventListener('click', function() {
                        var target = tab.getAttribute('data-page');
                        tabs.forEach(function(t) { t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
                        frames.forEach(function(f) { f.classList.toggle('active', f.getAttribute('data-page') === target); });
                    });
                });

                var inputs = root.querySelectorAll('.paletteSwatch input[type="color"]');
                var resetBtn = root.querySelector('.paletteReset');
                function syncResetVisibility() {
                    if (!resetBtn) { return; }
                    var dirty = false;
                    inputs.forEach(function(i) {
                        if (i.value.toLowerCase() !== (i.getAttribute('data-initial') || '').toLowerCase()) { dirty = true; }
                    });
                    resetBtn.hidden = !dirty;
                }
                function applyColor(input) {
                    var token = input.getAttribute('data-token');
                    var value = input.value;
                    root.style.setProperty('--color-' + token, value);
                    var hexEl = root.querySelector('.paletteHex[data-token="' + token + '"]');
                    if (hexEl) { hexEl.textContent = value.toUpperCase(); }
                }
                inputs.forEach(function(input) {
                    input.addEventListener('input', function() { applyColor(input); syncResetVisibility(); });
                    input.addEventListener('change', function() { applyColor(input); syncResetVisibility(); });
                });
                if (resetBtn) {
                    resetBtn.addEventListener('click', function() {
                        inputs.forEach(function(input) {
                            var initial = input.getAttribute('data-initial');
                            if (initial) {
                                input.value = initial;
                                applyColor(input);
                            }
                        });
                        syncResetVisibility();
                    });
                }
            })();
        </script>
    `;
}

function cssFontFamily(typography: string): string {
    // Typography KV is free text. Best-effort: pull the first font name and
    // append a sensible fallback stack. Anything quoted stays as-is.
    const first = typography.split(',')[0].trim();
    if (!first) {
        return "system-ui, -apple-system, sans-serif";
    }
    const quoted = /\s/.test(first) ? `'${first.replace(/'/g, '')}'` : first;
    return `${quoted}, system-ui, -apple-system, sans-serif`;
}

function renderRegion(region: ParsedRegion, pageName: string): string {
    const cls = `region region-${region.token}`;
    switch (region.token) {
        case 'header':
            return `<div class="${cls}"><h1>${escapeHtml(pageName)}</h1><div class="actions"><button class="btn btn-ghost">Settings</button><button class="btn btn-primary">New</button></div></div>`;
        case 'nav':
            return `<div class="${cls}"><ul><li><a class="active" href="#">${escapeHtml(pageName)}</a></li><li><a href="#">Section</a></li><li><a href="#">Section</a></li><li><a href="#">About</a></li></ul></div>`;
        case 'sidebar':
            return `<div class="${cls}"><ul><li><a class="active" href="#">${escapeHtml(pageName)}</a></li><li><a href="#">Dashboard</a></li><li><a href="#">Reports</a></li><li><a href="#">Settings</a></li></ul></div>`;
        case 'hero':
            return `<div class="${cls}"><h1>${escapeHtml(pageName)}</h1><p>${escapeHtml(region.label === 'hero' ? 'A compelling one-liner about this page goes here.' : region.label)}</p></div>`;
        case 'main':
            return `<div class="${cls}"><p>Main content for <strong>${escapeHtml(pageName)}</strong>. This is placeholder body copy generated from the plan; replace with real content when scaffolding builds the page.</p><p>Use the palette and typography defined in Section 5 of the plan.</p></div>`;
        case 'list':
            return `<div class="${cls}"><ul><li>Item one</li><li>Item two</li><li>Item three</li><li>Item four</li></ul></div>`;
        case 'card-list':
            return `<div class="${cls}">${[1, 2, 3, 4].map(n => `<div class="card"><h3>Card ${n}</h3><p>Short description of card ${n}.</p></div>`).join('')}</div>`;
        case 'grid':
            return `<div class="${cls}">${[1, 2, 3, 4, 5, 6].map(n => `<div class="tile">Tile ${n}</div>`).join('')}</div>`;
        case 'form':
            return `<div class="${cls}"><div class="formRow"><label>Name</label><input type="text" placeholder="Enter name" /></div><div class="formRow"><label>Email</label><input type="email" placeholder="you@example.com" /></div><div class="formRow"><label>Notes</label><textarea rows="3" placeholder="Optional notes"></textarea></div><div><button class="btn btn-primary">Save</button> <button class="btn btn-ghost">Cancel</button></div></div>`;
        case 'table':
            return `<div class="${cls}"><table><thead><tr><th>Name</th><th>Status</th><th>Updated</th></tr></thead><tbody>${[1, 2, 3, 4].map(n => `<tr><td>Row ${n}</td><td><span class="badge">Active</span></td><td>2 hours ago</td></tr>`).join('')}</tbody></table></div>`;
        case 'actions':
        case 'action-bar':
            return `<div class="${cls}"><button class="btn btn-ghost">Cancel</button><button class="btn btn-secondary">Save draft</button><button class="btn btn-primary">Submit</button></div>`;
        case 'tabs':
            return `<div class="${cls}"><div class="tab active">Overview</div><div class="tab">Details</div><div class="tab">Activity</div></div>`;
        case 'modal':
            return `<div class="${cls}"><div class="modalCard"><h3 style="margin:0 0 8px 0;">Confirm action</h3><p style="margin:0 0 12px 0;color:var(--color-muted);font-size:13px;">This dialog is part of the planned UX for ${escapeHtml(pageName)}.</p><div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn btn-ghost">Cancel</button><button class="btn btn-primary">Confirm</button></div></div></div>`;
        case 'footer':
            return `<div class="${cls}">© ${new Date().getFullYear()} — preview generated from project plan</div>`;
        case 'two-column':
        case 'split': {
            const panes = (region.children ?? []).map(c => `<div class="pane"><strong>${escapeHtml(c.label)}</strong><p style="color:var(--color-muted);font-size:13px;margin:6px 0 0 0;">Pane content placeholder.</p></div>`).join('');
            return `<div class="${cls}"><div class="panes">${panes}</div></div>`;
        }
        case 'placeholder':
            return `<div class="${cls}">Layout TBD</div>`;
        default:
            return `<div class="region region-unknown">${escapeHtml(region.label)}</div>`;
    }
}
