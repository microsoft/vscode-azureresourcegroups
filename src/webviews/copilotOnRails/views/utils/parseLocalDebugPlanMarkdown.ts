/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface LocalPlanData {
    title: string;
    status: string;
    executionMode: string;
    headerNote: string;
    sections: LocalPlanSection[];
    parseError?: LocalPlanParseError;
}

export interface LocalPlanParseError {
    message: string;
    fileLabel?: string;
}

export interface LocalPlanSection {
    title: string;
    content: LocalPlanContent[];
}

export interface SourceRange {
    /** 0-indexed inclusive line in the source markdown that this block starts at. */
    lineStart: number;
    /** 0-indexed inclusive line in the source markdown that this block ends at. */
    lineEnd: number;
}

export type LocalPlanContent =
    | ({ type: 'table'; headers: string[]; rows: string[][]; rowLines: number[] } & SourceRange)
    | ({ type: 'blockquote'; text: string } & SourceRange)
    | ({ type: 'paragraph'; text: string } & SourceRange)
    | ({ type: 'codeBlock'; language: string; code: string } & SourceRange)
    | ({ type: 'bulletList'; items: string[] } & SourceRange)
    | ({ type: 'subsection'; title: string; content: LocalPlanContent[] } & SourceRange);

export function parseLocalDebugPlanMarkdown(markdown: string): LocalPlanData {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');

    const header = extractHeader(lines);
    const sections = parseSections(lines, header.firstSectionIdx);

    return {
        title: header.title,
        status: header.status,
        executionMode: header.executionMode,
        headerNote: header.headerNote,
        sections,
    };
}

/**
 * Canonical `Status:` values for `.azure/vscode-debug-plan.md`, as defined by the `azure-debug-plan`
 * and `azure-debug-generate` custom agents — see the plan template's
 * `> **Status:** {Planning | Approved | Executing | Implemented}` metadata line. Compared
 * case-insensitively, so callers don't depend on the casing the agent writes.
 */
export const LocalDebugPlanStatus = {
    /** Plan drafted; awaiting the user's approval. */
    planning: 'Planning',
    /** User approved the plan; debug-config generation can begin. */
    approved: 'Approved',
    /** Debug-config generation is in progress. */
    executing: 'Executing',
    /** Debug-config generation finished — the terminal status. */
    implemented: 'Implemented',
} as const;

export type LocalDebugPlanStatusValue = typeof LocalDebugPlanStatus[keyof typeof LocalDebugPlanStatus];

/**
 * Matches a `> **Label:** value` metadata row in the plan header, tolerating the markdown
 * variations that show up in practice: an optional leading blockquote `>`, optional bold markers,
 * and the colon sitting either inside or outside the bold (`**Status:**`, `**Status**:`, `Status:`).
 * A colon is required so prose lines that merely mention the label aren't mistaken for metadata.
 * Capture group 1 is the raw value up to end of line.
 */
const STATUS_METADATA_REGEX = /^\s*>?\s*\**Status[:*]*:[:*]*\s*(.+)$/i;
const EXECUTION_MODE_METADATA_REGEX = /^\s*>?\s*\**Execution Mode[:*]*:[:*]*\s*(.+)$/i;

/**
 * Returns true when the debug plan markdown reports the `Implemented` status — the point at which
 * debug-config generation has finished.
 *
 * Kept here (rather than derived from a full parse) so every completion check — resume, autopilot,
 * and the implemented-telemetry watcher — reads "implemented" from one shared source. It reuses the
 * same {@link STATUS_METADATA_REGEX} the header parser uses to identify the status line, so the
 * status-line shape isn't duplicated, and compares the value case-insensitively against the terminal
 * {@link LocalDebugPlanStatus.implemented}.
 */
export function isDebugPlanImplemented(content: string): boolean {
    return content.split(/\r?\n/).some((line) => {
        const value = line.match(STATUS_METADATA_REGEX)?.[1]?.trim();
        return value?.toLowerCase() === LocalDebugPlanStatus.implemented.toLowerCase();
    });
}

