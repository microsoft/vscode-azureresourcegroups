/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Canonical `Status:` values for `.azure/project-plan.md` and the shared logic
 * for comparing them. This module has no `vscode` dependency on purpose so both
 * the extension (which writes/reads status transitions) and the plan webview
 * (which gates UI on them) reference one source of truth instead of duplicating
 * status string literals.
 */
export const ProjectPlanStatus = {
    /** User approved the generated project plan. */
    approved: 'Approved',
    /** Scaffold finished; awaiting the user's UI approval before integration. */
    awaitingIntegration: 'Awaiting Integration',
    /** User approved the UI; the integrate phase is in progress. */
    integrating: 'Integrating',
    /** Integration completed. */
    integrated: 'Integrated',
} as const;

export type ProjectPlanStatusValue = typeof ProjectPlanStatus[keyof typeof ProjectPlanStatus];

const STATUS_LINE_REGEX = /^(\*\*Status\*\*:[ \t]*)([^\r\n]*)/m;

/**
 * Plan statuses at or beyond the "approved" gate: the plan has been approved and
 * the flow has moved into scaffolding/integration/execution. Compared
 * case-insensitively, so entries are lowercase.
 */
export const APPROVED_OR_LATER_STATUSES: readonly string[] = [
    'approved',
    'in progress',
    'awaiting integration',
    'integrating',
    'integrated',
    'executing',
    'implemented',
];

/** Normalizes a raw status string for case-insensitive comparison. */
function normalizeStatus(status: string | undefined): string {
    return status?.trim().toLowerCase() ?? '';
}

/** Case-insensitive check that a raw status string is at/after the approval gate. */
export function isApprovedOrLater(status: string | undefined): boolean {
    const s = normalizeStatus(status);
    return s.length > 0 && APPROVED_OR_LATER_STATUSES.includes(s);
}

/** Case-insensitive equality between a raw status and a canonical value. */
export function statusEquals(raw: string | undefined, canonical: ProjectPlanStatusValue): boolean {
    return normalizeStatus(raw) === canonical.toLowerCase();
}

/** Replaces only the canonical status metadata value in plan markdown. */
export function replaceProjectPlanStatus(content: string, newStatus: string): string | undefined {
    if (!STATUS_LINE_REGEX.test(content)) {
        return undefined;
    }
    return content.replace(STATUS_LINE_REGEX, (_full, prefix: string) => `${prefix}${newStatus}`);
}

/** Adds or updates the execution-mode metadata row beside the plan's mode/status rows. */
export function setProjectPlanExecutionMode(content: string, mode: 'auto' | 'guided'): string {
    const row = `**Execution Mode**: ${mode}`;
    const lines = content.split('\n');
    const existingAt = lines.findIndex(line => /^\*\*Execution\s*Mode\*\*\s*[:=]/i.test(line.trim()));
    if (existingAt >= 0) {
        lines[existingAt] = row;
        return lines.join('\n');
    }

    let insertAt = lines.findIndex(line => /^\*\*Mode\*\*\s*:/i.test(line.trim()));
    if (insertAt < 0) {
        insertAt = lines.findIndex(line => /^\*\*Status\*\*\s*:/i.test(line.trim()));
    }
    if (insertAt < 0) {
        insertAt = lines.findIndex(line => line.trim().startsWith('# '));
    }
    if (insertAt < 0) {
        lines.unshift(row, '');
    } else {
        lines.splice(insertAt + 1, 0, row);
    }
    return lines.join('\n');
}
