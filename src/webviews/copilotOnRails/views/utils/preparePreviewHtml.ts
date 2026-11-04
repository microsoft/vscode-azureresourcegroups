/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import createDOMPurify, { type Config } from 'dompurify';

// Keep preview policy independent of Mermaid's hooks and configuration.
const sanitizer = createDOMPurify(window);
const sanitizationConfig: Config = {
    WHOLE_DOCUMENT: true,
    USE_PROFILES: { html: true, svg: true },
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['base', 'meta', 'iframe', 'object', 'embed', 'template', 'foreignobject', 'animate', 'animatemotion', 'animatetransform', 'set'],
    FORBID_ATTR: ['srcdoc', 'action', 'formaction', 'formtarget', 'target', 'download', 'ping', 'autofocus', 'is', 'xlink:href'],
};

const previewContentSecurityPolicy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none';";

/** Prepare untrusted workspace HTML/CSS at the browser's iframe boundary. */
export function preparePreviewHtml(
    html: string,
    themeCss: string | undefined,
    pageSlugs: readonly string[],
    overrides: Readonly<Record<string, string>>,
): string {
    const root = sanitizer.sanitize(html, { ...sanitizationConfig, ADD_TAGS: ['link'], RETURN_DOM: true });
    if (!(root instanceof HTMLElement)) {
        throw new Error('Preview sanitization did not produce an HTML document.');
    }

    for (const link of root.querySelectorAll('link')) {
        const href = link.getAttribute('href')?.trim();
        const isStylesheet = link.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('stylesheet');
        if (isStylesheet && (href === 'theme.css' || href === './theme.css') && themeCss) {
            const style = root.ownerDocument.createElement('style');
            style.setAttribute('data-inlined', 'theme.css');
            style.textContent = cssRawText(themeCss);
            link.replaceWith(style);
        } else {
            link.remove();
        }
    }

    const knownSlugs = new Set(pageSlugs);
    for (const anchor of root.querySelectorAll('a, area')) {
        const href = anchor.getAttribute('href')?.trim() ?? '';
        if (href.startsWith('#')) {
            anchor.setAttribute('href', href);
            continue;
        }
        const match = /^(?:\.\/)?([a-z0-9]+(?:-[a-z0-9]+)*)\.html?(?:[?#].*)?$/i.exec(href);
        if (match && knownSlugs.has(match[1])) {
            anchor.setAttribute('data-preview-nav', match[1]);
        }
        anchor.setAttribute('href', '#');
    }

    const declarations = Object.entries(overrides)
        .filter(([name, value]) => /^--color-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && /^#(?:[a-f0-9]{3}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(value))
        .map(([name, value]) => `${name}: ${value} !important;`);
    const head = root.querySelector('head');
    if (!head) {
        throw new Error('Preview sanitization did not produce a document head.');
    }
    if (declarations.length > 0) {
        const style = root.ownerDocument.createElement('style');
        style.id = '__live-palette-overrides';
        style.textContent = `:root { ${declarations.join(' ')} }`;
        head.append(style);
    }

    const sanitized = sanitizer.sanitize(root.outerHTML, {
        ...sanitizationConfig,
        FORBID_TAGS: [...(sanitizationConfig.FORBID_TAGS ?? []), 'link'],
        ADD_ATTR: ['data-preview-nav', 'data-inlined'],
        RETURN_DOM: true,
    });
    if (!(sanitized instanceof HTMLElement)) {
        throw new Error('Preview sanitization did not produce an HTML document.');
    }
    const sanitizedHead = sanitized.querySelector('head');
    if (!sanitizedHead) {
        throw new Error('Preview sanitization did not produce a document head.');
    }
    const policy = sanitized.ownerDocument.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = previewContentSecurityPolicy;
    sanitizedHead.prepend(policy);
    return `<!DOCTYPE html>${sanitized.outerHTML}`;
}

function cssRawText(css: string): string {
    // HTML serializers do not escape style text: a CSS string must not close
    // its style element when srcDoc is parsed again.
    return css.replaceAll('<', '\\3c ');
}
