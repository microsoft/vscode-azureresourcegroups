/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BrandVariants, type Theme, createLightTheme, webLightTheme } from '@fluentui/react-components';
import { type PaletteEntry } from './parseScaffoldPlanMarkdown';

/**
 * Build a Fluent UI v9 `Theme` whose brand ramp is derived from the plan's
 * Color Palette `primary` token. When no plausible primary is found, fall back
 * to the default `webLightTheme` so the preview still renders.
 */
export function buildPreviewTheme(palette: PaletteEntry[]): Theme {
    const primary = pickPrimary(palette);
    if (!primary) {
        return webLightTheme;
    }
    return createLightTheme(buildBrandRamp(primary));
}

const PRIMARY_MATCHERS: ReadonlyArray<RegExp> = [/primary/i, /brand/i, /accent/i];

function pickPrimary(palette: PaletteEntry[]): string | undefined {
    for (const matcher of PRIMARY_MATCHERS) {
        const hit = palette.find(p => matcher.test(p.token));
        if (hit) {
            return normalizeHex(hit.hex);
        }
    }
    return palette[0] ? normalizeHex(palette[0].hex) : undefined;
}

/**
 * Build a 16-stop `BrandVariants` ramp from a single hex by walking the HSL
 * lightness axis. Fluent expects stops 10–160 in increasing brightness.
 */
function buildBrandRamp(hex: string): BrandVariants {
    const { h, s } = hexToHsl(hex);
    const lightnessByStop: Record<keyof BrandVariants, number> = {
        10: 8, 20: 14, 30: 20, 40: 26, 50: 32, 60: 38, 70: 44,
        80: 50, 90: 56, 100: 62, 110: 68, 120: 74, 130: 80, 140: 86, 150: 92, 160: 96,
    };
    const out = {} as Record<keyof BrandVariants, string>;
    for (const stopStr of Object.keys(lightnessByStop)) {
        const stop = Number(stopStr) as keyof BrandVariants;
        out[stop] = hslToHex(h, clampSaturation(s, lightnessByStop[stop]), lightnessByStop[stop]);
    }
    return out as BrandVariants;
}

function normalizeHex(hex: string): string {
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
    return '#0078d4';
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
    const n = hex.replace(/^#/, '');
    const r = parseInt(n.slice(0, 2), 16) / 255;
    const g = parseInt(n.slice(2, 4), 16) / 255;
    const b = parseInt(n.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = ((max + min) / 2) * 100;
    let h = 0;
    let s = 0;
    if (max !== min) {
        const d = max - min;
        s = ((l > 50 ? d / (2 - max - min) : d / (max + min)) * 100);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
            case g: h = ((b - r) / d + 2) * 60; break;
            case b: h = ((r - g) / d + 4) * 60; break;
        }
    }
    return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
    const sN = s / 100;
    const lN = l / 100;
    const c = (1 - Math.abs(2 * lN - 1)) * sN;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = lN - c / 2;
    let r: number;
    let g: number;
    let b: number;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    const toHex = (v: number): string => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return '#' + toHex(r) + toHex(g) + toHex(b);
}

function clampSaturation(s: number, lightness: number): number {
    if (lightness <= 12 || lightness >= 94) {
        return Math.min(s, 60);
    }
    return Math.max(s, 18);
}