function extractHeader(lines: string[]): { title: string; status: string; executionMode: string; headerNote: string; firstSectionIdx: number } {
    let title = 'Local Development Plan';
    let status = 'Unknown';
    let executionMode = 'Unknown';
    const noteLines: string[] = [];
    let firstSectionIdx = lines.length;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        if (trimmed.match(/^#\s/) && !trimmed.match(/^##/)) {
            const match = trimmed.match(/^#\s+(.+)$/);
            if (match) { title = match[1].trim(); }
            continue;
        }

        if (trimmed.match(/^##(?!#)\s+/)) {
            firstSectionIdx = i;
            break;
        }

        if (trimmed.startsWith('>')) {
            const text = trimmed.replace(/^>\s?/, '').trim();
            const statusMatch = text.match(STATUS_METADATA_REGEX);
            const executionModeMatch = text.match(EXECUTION_MODE_METADATA_REGEX);
            if (statusMatch) {
                status = statusMatch[1].trim();
            } else if (executionModeMatch) {
                executionMode = executionModeMatch[1].trim();
            } else if (text) {
                noteLines.push(text);
            }
            continue;
        }
    }

    return { title, status, executionMode, headerNote: noteLines.join(' '), firstSectionIdx };
}

function parseSections(lines: string[], startIdx: number): LocalPlanSection[] {
    const sections: LocalPlanSection[] = [];
    let i = startIdx;

    while (i < lines.length) {
        const match = lines[i].match(/^##(?!#)\s+(.+)$/);
        if (match) {
            const sectionTitle = match[1].trim();
            i++;
            const endIdx = findNextH2(lines, i);
            const content = parseContent(lines, i, endIdx);
            sections.push({ title: sectionTitle, content });
            i = endIdx;
        } else {
            i++;
        }
    }

    return sections;
}

function findNextH2(lines: string[], from: number): number {
    for (let i = from; i < lines.length; i++) {
        if (lines[i].match(/^##(?!#)\s+/)) { return i; }
    }
    return lines.length;
}

function parseContent(lines: string[], start: number, end: number): LocalPlanContent[] {
    const content: LocalPlanContent[] = [];
    let i = start;

    while (i < end) {
        const trimmed = lines[i].trim();

        if (trimmed === '' || trimmed === '---') {
            i++;
            continue;
        }

        // Skip HTML comments (e.g. <!-- guidance -->), including multi-line comment blocks —
        // they're authoring hints in the source markdown, not content to render.
        if (trimmed.startsWith('<!--')) {
            while (i < end && !lines[i].includes('-->')) {
                i++;
            }
            if (i < end) { i++; }
            continue;
        }

        // Skip raw HTML wrappers (e.g. <details>/<summary>) — they're presentation hints
        // for the source markdown, not content the structured view should render.
        if (/^<\/?(details|summary)\b/i.test(trimmed)) {
            i++;
            continue;
        }

        const blockStart = i;

        // Sub-section heading (###)
        const subMatch = trimmed.match(/^###\s+(.+)$/);
        if (subMatch) {
            const subTitle = subMatch[1].trim();
            i++;
            let subEnd = i;
            while (subEnd < end && !lines[subEnd].trim().match(/^###\s+/)) {
                subEnd++;
            }
            const subContent = parseContent(lines, i, subEnd);
            content.push({ type: 'subsection', title: subTitle, content: subContent, lineStart: blockStart, lineEnd: subEnd - 1 });
            i = subEnd;
            continue;
        }

        // Code block
        if (trimmed.startsWith('```')) {
            const lang = trimmed.substring(3).trim();
            i++;
            const codeLines: string[] = [];
            while (i < end && !lines[i].trim().startsWith('```')) {
                codeLines.push(lines[i]);
                i++;
            }
            if (i < end) { i++; }
            content.push({ type: 'codeBlock', language: lang, code: codeLines.join('\n'), lineStart: blockStart, lineEnd: i - 1 });
            continue;
        }

        // Table
        if (trimmed.startsWith('|')) {
            const headers = parseTableRow(trimmed);
            const rowLines: number[] = [];
            i++;
            if (i < end && lines[i].trim().match(/^\|[-\s|:]+$/)) {
                i++;
            }
            const rows: string[][] = [];
            while (i < end && lines[i].trim().startsWith('|')) {
                rows.push(parseTableRow(lines[i].trim()));
                rowLines.push(i);
                i++;
            }
            content.push({ type: 'table', headers, rows, rowLines, lineStart: blockStart, lineEnd: i - 1 });
            continue;
        }

        // Bullet list
        if (trimmed.startsWith('- ')) {
            const items: string[] = [];
            while (i < end && lines[i].trim().startsWith('- ')) {
                items.push(lines[i].trim().substring(2).trim());
                i++;
            }
            content.push({ type: 'bulletList', items, lineStart: blockStart, lineEnd: i - 1 });
            continue;
        }

        // Blockquote
        if (trimmed.startsWith('>')) {
            const quoteLines: string[] = [];
            while (i < end && (lines[i].trim().startsWith('>') || lines[i].trim() === '>')) {
                quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
                i++;
            }
            content.push({ type: 'blockquote', text: quoteLines.join(' ').trim(), lineStart: blockStart, lineEnd: i - 1 });
            continue;
        }

        // Paragraph
        content.push({ type: 'paragraph', text: trimmed, lineStart: blockStart, lineEnd: blockStart });
        i++;
    }

    return content;
}

function parseTableRow(line: string): string[] {
    let parts = line.split('|');
    if (parts.length > 0 && parts[0].trim() === '') {
        parts = parts.slice(1);
    }
    if (parts.length > 0 && parts[parts.length - 1].trim() === '') {
        parts = parts.slice(0, -1);
    }
    return parts.map((cell) => cell.trim());
}

//#region Query helpers

/** A parsed markdown table content block. */
export type LocalPlanTableContent = Extract<LocalPlanContent, { type: 'table' }>;

/** Finds the first top-level section whose title contains `titleFragment` (case-insensitive). */
export function findSection(plan: LocalPlanData, titleFragment: string): LocalPlanSection | undefined {
    const needle = titleFragment.toLowerCase();
    return plan.sections.find((section) => section.title.toLowerCase().includes(needle));
}

/** Recursively flattens section content, descending into subsections. */
export function flattenContent(content: LocalPlanContent[]): LocalPlanContent[] {
    const flattened: LocalPlanContent[] = [];
    for (const item of content) {
        flattened.push(item);
        if (item.type === 'subsection') {
            flattened.push(...flattenContent(item.content));
        }
    }
    return flattened;
}

/** Returns the first table in a section (searching nested subsections), if any. */
export function firstTable(section: LocalPlanSection): LocalPlanTableContent | undefined {
    return flattenContent(section.content).find((content): content is LocalPlanTableContent => content.type === 'table');
}

/** Finds the first table in a section (searching nested subsections) whose headers include every anchor. */
export function findTable(section: LocalPlanSection, anchorHeaders: string[]): LocalPlanTableContent | undefined {
    const anchors = anchorHeaders.map((header) => header.toLowerCase());
    for (const content of flattenContent(section.content)) {
        if (content.type !== 'table') {
            continue;
        }
        const headers = content.headers.map((header) => header.toLowerCase());
        if (anchors.every((anchor) => headers.some((header) => header.includes(anchor)))) {
            return content;
        }
    }
    return undefined;
}

/**
 * Finds the index of a column by header name, matching a case-insensitive substring.
 */
export function findColumnIndex(headers: string[], name: string): number {
    const needle = name.toLowerCase().trim();
    return headers.findIndex((header) => header.toLowerCase().trim().includes(needle));
}

/** Whether a table cell represents a checked checkbox (`[x]`). */
export function isChecked(cell: string): boolean {
    return /\[\s*x\s*\]/i.test(cell);
}

//#endregion
