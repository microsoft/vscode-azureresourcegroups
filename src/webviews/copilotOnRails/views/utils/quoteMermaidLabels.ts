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
 *
 * Covered shapes: rectangle, round, stadium, subroutine, cylinder, circle,
 * double circle, rhombus and hexagon nodes, plus subgraph titles and edge
 * labels. The asymmetric shape (`A>text]`) and the parallelogram/trapezoid
 * family (`A[/text/]`) are knowingly left alone — see `quoteLabelsInLine`.
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

    // Pass 1 — every shape whose label is delimited by brackets or braces, plus edge
    // labels. Nested delimiters are matched longest-first, so an outer delimiter is
    // consumed before an inner rule can claim its body. The asymmetric shape (`A>text]`)
    // has no rule: its opening delimiter is a bare `>`, which is indistinguishable from
    // an arrowhead, so a rule for it could not be made safe.
    const afterBrackets = mapUnquotedSegments(line, (segment) => {
        let result = segment
            .replace(/\(\(\(([^()\n]+)\)\)\)/g, (_match, label: string) => `(((${quote(label)})))`)
            // The cylinder body is lazy up to the first `)]` so a label that itself
            // contains parentheses — `[(Postgres (primary))]` — is quoted whole.
            .replace(/\[\(([^[\]\n]+?)\)\]/g, (_match, label: string) => `[(${quote(label)})]`)
            .replace(/\(\(([^)\n]+)\)\)/g, (match, label: string) =>
                // A double circle already rewritten above leaves a body starting with `(`.
                label.startsWith('(') ? match : `((${quote(label)}))`,
            )
            .replace(/\[([^[\]\n]+)\]/g, (match, label: string) =>
                // A label already rewritten by the cylinder rule starts with `(` or `"`, and
                // `/` and `\` are the parallelogram/trapezoid shape delimiters rather than
                // label text. Leave all of those to the rules that own them. A parallelogram
                // or trapezoid label therefore stays unquoted — a deliberate trade, since
                // flattening the shape into a rectangle would be the worse outcome.
                /^[("/\\]/.test(label) ? match : `[${quote(label)}]`,
            );

        if (!hasMetadata) {
            result = result.replace(/\{([^{}\n]+)\}/g, (_match, label: string) => `{${quote(label)}}`);
        }

        // Edge labels: `-->|text|`.
        return result.replace(/\|([^|\n]+)\|/g, (_match, label: string) => `|${quote(label)}|`);
    });

    // `click nodeId call handler(a, b)` is the one flowchart statement that puts an
    // unquoted, comma-separated argument list in parentheses. Quoting it would collapse
    // the arguments into a single string, so interaction statements skip the round rule.
    if (/^\s*click\b/.test(line)) {
        return afterBrackets;
    }

    // Pass 2 — the round shape `(text)`. It runs over a *freshly* re-split line rather
    // than inside pass 1, because pass 1 introduces quotes of its own: the parentheses
    // in `Web[Attendance Web (Vite)]` become part of a quoted label, and re-splitting is
    // what stops them from being quoted a second time. Re-splitting also means the outer
    // parentheses of a stadium, cylinder, circle or double circle are already separated
    // from their now-quoted body, so this rule cannot touch them.
    return mapUnquotedSegments(afterBrackets, (segment) =>
        segment.replace(/\(([^()\n]+)\)/g, (_match, label: string) => `(${quote(label)})`),
    );
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
