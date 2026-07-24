/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { RequirementsData, RequirementsQuestion, RequirementsService } from "../../views/utils/parseRequirements";

export const REQUIREMENTS_TELEMETRY_PREFIX = 'requirements.';

export interface RequirementsTelemetry {
    /** Whether the requirements JSON parsed without error. */
    parsedOk: boolean;
    /** Schema version of the requirements file. */
    schemaVersion: string;
    /** Reported project mode (e.g. `new`, `existing`). Normalized to lowercase, or `unknown`. */
    mode: string;
    /** Execution mode (e.g. `guided`, `auto`). Normalized to lowercase, or `unknown`. */
    executionMode: string;

    /** Total number of services defined. */
    serviceCount: number;
    /** Distinct service roles (e.g. `backend,frontend,worker`), comma-separated and sorted. */
    serviceRoles: string;

    /** Total number of questions. */
    questionCount: number;
    /** Number of questions with status `confirmed`. */
    confirmedCount: number;
    /** Number of questions with status `needs_input`. */
    needsInputCount: number;
    /** Number of questions with status `inferred`. */
    inferredCount: number;

    /** Distinct question categories (e.g. `auth,data,service`), comma-separated and sorted. */
    questionCategories: string;

    /** Distinct service languages chosen (e.g. `typescript`), comma-separated and sorted. */
    serviceLanguages: string;
    /** Distinct frontend frameworks chosen (e.g. `react + vite`), comma-separated and sorted. */
    serviceFrameworks: string;

    /** Data stores selected (e.g. `blob storage,postgresql`), comma-separated and sorted. */
    dataStores: string;
    /** Whether a database data store is selected. */
    hasDatabase: boolean;

    /** Authentication choice, normalized to lowercase, or `none`. */
    auth: string;
}

/**
 * Extracts a flat, telemetry-safe summary from a parsed {@link RequirementsData}.
 */
export function getRequirementsTelemetry(data: RequirementsData): RequirementsTelemetry {
    const services = data.services ?? [];
    const questions = data.questions ?? [];

    return {
        parsedOk: !data.parseError,
        schemaVersion: normalizeToken(data.schemaVersion ?? '') || 'unknown',
        mode: normalizeToken(data.mode ?? '') || 'unknown',
        executionMode: normalizeToken(data.executionMode ?? '') || 'unknown',

        serviceCount: services.length,
        serviceRoles: getServiceRoles(services),

        questionCount: questions.length,
        confirmedCount: questions.filter(q => q.status === 'confirmed').length,
        needsInputCount: questions.filter(q => q.status === 'needs_input').length,
        inferredCount: questions.filter(q => q.status === 'inferred').length,

        questionCategories: getDistinctSorted(questions.map(q => q.category)),

        serviceLanguages: getServiceLanguages(questions),
        serviceFrameworks: getServiceFrameworks(questions),

        dataStores: getDataStores(questions),
        hasDatabase: hasDatabase(questions),

        auth: getAuth(questions),
    };
}

function getServiceRoles(services: RequirementsService[]): string {
    return getDistinctSorted(services.map(s => s.role));
}

function getServiceLanguages(questions: RequirementsQuestion[]): string {
    const values = questions
        .filter(q => q.id.endsWith(':language') && q.answer && typeof q.answer === 'string')
        .map(q => q.answer as string);
    return getDistinctSorted(values);
}

function getServiceFrameworks(questions: RequirementsQuestion[]): string {
    const values = questions
        .filter(q => q.id.endsWith(':framework') && q.answer && typeof q.answer === 'string')
        .map(q => q.answer as string);
    return getDistinctSorted(values);
}

function getDataStores(questions: RequirementsQuestion[]): string {
    const q = questions.find(q => q.id === 'dataStores');
    if (!q || !Array.isArray(q.answer)) {
        return '';
    }
    return getDistinctSorted(q.answer.filter((v): v is string => typeof v === 'string'));
}

function hasDatabase(questions: RequirementsQuestion[]): boolean {
    const stores = getDataStores(questions);
    return /\b(?:postgres|mysql|mariadb|sqlite|mssql|sql server|sql|mongo|cosmos|oracle|database|azure sql)\b/.test(stores);
}

function getAuth(questions: RequirementsQuestion[]): string {
    const q = questions.find(q => q.id === 'auth');
    if (!q || !q.answer || typeof q.answer !== 'string') {
        return 'none';
    }
    return normalizeToken(q.answer) || 'none';
}

function getDistinctSorted(values: string[]): string {
    const set = new Set<string>();
    for (const v of values) {
        const token = normalizeToken(v);
        if (token) {
            set.add(token);
        }
    }
    return [...set].sort().join(',');
}

function normalizeToken(value: string): string {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === '' || trimmed === '—' || trimmed === '-' || trimmed === 'n/a') {
        return '';
    }
    return trimmed.replace(/\s+/g, ' ');
}
