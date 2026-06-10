/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Select,
    Spinner,
} from '@fluentui/react-components';
import { useMemo, useRef, type JSX } from 'react';
import { type PageEntry, type PaletteEntry, type PlanSection } from '../utils/parseScaffoldPlanMarkdown';

/** Curated font families offered in the Typography dropdown. */
const FONT_CHOICES = [
    'Inter',
    'Roboto',
    'Open Sans',
    'Lato',
    'Montserrat',
    'Poppins',
    'Nunito',
    'Work Sans',
    'Source Sans 3',
    'system-ui',
    'Georgia',
    'Merriweather',
    'Playfair Display',
    'JetBrains Mono',
];

interface UiPreviewCardProps {
    section: PlanSection;
    disabled?: boolean;
    /** Webview-resource URI of the embedded `.azure/frontend-preview/index.html`, loaded as the iframe src. */
    previewUri?: string;
    /** Called when the user picks a new color for a palette token. */
    onPaletteChange: (token: string, originalHex: string, newHex: string) => void;
    /** Called when the user picks a new typography font family. */
    onTypographyChange: (originalValue: string, newValue: string) => void;
}

/**
 * Companion controls for the embedded frontend preview. The preview is a single
 * self-contained static HTML/CSS preview generated during planning and rendered
 * inline below in an iframe that loads the `.azure/frontend-preview/` files as
 * webview resources (so its pages are navigable). This card also surfaces
 * Section 5 (Design System & UI) as editable controls: the user can pick new
 * palette colors and choose the font family. Every edit is bubbled up so the
 * parent can mirror it into the feedback drawer and regenerate the preview.
 */
export const UiPreviewCard = ({ section, disabled, previewUri, onPaletteChange, onTypographyChange }: UiPreviewCardProps): JSX.Element | null => {
    const palette = useMemo(() => extractPalette(section), [section]);
    const pages = useMemo(() => extractPages(section), [section]);

    const typography = useMemo(() => extractKeyValue(section, 'Typography'), [section]);
    const styleDirection = useMemo(() => extractKeyValue(section, 'Style Direction'), [section]);
    const fontOptions = useMemo(() => {
        const list = [...FONT_CHOICES];
        if (typography && !list.includes(typography)) {
            list.unshift(typography);
        }
        return list;
    }, [typography]);

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
            </div>
            {styleDirection && <p className='uiPreviewCard__styleDirection'>{styleDirection}</p>}

            <div className='uiPreviewCard__livePreview'>
                {previewUri ? (
                    <iframe
                        className='uiPreviewCard__frame'
                        src={previewUri}
                        title='Frontend preview'
                        sandbox='allow-same-origin'
                    />
                ) : (
                    <div className='uiPreviewCard__loading'>
                        <Spinner size='large' label='Generating your frontend preview…' />
                    </div>
                )}
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
                    <Select
                        id='ui-preview-typography'
                        className='uiPreviewCard__typographyInput'
                        value={typography}
                        disabled={disabled}
                        onChange={(_, data) => handleTypographyChange(data.value)}
                    >
                        {fontOptions.map((font) => (
                            <option key={font} value={font}>{font}</option>
                        ))}
                    </Select>
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
