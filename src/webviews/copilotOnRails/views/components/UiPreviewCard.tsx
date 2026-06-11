/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Input, Spinner, Textarea } from '@fluentui/react-components';
import { useMemo, useRef, useState, type JSX } from 'react';
import { type PaletteEntry, type PlanSection, type PreviewPage } from '../utils/parseScaffoldPlanMarkdown';

interface UiPreviewCardProps {
    section: PlanSection;
    uiNote: string;
    disabled?: boolean;
    /**
     * HTML/CSS pages emitted by the planner agent into `.azure/.preview-temp/`
     * and pushed in by the controller. Each entry is either `pending` (no HTML
     * yet — show a "Generating preview…" panel) or `ready` (drop the inlined
     * HTML into an iframe via `srcDoc`).
     */
    previewPages: PreviewPage[];
    /** Called when the user picks a new color for a palette token. */
    onPaletteChange: (token: string, originalHex: string, newHex: string) => void;
    /** Called when the user edits the typography font family. */
    onTypographyChange: (originalValue: string, newValue: string) => void;
    onUiNoteChange: (text: string) => void;
}

/**
 * Read-only view of Section 5 (Design System & UI). The wireframe itself is
 * now a sandboxed iframe loaded with planner-generated HTML/CSS; the
 * surrounding chrome still lets the user pick new palette colors, tweak the
 * font family, and add free-form UI notes — every edit is bubbled up so the
 * parent can mirror it into the feedback drawer.
 */
export const UiPreviewCard = ({ section, uiNote, disabled, previewPages, onPaletteChange, onTypographyChange, onUiNoteChange }: UiPreviewCardProps): JSX.Element | null => {
    const palette = useMemo(() => extractPalette(section), [section]);
    const componentLibrary = useMemo(() => extractKeyValue(section, 'Component Library'), [section]);
    const typography = useMemo(() => extractKeyValue(section, 'Typography'), [section]);
    const styleDirection = useMemo(() => extractKeyValue(section, 'Style Direction'), [section]);

    const [activePageIdx, setActivePageIdx] = useState(0);
    const colorInputs = useRef<Map<string, HTMLInputElement | null>>(new Map());
    const originalTypography = useRef<string | undefined>(undefined);
    const originalPaletteHex = useRef<Map<string, string>>(new Map());

    // The card shows three things: palette swatches, the iframe preview, and a
    // typography/notes row. Render whenever any one of them has content — if
    // there's truly nothing to show, fall back to letting `SectionCard` handle
    // Section 5 instead.
    const hasPages = previewPages.length > 0;
    if (palette.length === 0 && !hasPages && typography === undefined) {
        return null;
    }

    const activePage: PreviewPage | undefined = hasPages
        ? previewPages[Math.min(activePageIdx, previewPages.length - 1)]
        : undefined;
    const isPending = !activePage || activePage.status !== 'ready' || !activePage.html;

    const handleSwatchClick = (token: string): void => {
        const input = colorInputs.current.get(token);
        input?.click();
    };

    const handleColorChange = (entry: PaletteEntry, newHex: string): void => {
        if (!originalPaletteHex.current.has(entry.token)) {
            originalPaletteHex.current.set(entry.token, entry.hex);
        }
        const original = originalPaletteHex.current.get(entry.token) ?? entry.hex;
        onPaletteChange(entry.token, original, newHex);
    };

    const handleTypographyChange = (next: string): void => {
        if (originalTypography.current === undefined) {
            originalTypography.current = typography ?? '';
        }
        onTypographyChange(originalTypography.current, next);
    };

    return (
        <div className='sectionCard uiPreviewCard'>
            <div className='uiPreviewCard__header'>
                <h2>UI Preview</h2>
                {componentLibrary && (
                    <Badge appearance='tint' color='brand' size='medium'>{componentLibrary}</Badge>
                )}
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

            {componentLibrary && (
                <p className='uiPreviewCard__previewNote'>
                    <strong>Directional mock, not the final UI.</strong> The scaffold renders this with <strong>{componentLibrary}</strong>,
                    real icons, motion, and dark mode — it will look noticeably more polished than the sketch below.
                </p>
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
                <div className='uiPreviewCard__paletteRow'>
                    {palette.map((entry) => (
                        <div key={entry.token} className='uiPreviewCard__swatch'>
                            <button
                                type='button'
                                className='uiPreviewCard__swatchChip'
                                style={{ background: entry.hex }}
                                disabled={disabled}
                                aria-label={`Change ${entry.token} color`}
                                onClick={() => handleSwatchClick(entry.token)}
                            />
                            <input
                                ref={(el) => { colorInputs.current.set(entry.token, el); }}
                                type='color'
                                value={normalizeHexForInput(entry.hex)}
                                disabled={disabled}
                                onChange={(e) => handleColorChange(entry, e.target.value)}
                                className='uiPreviewCard__swatchInput'
                                aria-hidden='true'
                                tabIndex={-1}
                            />
                            <div className='uiPreviewCard__swatchMeta'>
                                <span className='uiPreviewCard__swatchToken'>{entry.token}</span>
                                <span className='uiPreviewCard__swatchHex'>{entry.hex.toUpperCase()}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {typography !== undefined && (
                <div className='uiPreviewCard__typographyRow'>
                    <label className='uiPreviewCard__typographyLabel' htmlFor='ui-preview-typography'>
                        Typography
                    </label>
                    <Input
                        id='ui-preview-typography'
                        className='uiPreviewCard__typographyInput'
                        value={typography}
                        disabled={disabled}
                        onChange={(_, data) => handleTypographyChange(data.value)}
                    />
                </div>
            )}

            <div className='uiPreviewCard__noteRow'>
                <label className='uiPreviewCard__noteLabel' htmlFor='ui-preview-note'>
                    Request UI changes
                </label>
                <Textarea
                    id='ui-preview-note'
                    className='uiPreviewCard__noteInput'
                    value={uiNote}
                    disabled={disabled}
                    placeholder="e.g. 'Use larger headlines on the dashboard' or 'Add a search bar to the header'"
                    rows={2}
                    resize='vertical'
                    onChange={(_, data) => onUiNoteChange(data.value)}
                />
            </div>
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

function normalizeHexForInput(hex: string): string {
    const raw = hex.replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(raw)) {
        return '#' + raw.split('').map(c => c + c).join('');
    }
    if (/^[0-9a-f]{6}$/.test(raw)) {
        return '#' + raw;
    }
    if (/^[0-9a-f]{8}$/.test(raw)) {
        return '#' + raw.slice(0, 6);
    }
    return '#000000';
}
