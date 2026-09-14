/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type InlineMarkdownNode =
    | { type: 'text'; value: string }
    | { type: 'code' | 'strong' | 'emphasis' | 'details' | 'summary'; children: InlineMarkdownNode[] }
    | { type: 'link'; href: string; children: InlineMarkdownNode[] }
    | { type: 'lineBreak' | 'warningIcon' };

const allowedLinkProtocol = /^(?:https?|mailto):/i;

/**
 * Parses untrusted inline plan text into nodes React can render without raw HTML insertion.
 * Only safe links and attribute-free plan tags become elements; all other HTML remains text.
 */
export function parseInlineMarkdown(text: string): InlineMarkdownNode[] {
    const root: InlineMarkdownNode[] = [];
    const openContainers: OpenContainer[] = [];
    let current = root;
    let cursor = 0;
    const source = text.trim();
    const planTagPattern = /<\/?(?:details|summary)>|<br>/g;

    for (const match of source.matchAll(planTagPattern)) {
        appendNodes(current, parseMarkdownText(source.slice(cursor, match.index)));

        const tag = match[0];
        if (tag === '<br>') {
            current.push({ type: 'lineBreak' });
        } else if (tag.startsWith('</')) {
            const type = tag.slice(2, -1) as ContainerType;
            const openContainer = openContainers.at(-1);
            if (openContainer?.type === type) {
                current = openContainer.parent;
                openContainers.pop();
            } else {
                // An unmatched closing tag is plan text, not markup React should create.
                appendText(current, tag);
            }
        } else {
            const type = tag.slice(1, -1) as ContainerType;
            const children: InlineMarkdownNode[] = [];
            current.push({ type, children });
            openContainers.push({ type, parent: current });
            current = children;
        }

        cursor = (match.index ?? 0) + tag.length;
    }

    appendNodes(current, parseMarkdownText(source.slice(cursor)));
    return root;
}

type ContainerType = 'details' | 'summary';

interface OpenContainer {
    type: ContainerType;
    parent: InlineMarkdownNode[];
}

function parseMarkdownText(text: string): InlineMarkdownNode[] {
    const nodes: InlineMarkdownNode[] = [];
    const markdownPattern = /`([^`]+)`|\*\*(.+?)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)|\u26A0\uFE0F?/g;
    let cursor = 0;

    for (const match of text.matchAll(markdownPattern)) {
        appendText(nodes, text.slice(cursor, match.index));

        if (match[1] !== undefined) {
            nodes.push({ type: 'code', children: [{ type: 'text', value: match[1] }] });
        } else if (match[2] !== undefined) {
            nodes.push({ type: 'strong', children: parseMarkdownText(match[2]) });
        } else if (match[3] !== undefined) {
            nodes.push({ type: 'emphasis', children: parseMarkdownText(match[3]) });
        } else if (match[4] !== undefined && match[5] !== undefined) {
            const label = parseMarkdownText(match[4]);
            if (allowedLinkProtocol.test(match[5])) {
                nodes.push({ type: 'link', href: match[5], children: label });
            } else {
                // Keep unsafe link labels visible without creating a clickable element.
                appendNodes(nodes, label);
            }
        } else {
            nodes.push({ type: 'warningIcon' });
        }

        cursor = (match.index ?? 0) + match[0].length;
    }

    appendText(nodes, text.slice(cursor));
    return nodes;
}

function appendNodes(target: InlineMarkdownNode[], nodes: InlineMarkdownNode[]): void {
    for (const node of nodes) {
        if (node.type === 'text') {
            appendText(target, node.value);
        } else {
            target.push(node);
        }
    }
}

function appendText(nodes: InlineMarkdownNode[], value: string): void {
    if (!value) {
        return;
    }

    const previous = nodes.at(-1);
    if (previous?.type === 'text') {
        previous.value += value;
    } else {
        nodes.push({ type: 'text', value });
    }
}
