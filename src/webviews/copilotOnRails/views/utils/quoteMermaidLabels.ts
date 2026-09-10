/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Render-time normalization for the mermaid diagram in a debug plan.
 *
 * The `azure-debug-plan` agent's template asks for every flowchart label to be
 * quoted, because mermaid v11 reserves characters that routinely show up in the
 * package and service names these diagrams describe. The clearest example is
 * `@`, which mermaid v11 lexes as the start of an edge id (`e1@-->`) or a node
 * metadata block (`id@{ shape: rect }`) when it opens an *unquoted* label — so
 * `API -->|@azure/storage-blob| AZ` fails to parse and the whole diagram is
 * replaced by mermaid's syntax-error graphic.
 *
 * The template rule only helps plans generated from now on, and only when the
 * model complies. Plans already written to a workspace still fail to render, so
 * the webview quotes labels itself before handing the diagram to mermaid.
 *
 * The transform is deliberately conservative: it only quotes a label that is not
 * quoted already, so it is a no-op on diagrams that already render.
 */

/** Diagram kinds this transform understands. Anything else is passed through untouched. */
const flowchartHeader = /^(?:graph|flowchart)\b/;

/**
 * Quotes unquoted flowchart node and edge labels so reserved characters inside
 * them are treated as text.
 *
 * Returns `code` unchanged when it isn't a flowchart — a sequence, class or ER
 * diagram gives `[]`, `{}` and `|` completely different meanings, and rewriting
 * one would turn a working diagram into a broken one.
 */
export function quoteMermaidLabels(code: string): string {
    const lines = code.split('\n');
    const bodyStart = endOfFrontmatter(lines);
    if (!isFlowchart(lines, bodyStart)) {
        return code;
    }

    return lines.map((line, i) => (i < bodyStart ? line : quoteLabelsInLine(line))).join('\n');
}

/**
 * Index of the first line after a leading `---` YAML frontmatter block, or 0
 * when there isn't one. Frontmatter is diagram config rather than diagram body,
 * so it is copied through verbatim.
 */
function endOfFrontmatter(lines: string[]): number {
    if (lines[0]?.trim() !== '---') {
        return 0;
    }
    const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    return close === -1 ? 0 : close + 1;
}

function isFlowchart(lines: string[], bodyStart: number): boolean {
    for (let i = bodyStart; i < lines.length; i++) {
        const line = lines[i].trim();
        // `%%` covers both comments and `%%{init: ...}%%` directives.
        if (line === '' || line.startsWith('%%')) {
            continue;
        }
        return flowchartHeader.test(line);
    }
    return false;
}

function quoteLabelsInLine(line: string): string {
    if (line.trim().startsWith('%%')) {
        return line;
    }

    // Mermaid v11 node/edge metadata — `id@{ shape: rect }`, `e1@{ animate: true }` —
    // is brace-delimited but is configuration, not a label. Quoting its body
    // (`e1@{"animate: true"}`) would change what it means, so the rhombus rule is
    // skipped entirely on any line that carries a metadata block.
    const hasMetadata = line.includes('@{');

    return mapUnquotedSegments(line, (segment) => {
        let result = segment
            // Cylinder `[(text)]` and circle `((text))` are matched before the plain
            // `[text]` rule so their delimiters survive.
            .replace(/\[\(([^)\]\n]+)\)\]/g, (_match, label: string) => `[(${quote(label)})]`)
            .replace(/\(\(([^)\n]+)\)\)/g, (_match, label: string) => `((${quote(label)}))`)
            .replace(/\[([^[\]\n]+)\]/g, (match, label: string) =>
                // A label already rewritten by the cylinder rule starts with `(` or `"`, and
                // `/` and `\` are the parallelogram/trapezoid shape delimiters rather than
                // label text. Leave all of those to the rules that own them.
                //
                // Skipping `/` and `\` means a parallelogram or trapezoid label is never
                // quoted, so `A[/@azure/identity/]` still fails to parse. That is a
                // deliberate tradeoff: quoting it would flatten the shape into a plain
                // rectangle, which silently changes a diagram that renders today. Losing a
                // shape on every existing diagram is worse than not rescuing a rare one.
                /^[("/\\]/.test(label) ? match : `[${quote(label)}]`,
            )
            // Round `(text)`: run after cylinder/circle/stadium so their delimiters are
            // already consumed, and skip a body a previous rule produced. A stadium
            // `A([x])` has by now become `A(["x"])`, so its paren body starts with `[`;
            // without this guard it would be re-quoted into `A("[\"x\"]")` and break.
            .replace(/\(([^()\n]+)\)/g, (match, label: string) =>
                /^[["/\\]/.test(label) ? match : `(${quote(label)})`,
            );

        if (!hasMetadata) {
            result = result.replace(/\{([^{}\n]+)\}/g, (_match, label: string) => `{${quote(label)}}`);
        }

        // Edge labels: `-->|text|`.
        return result.replace(/\|([^|\n]+)\|/g, (_match, label: string) => `|${quote(label)}|`);
    });
}

const quote = (label: string): string => (label.includes('"') ? label : `"${label}"`);

/**
 * Applies `transform` to the parts of `line` that sit outside mermaid's `"…"`
 * strings. Mermaid has no escape sequence inside a quoted label, so the double
 * quotes alternate: even-indexed pieces are outside a string, odd-indexed ones
 * are the label text itself. Rewriting only the outside pieces keeps an
 * already-quoted label — including one that contains brackets, braces or pipes,
 * such as `A["Blob (hot tier) [preview]"]` — exactly as the author wrote it.
 */
function mapUnquotedSegments(line: string, transform: (segment: string) => string): string {
    return line
        .split('"')
        .map((segment, i) => (i % 2 === 0 ? transform(segment) : segment))
        .join('"');
}
