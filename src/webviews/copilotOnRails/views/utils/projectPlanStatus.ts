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
    /** Scaffold finished; awaiting the user's UI approval before integration. */
    awaitingIntegration: 'Awaiting Integration',
    /** User approved the UI; the integrate phase is in progress. */
    integrating: 'Integrating',
    /** Integration completed. */
    integrated: 'Integrated',
} as const;

export type ProjectPlanStatusValue = typeof ProjectPlanStatus[keyof typeof ProjectPlanStatus];

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
