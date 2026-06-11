/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Spinner } from '@fluentui/react-components';
import { useMemo, useState, type JSX } from 'react';
import { type PaletteEntry, type PlanSection, type PreviewPage } from '../utils/parseScaffoldPlanMarkdown';

interface UiPreviewCardProps {
    section: PlanSection;
    disabled?: boolean;
    /**
     * HTML/CSS pages emitted by the planner agent into `.azure/.preview-temp/`
     * and pushed in by the controller. Each entry is either `pending` (no HTML
     * yet — show a "Generating preview…" panel) or `ready` (drop the inlined
     * HTML into an iframe via `srcDoc`).
     */
    previewPages: PreviewPage[];
    /**
     * Called for each palette token whose color changes when the user picks a
     * theme. The parent records the true original hex on the first change.
     */
    onPaletteChange: (token: string, originalHex: string, newHex: string) => void;
}

/**
 * Read-only view of Section 5 (Design System & UI). The wireframe itself is a
 * sandboxed iframe loaded with planner-generated HTML/CSS; below it a curated
 * color-theme picker lets the user recolor the whole design in one click —
 * each token change is bubbled up so the parent mirrors it into the feedback
 * drawer.
 */
export const UiPreviewCard = ({ section, disabled, previewPages, onPaletteChange }: UiPreviewCardProps): JSX.Element | null => {
    const palette = useMemo(() => extractPalette(section), [section]);
    const styleDirection = useMemo(() => extractKeyValue(section, 'Style Direction'), [section]);

    const [activePageIdx, setActivePageIdx] = useState(0);
    const [selectedThemeId, setSelectedThemeId] = useState<string | undefined>(undefined);

    // The card shows two things: the iframe preview and a color-theme picker.
    // Render whenever either has content — if there's truly nothing to show,
    // fall back to letting `SectionCard` handle Section 5 instead.
    const hasPages = previewPages.length > 0;
    if (palette.length === 0 && !hasPages) {
        return null;
    }

    const activePage: PreviewPage | undefined = hasPages
        ? previewPages[Math.min(activePageIdx, previewPages.length - 1)]
        : undefined;
    const isPending = !activePage || activePage.status !== 'ready' || !activePage.html;

    // Applying a theme rewrites every palette token whose semantic role the
    // theme knows about, bubbling each change up so the feedback drawer and the
    // iframe preview both reflect the new color story. The parent records the
    // true original hex on the first change per token, so passing the current
    // hex as the "original" is safe on repeat theme switches.
    const applyTheme = (theme: PreviewTheme): void => {
        setSelectedThemeId(theme.id);
        for (const entry of palette) {
            const role = roleForToken(entry.token);
            if (!role) {
                continue;
            }
            const newHex = theme.roles[role];
            if (newHex.toLowerCase() === entry.hex.toLowerCase()) {
                continue;
            }
            onPaletteChange(entry.token, entry.hex, newHex);
        }
    };

    return (
        <div className='sectionCard uiPreviewCard'>
            <div className='uiPreviewCard__header'>
                <h2>UI Preview</h2>
            </div>
            {styleDirection && <p className='uiPreviewCard__styleDirection'>{styleDirection}</p>}

            {hasPages && previewPages.length > 1 && (
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
            )}

            <div className='uiPreviewCard__frame'>
                <span className='uiPreviewCard__mockRibbon' aria-hidden='true'>MOCK</span>
                <div className='uiPreviewCard__chrome'>
                    <span className='uiPreviewCard__chromeDot' />
                    <span className='uiPreviewCard__chromeDot' />
                    <span className='uiPreviewCard__chromeDot' />
                    <span className='uiPreviewCard__urlPill'>{activePage?.route || '/'}</span>
                </div>
                {isPending ? (
                    <div className='uiPreviewCard__loading' role='status' aria-live='polite'>
                        <Spinner size='medium' label='Generating preview…' />
                    </div>
                ) : (
                    <iframe
                        // `srcDoc` keeps the iframe self-contained: the controller
                        // has already inlined `theme.css` into a `<style>` block,
                        // so no `localResourceRoots` plumbing is required. The
                        // sandbox intentionally omits `allow-scripts` — the
                        // preview is presentational only.
                        className='uiPreviewCard__iframe'
                        title={`UI preview for ${activePage.title}`}
                        srcDoc={activePage.html}
                        sandbox='allow-same-origin'
                    />
                )}
            </div>

            {palette.length > 0 && (
                <div className='uiPreviewCard__themeRow'>
                    <span className='uiPreviewCard__themeLabel'>Color theme</span>
                    <div className='uiPreviewCard__themeGrid' role='radiogroup' aria-label='Color theme'>
                        {PREVIEW_THEMES.map((theme) => (
                            <button
                                key={theme.id}
                                type='button'
                                role='radio'
                                aria-checked={selectedThemeId === theme.id}
                                className={`uiPreviewCard__themeCard ${selectedThemeId === theme.id ? 'uiPreviewCard__themeCard--active' : ''}`}
                                disabled={disabled}
                                onClick={() => applyTheme(theme)}
                            >
                                <span className='uiPreviewCard__themeSwatches' aria-hidden='true'>
                                    {theme.swatch.map((color, i) => (
                                        <span
                                            key={i}
                                            className='uiPreviewCard__themeSwatch'
                                            style={{ background: color }}
                                        />
                                    ))}
                                </span>
                                <span className='uiPreviewCard__themeName'>{theme.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

function extractPalette(section: PlanSection): PaletteEntry[] {
    for (const item of section.content) {
        if (item.type === 'colorPalette') {
            return item.entries;
        }
    }
    return [];
}

function extractKeyValue(section: PlanSection, key: string): string | undefined {
    for (const item of section.content) {
        if (item.type === 'keyValue' && item.key === key) {
            return item.value;
        }
    }
    return undefined;
}

type ThemeRole = 'primary' | 'accent' | 'surface' | 'text' | 'muted' | 'border' | 'onPrimary' | 'onAccent';

interface PreviewTheme {
    id: string;
    name: string;
    /** Representative colors shown on the theme card (primary, accent, surface). */
    swatch: string[];
    roles: Record<ThemeRole, string>;
}

// Curated, ready-to-use palettes. Picking one recolors the whole design in a
// single click instead of editing individual tokens.
const PREVIEW_THEMES: PreviewTheme[] = [
    {
        id: 'ocean',
        name: 'Ocean',
        swatch: ['#0078d4', '#00b7c3', '#f3f9fb'],
        roles: { primary: '#0078d4', accent: '#00b7c3', surface: '#f3f9fb', text: '#0b1f2a', muted: '#5b7282', border: '#cfe2ea', onPrimary: '#ffffff', onAccent: '#06303a' },
    },
    {
        id: 'sunset',
        name: 'Sunset',
        swatch: ['#e8590c', '#e64980', '#fff6f0'],
        roles: { primary: '#e8590c', accent: '#e64980', surface: '#fff6f0', text: '#2b1410', muted: '#8a6a5e', border: '#f3d8c8', onPrimary: '#ffffff', onAccent: '#ffffff' },
    },
    {
        id: 'forest',
        name: 'Forest',
        swatch: ['#2f9e44', '#0ca678', '#f3faf4'],
        roles: { primary: '#2f9e44', accent: '#0ca678', surface: '#f3faf4', text: '#11241a', muted: '#5d7766', border: '#cfe7d5', onPrimary: '#ffffff', onAccent: '#ffffff' },
    },
    {
        id: 'grape',
        name: 'Grape',
        swatch: ['#7048e8', '#ae3ec9', '#f8f5ff'],
        roles: { primary: '#7048e8', accent: '#ae3ec9', surface: '#f8f5ff', text: '#1f1633', muted: '#6f6585', border: '#e2d8f5', onPrimary: '#ffffff', onAccent: '#ffffff' },
    },
    {
        id: 'slate',
        name: 'Slate',
        swatch: ['#334155', '#0ea5e9', '#f5f7fa'],
        roles: { primary: '#334155', accent: '#0ea5e9', surface: '#f5f7fa', text: '#0f172a', muted: '#64748b', border: '#d8dee8', onPrimary: '#ffffff', onAccent: '#ffffff' },
    },
    {
        id: 'rose',
        name: 'Rose',
        swatch: ['#e11d48', '#f97316', '#fff5f6'],
        roles: { primary: '#e11d48', accent: '#f97316', surface: '#fff5f6', text: '#2b0f15', muted: '#8a5a62', border: '#f5d2d9', onPrimary: '#ffffff', onAccent: '#ffffff' },
    },
];

/**
 * Map a plan palette token name onto a semantic theme role so applying a theme
 * recolors the right swatch. Returns `undefined` for tokens the themes don't
 * model (those keep their planned color). Order matters: the `on *` checks run
 * before the bare `primary` / `accent` checks.
 */
function roleForToken(token: string): ThemeRole | undefined {
    const t = token.toLowerCase();
    if (/on[ -]?primary/.test(t)) {
        return 'onPrimary';
    }
    if (/on[ -]?accent/.test(t)) {
        return 'onAccent';
    }
    if (t.includes('primary')) {
        return 'primary';
    }
    if (t.includes('accent') || t.includes('secondary')) {
        return 'accent';
    }
    if (t.includes('surface') || t.includes('background') || t.includes('canvas')) {
        return 'surface';
    }
    if (t.includes('muted') || t.includes('subtle')) {
        return 'muted';
    }
    if (t.includes('border') || t.includes('outline') || t.includes('divider')) {
        return 'border';
    }
    if (t.includes('text') || t.includes('foreground') || t.includes('ink')) {
        return 'text';
    }
    return undefined;
}
