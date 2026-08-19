/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Spinner, Tooltip } from '@fluentui/react-components';
import { CommentEditRegular } from '@fluentui/react-icons';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { type PaletteEntry, type ScaffoldPlanSection, type PreviewPage, type PreviewStatus } from '../utils/parseScaffoldPlanMarkdown';

interface UiPreviewCardProps {
    /** The parsed "Design System & UI" plan section containing palette entries, style direction, and other design tokens. */
    section: ScaffoldPlanSection;
    /** When true, disables interactive controls (e.g. color pickers) while the plan is being revised. */
    disabled?: boolean;
    /**
     * HTML/CSS pages emitted by the planner agent into `.azure/.preview-temp/`
     * and pushed in by the controller. Each entry is either `pending` (no HTML
     * yet — show a "Generating preview…" panel) or `ready` (drop the inlined
     * HTML into an iframe via `srcDoc`).
     */
    previewPages: PreviewPage[];
    previewStatus?: PreviewStatus;
    /**
     * Called when the user picks a new hex for a palette token via the color
     * selector. The parent persists the new hex into the plan's palette so the
     * swatch and the eventual scaffold reflect it. The live preview is recolored
     * instantly inside this component (no feedback round-trip).
     */
    onPaletteChange: (token: string, originalHex: string, newHex: string) => void;
    /**
     * Called when the user clicks the "Edit" button for the active preview page.
     * The parent opens the feedback drawer with a note prepopulated for that page.
     */
    onEditPage: (pageTitle: string) => void;
}

/**
 * Append the trusted navigation bridge to a preview page's HTML. The bridge is
 * the ONLY script allowed to run in the preview iframe (author scripts are
 * stripped in `previewPagesReader`). It turns a click on a cross-page link
 * (`data-preview-nav="<slug>"`, produced by the reader) into a `previewNavigate`
 * message the card handles by switching tabs, and neutralizes any other
 * navigation so a stray link can't break the sandboxed `about:srcdoc` document.
 * It is stamped with the host CSP nonce so it satisfies the inherited
 * `script-src 'nonce-…'` policy; if the nonce is ever wrong the script is simply
 * blocked and the links fall back to inert `#` anchors (no navigation, but
 * nothing breaks).
 */
function withNavigationBridge(html: string, nonce: string): string {
    const bridge = `<script${nonce ? ` nonce="${nonce}"` : ''}>(function(){document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a'):null;if(!a)return;var slug=a.getAttribute('data-preview-nav');if(slug){e.preventDefault();parent.postMessage({command:'previewNavigate',slug:slug},'*');return;}var href=a.getAttribute('href')||'';if(href&&href.charAt(0)!=='#'){e.preventDefault();}},true);})();</script>`;
    return html.includes('</body>') ? html.replace('</body>', `${bridge}</body>`) : html + bridge;
}

/**
 * Read-only view of Section 6 (Design System & UI). The preview itself is a
 * sandboxed iframe loaded with planner-generated HTML/CSS; below it a per-color
 * hex selector lets the user recolor the design. Each pick is applied to the
 * iframe instantly by injecting CSS-variable overrides into the rendered HTML,
 * and bubbled up so the parent persists the new hex into the plan's palette.
 */
