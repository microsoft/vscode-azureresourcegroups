/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSX, type ReactNode } from 'react';
import {
    parseInlineMarkdown,
    type InlineMarkdownNode,
} from '../utils/parseInlineMarkdown';

export const InlineMarkdown = ({ text }: { text: string }): JSX.Element => (
    <>{renderNodes(parseInlineMarkdown(text))}</>
);

function renderNodes(nodes: InlineMarkdownNode[]): ReactNode[] {
    return nodes.map((node, index) => renderNode(node, index));
}

function renderNode(node: InlineMarkdownNode, key: number): ReactNode {
    switch (node.type) {
        case 'text':
            return node.value;
        case 'code':
            return <code key={key}>{renderNodes(node.children)}</code>;
        case 'strong':
            return <strong key={key}>{renderNodes(node.children)}</strong>;
        case 'emphasis':
            return <em key={key}>{renderNodes(node.children)}</em>;
        case 'link':
            return (
                <a key={key} href={node.href} target='_blank' rel='noreferrer'>
                    {renderNodes(node.children)}
                </a>
            );
        case 'details':
            return <details key={key}>{renderNodes(node.children)}</details>;
        case 'summary':
            return <summary key={key}>{renderNodes(node.children)}</summary>;
        case 'lineBreak':
            return <br key={key} />;
        case 'warningIcon':
            return (
                <span
                    key={key}
                    className='codicon codicon-warning warningIcon'
                    aria-hidden='true'
                />
            );
    }
}
