/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const allowedLinkProtocol = /^(?:https?|mailto):/i;

export function formatInlineMarkdown(text: string): string {
    return escapeHtml(text.trim())
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) =>
            allowedLinkProtocol.test(href)
                ? `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`
                : label,
        )
        .replace(/&lt;(details|\/details|summary|\/summary|br)&gt;/g, '<$1>')
        .replace(
            /\u26A0\uFE0F?/g,
            '<span class="codicon codicon-warning warningIcon" aria-hidden="true"></span>',
        );
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