export const UiPreviewCard = ({ section, disabled, previewPages, previewStatus, onPaletteChange, onEditPage }: UiPreviewCardProps): JSX.Element | null => {
    const palette = useMemo(() => extractPalette(section), [section]);
    const styleDirection = useMemo(() => extractKeyValue(section, 'Style Direction'), [section]);

    const [activePageIdx, setActivePageIdx] = useState(0);
    // Live CSS-variable overrides keyed by `--color-*` name. Applied to the
    // iframe HTML on every render so a hex pick recolors the preview instantly.
    const [overrides, setOverrides] = useState<Record<string, string>>({});

    // CSP nonce from the host document — stamped onto the injected navigation
    // bridge so it satisfies the (inherited) `script-src 'nonce-…'` policy when it
    // runs inside the sandboxed srcdoc iframe. The base webview template renders
    // its bootstrap as `<script type="module" nonce="…">`, so read the nonce off
    // it (the `.nonce` IDL property returns the real value even after the DOM
    // hides the content attribute).
    const nonce = useMemo(() => {
        const el = document.querySelector('script[type="module"]') as HTMLScriptElement | null;
        return el?.nonce ?? '';
    }, []);

    // A click on an in-preview cross-page link posts its target slug up from the
    // sandboxed iframe (via the injected bridge); switch to that page's tab.
    useEffect(() => {
        const handler = (event: MessageEvent): void => {
            const data = event.data as { command?: string; slug?: string } | undefined;
            if (data?.command === 'previewNavigate' && typeof data.slug === 'string') {
                const idx = previewPages.findIndex(p => p.slug === data.slug);
                if (idx >= 0) {
                    setActivePageIdx(idx);
                }
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [previewPages]);

    // The card shows two things: the iframe preview and a color picker.
    // Render whenever either has content — if there's truly nothing to show,
    // fall back to letting `SectionCard` handle Section 6 instead.
    const hasPages = previewPages.length > 0;

    const activePage: PreviewPage | undefined = hasPages
        ? previewPages[Math.min(activePageIdx, previewPages.length - 1)]
        : undefined;
    const isLoading = !activePage || activePage.status !== 'ready' || !activePage.html || previewStatus === 'generating';

    // Colors the preview inherits from the plan's palette, keyed by the same
    // `--color-*` custom properties the generated `theme.css` uses. Applying
    // these as overrides makes the iframe reflect the *current plan palette* on
    // every load — so a color the user changed (and that was persisted back into
    // the plan) shows correctly when they reopen the view, even though the
    // generated `theme.css` still holds the original value.
    const baseOverrides = useMemo(() => {
        const map: Record<string, string> = {};
        for (const entry of palette) {
            map[cssVarForToken(entry.token)] = entry.hex;
        }
        return map;
    }, [palette]);

    // Re-render the page HTML with the plan palette plus the user's live picks
    // inlined as a trailing `:root { … }` block so the iframe recolors the moment
    // a hex is picked — no regeneration, no feedback round-trip.
    const displayedHtml = useMemo(
        () => (activePage?.html ? withNavigationBridge(applyOverrides(activePage.html, { ...baseOverrides, ...overrides }), nonce) : undefined),
        [activePage?.html, baseOverrides, overrides, nonce],
    );

    if (palette.length === 0 && !hasPages) {
        return null;
    }

    // Picking a hex recolors the iframe instantly via a CSS-variable override
    // and bubbles the new value up so the parent persists it into the plan.
    const handleColorPick = (entry: PaletteEntry, newHex: string): void => {
        const cssVar = cssVarForToken(entry.token);
        setOverrides(prev => ({ ...prev, [cssVar]: newHex }));
        onPaletteChange(entry.token, entry.hex, newHex);
    };

    return (
        <div className='sectionCard uiPreviewCard'>
            <div className='uiPreviewCard__header'>
                <h2>UI Preview</h2>
            </div>
            {styleDirection && <p className='uiPreviewCard__styleDirection'>{styleDirection}</p>}

            {/* Preview toolbar: page tabs on the left, an Edit box on the right
                that opens the feedback drawer prepopulated for the active page. */}
            {hasPages && (
                <div className='uiPreviewCard__previewBar'>
                    {previewPages.length > 1 ? (
                        <div className='uiPreviewCard__tabs' role='tablist' aria-label='Preview page'>
                            {previewPages.map((p, i) => (
                                <button
                                    key={`${p.slug}-${i}`}
                                    role='tab'
                                    aria-selected={i === activePageIdx}
                                    className={`uiPreviewCard__tab ${i === activePageIdx ? 'uiPreviewCard__tab--active' : ''}`}
                                    onClick={() => setActivePageIdx(i)}
                                >
                                    {p.title}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <span className='uiPreviewCard__tabsSpacer' />
                    )}
                    {activePage && (
                        <div className='uiPreviewCard__editBox'>
                            <Tooltip content='Request page-specific changes' relationship='label'>
                                <Button
                                    appearance='subtle'
                                    size='small'
                                    icon={<CommentEditRegular />}
                                    aria-label='Request page-specific changes'
                                    disabled={disabled}
                                    onClick={() => onEditPage(activePage.title)}
                                />
                            </Tooltip>
                        </div>
                    )}
                </div>
            )}

            <div className='uiPreviewCard__frame'>
                {isLoading ? (
                    // Show a spinner whenever the preview is being generated (first
                    // load or regeneration) in place of the iframe.
                    <div className='uiPreviewCard__loading' role='status' aria-live='polite'>
                        <Spinner size='medium' label='Generating preview…' />
                    </div>
                ) : (
                    <iframe
                        className='uiPreviewCard__iframe'
                        title={`UI preview for ${activePage.title}`}
                        srcDoc={displayedHtml}
                        sandbox='allow-same-origin allow-scripts'
                    />
                )}
            </div>

            {palette.length > 0 && (
                <div className='uiPreviewCard__paletteRow'>
                    <span className='uiPreviewCard__paletteLabel'>Colors</span>
                    <p className='uiPreviewCard__paletteHint'>Pick a color to recolor the preview instantly.</p>
                    <ul className='uiPreviewCard__paletteList'>
                        {palette.map((entry) => {
                            const cssVar = cssVarForToken(entry.token);
                            const currentHex = overrides[cssVar] ?? entry.hex;
                            const inputId = `palette-${entry.token.replace(/[^a-z0-9]+/gi, '-')}`;
                            const label = friendlyToken(entry.token);
                            return (
                                <li key={entry.token} className='uiPreviewCard__paletteItem'>
                                    <input
                                        id={inputId}
                                        type='color'
                                        className='uiPreviewCard__colorInput'
                                        value={normalizeHex(currentHex)}
                                        disabled={disabled}
                                        onChange={(e) => handleColorPick(entry, e.target.value)}
                                        aria-label={entry.usage ? `Color for ${label} — ${entry.usage}` : `Color for ${label}`}
                                    />
                                    <label htmlFor={inputId} className='uiPreviewCard__paletteText' title={entry.usage || undefined}>
                                        <span className='uiPreviewCard__paletteName'>{label}</span>
                                        <span className='uiPreviewCard__paletteHex'>{normalizeHex(currentHex).toUpperCase()}</span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
};

function extractPalette(section: ScaffoldPlanSection): PaletteEntry[] {
    for (const item of section.content) {
        if (item.type === 'colorPalette') {
            return item.entries;
        }
    }
    return [];
}

function extractKeyValue(section: ScaffoldPlanSection, key: string): string | undefined {
    for (const item of section.content) {
        if (item.type === 'keyValue' && item.key === key) {
            return item.value;
        }
    }
    return undefined;
}

/**
 * Map a plan palette token name onto a `theme.css` CSS custom property so a hex
 * pick recolors the matching part of the preview. The planner's `theme.css`
 * declares `--color-primary`, `--color-accent`, `--color-surface`, etc., so the
 * common semantic tokens are matched explicitly; anything unrecognized falls
 * back to a kebab-cased `--color-<token>`. Order matters: the `on *` checks run
 * before the bare `primary` / `accent` checks.
 */
function cssVarForToken(token: string): string {
    const t = token.toLowerCase();
    if (/on[ -]?primary/.test(t)) {
        return '--color-on-primary';
    }
    if (/on[ -]?accent/.test(t)) {
        return '--color-on-accent';
    }
    if (t.includes('primary')) {
        return '--color-primary';
    }
    if (t.includes('accent') || t.includes('secondary')) {
        return '--color-accent';
    }
    if (t.includes('surface') || t.includes('background') || t.includes('canvas')) {
        return '--color-surface';
    }
    if (t.includes('muted') || t.includes('subtle')) {
        return '--color-muted';
    }
    if (t.includes('border') || t.includes('outline') || t.includes('divider')) {
        return '--color-border';
    }
    if (t.includes('text') || t.includes('foreground') || t.includes('ink')) {
        return '--color-text';
    }
    if (t.includes('success')) {
        return '--color-success';
    }
    if (t.includes('warning')) {
        return '--color-warning';
    }
    if (t.includes('danger') || t.includes('error')) {
        return '--color-danger';
    }
    return `--color-${t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

/**
 * Inline the user's live color overrides as a trailing `:root { … }` block so
 * the iframe recolors instantly. A later same-specificity `:root` rule wins, and
 * `!important` guards against any inlined rule that might also be marked so.
 */
function applyOverrides(html: string, overrides: Record<string, string>): string {
    const vars = Object.keys(overrides);
    if (vars.length === 0) {
        return html;
    }
    const decls = vars.map(v => `${v}: ${overrides[v]} !important;`).join(' ');
    const styleBlock = `<style id="__live-palette-overrides">:root { ${decls} }</style>`;
    if (html.includes('</head>')) {
        return html.replace('</head>', `${styleBlock}</head>`);
    }
    if (html.includes('</body>')) {
        return html.replace('</body>', `${styleBlock}</body>`);
    }
    return html + styleBlock;
}

/**
 * Coerce an arbitrary palette hex into the strict `#rrggbb` form that a native
 * `<input type="color">` requires: prepend `#`, expand `#rgb` shorthand, and
 * drop any alpha channel. Falls back to black for unparseable values.
 */
function normalizeHex(hex: string): string {
    let h = (hex ?? '').trim();
    if (!h.startsWith('#')) {
        h = `#${h}`;
    }
    if (/^#[0-9a-fA-F]{3}$/.test(h)) {
        h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
    }
    if (/^#[0-9a-fA-F]{8}$/.test(h)) {
        h = h.slice(0, 7);
    }
    return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : '#000000';
}

/**
 * Turn a raw palette token (`onPrimary`, `on-primary`, `surface`) into a
 * human-readable label for the rare case a palette entry has no `usage` text.
 */
function friendlyToken(token: string): string {
    const spaced = token
        .replace(/[-_]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
