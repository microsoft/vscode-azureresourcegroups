/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function handlePreviewClick(event: MouseEvent, navigateToPage: (slug: string) => void): void {
    const target = event.composedPath().find((node): node is Element => 'nodeType' in node && node.nodeType === 1);
    const anchor = target?.closest('a, area');
    if (!anchor) {
        return;
    }

    // srcDoc inherits the parent's base URL, so even "#" can leave the preview.
    event.preventDefault();
    const slug = anchor.getAttribute('data-preview-nav');
    if (slug) {
        navigateToPage(slug);
        return;
    }

    const href = anchor.getAttribute('href') ?? '';
    if (!href.startsWith('#') || href.length === 1) {
        return;
    }

    let fragment: string;
    try {
        fragment = decodeURIComponent(href.slice(1));
    } catch (error) {
        if (!(error instanceof URIError)) {
            throw error;
        }
        console.warn('Ignoring a preview link with a malformed fragment.');
        return;
    }

    const doc = anchor.ownerDocument;
    const destination = doc.getElementById(fragment)
        ?? Array.from(doc.getElementsByName(fragment)).find(element => element.localName === 'a');
    destination?.scrollIntoView();
}
