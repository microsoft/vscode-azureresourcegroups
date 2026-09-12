/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const allowedLinkProtocol = /^(?:https?|mailto):/i;

/**
 * Converts agent-written LocalPlanView text to safe HTML for React insertion.
 * Raw HTML stays inert, and only the links and tags allowed by the local debug-plan contract are restored.
 */
export function formatInlineMarkdown(text: string): string {
    // Escape agent-written HTML first so scripts and event-handler attributes stay text.
    // The replacements below then add back only the formatting this view controls.
    return escapeHtml(text.trim())
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        // Reject protocols such as javascript: that can execute when clicked.
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) =>
            allowedLinkProtocol.test(href)
                ? `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`
                : label,
        )
        // Restore exact plan-contract tags only, leaving attributes escaped.
        .replace(/&lt;(details|\/details|summary|\/summary|br)&gt;/g, '<$1>')
        .replace(
            /\u26A0\uFE0F?/g,
            '<span class="codicon codicon-warning warningIcon" aria-hidden="true"></span>',
        );
}

function escapeHtml(text: string): string {
    // Encode markup delimiters and quotes so raw HTML stays visible text.
    return text
        // Escape ampersands first so these new entities are not escaped again.
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
