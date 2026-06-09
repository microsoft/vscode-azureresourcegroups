/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Input,
    MessageBar,
    MessageBarBody,
    MessageBarTitle,
    Textarea,
} from '@fluentui/react-components';
import { useMemo, useRef, type JSX } from 'react';
import { type PageEntry, type PaletteEntry, type PlanSection } from '../utils/parseScaffoldPlanMarkdown';

interface UiPreviewCardProps {
    section: PlanSection;
    uiNote: string;
    disabled?: boolean;
    /** Raw HTML of the embedded `.azure/frontend-preview/index.html`, rendered via iframe srcdoc. */
    previewHtml?: string;
    /** Called when the user picks a new color for a palette token. */
    onPaletteChange: (token: string, originalHex: string, newHex: string) => void;
    /** Called when the user edits the typography font family. */
    onTypographyChange: (originalValue: string, newValue: string) => void;
    onUiNoteChange: (text: string) => void;
}

/**
 * Companion controls for the embedded frontend preview. The preview is a single
 * self-contained static HTML/CSS file generated during planning and rendered
 * inline below in a sandboxed iframe (no build step, no dev server). This card
 * also surfaces Section 5 (Design System & UI) as editable controls: the user
 * can pick new palette colors, edit the font family, and add free-form UI notes.
 * Every edit is bubbled up so the parent can mirror it into the feedback drawer
 * and regenerate the preview.
 */
export const UiPreviewCard = ({ section, uiNote, disabled, previewHtml, onPaletteChange, onTypographyChange, onUiNoteChange }: UiPreviewCardProps): JSX.Element | null => {
    const palette = useMemo(() => extractPalette(section), [section]);
    const pages = useMemo(() => extractPages(section), [section]);
    const componentLibrary = useMemo(() => extractKeyValue(section, 'Component Library'), [section]);
    const typography = useMemo(() => extractKeyValue(section, 'Typography'), [section]);
    const styleDirection = useMemo(() => extractKeyValue(section, 'Style Direction'), [section]);

    const colorInputs = useRef<Map<string, HTMLInputElement | null>>(new Map());
    const originalTypography = useRef<string | undefined>(undefined);
    const originalPaletteHex = useRef<Map<string, string>>(new Map());

    if (palette.length === 0 || pages.length === 0) {
        return null;
    }

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

            <div className='uiPreviewCard__livePreview'>
                {previewHtml ? (
                    <iframe
                        className='uiPreviewCard__frame'
                        srcDoc={previewHtml}
                        title='Frontend preview'
                        sandbox=''
                    />
                ) : (
                    <MessageBar intent='info' className='uiPreviewCard__liveBanner'>
                        <MessageBarBody>
                            <MessageBarTitle>Preview generates here</MessageBarTitle>
                            Your frontend preview{componentLibrary ? <> (styled like <strong>{componentLibrary}</strong>)</> : null} will appear inline once planning builds it. Tweak the palette, typography, or describe changes below — the preview regenerates in place.
                        </MessageBarBody>
                    </MessageBar>
                )}
                <div className='uiPreviewCard__pageList'>
                    {pages.map((p, i) => (
                        <div key={`${p.page}-${i}`} className='uiPreviewCard__pageChip'>
                            <span className='uiPreviewCard__pageChipName'>{p.page}</span>
                            <span className='uiPreviewCard__pageChipRoute'>{p.route || `/${p.page.toLowerCase().replace(/\s+/g, '-')}`}</span>
                        </div>
                    ))}
                </div>
            </div>

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

function extractPages(section: PlanSection): PageEntry[] {
    for (const item of section.content) {
        if (item.type === 'pages') {
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
