/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DeploymentPlanData, type DeploymentPlanTable } from "../../views/utils/deploymentPlanTypes";

export const DEPLOYMENT_PLAN_TELEMETRY_PREFIX = 'deploymentPlan.';

export interface DeploymentPlanTelemetry {
    /** Whether the plan markdown parsed into a structured view without error. */
    planParsedOk: boolean;
    /** Reported plan status (e.g. `planning`, `validated`, `deployed`). Normalized token, or `unknown`. */
    planStatus: string;
    /** Reported deployment mode (e.g. `modernize existing`, `new`). Normalized token, or `unknown`. */
    planMode: string;

    /** Target subscription identifier as authored in the plan. Empty when none is selected. */
    subscriptionId: string;
    /** Target Azure location (e.g. `westus2`). */
    location: string;

    /** Requirement classification (e.g. `development`, `production`). Normalized token, or `unknown`. */
    classification: string;
    /** Requirement scale (e.g. `small`). Normalized token, or `unknown`. */
    scale: string;
    /** Requirement budget posture (e.g. `cost-optimized`). Normalized token, or `unknown`. */
    budget: string;

    /** Selected deployment recipe (e.g. `azd (bicep)`). Normalized token, or `unknown`. */
    recipe: string;
    /** Selected architecture stack (e.g. `serverless + static web apps`). Normalized token, or `unknown`. */
    stack: string;

    /** Number of distinct core Azure services that will be built (from the service mapping). */
    coreServiceCount: number;
    /** Distinct core Azure service types that will be built, comma-separated. */
    coreServiceTypes: string;
    /** Distinct core Azure service SKUs / tiers (e.g. `fc1`, `free`), comma-separated. */
    coreServiceSkus: string;
    /** Whether the plan involves a database (and therefore may need migrations). */
    hasDatabase: boolean;

    /** Number of distinct supporting services (e.g. monitoring, key vault, managed identity). */
    supportingServiceCount: number;
    /** Distinct supporting service types, comma-separated. */
    supportingServiceTypes: string;
}

export function getDeploymentPlanTelemetry(planData: DeploymentPlanData): DeploymentPlanTelemetry {
    const services = getCoreServiceMetrics(planData.resources);
    const supporting = getSupportingServiceMetrics(planData);

    return {
        planParsedOk: !planData.parseError,
        planStatus: normalizeToken(planData.status) || 'unknown',
        planMode: normalizeToken(planData.mode) || 'unknown',

        subscriptionId: planData.subscription.trim(),
        location: normalizeToken(planData.locationCode) || 'unknown',

        classification: findAttribute(planData.requirements, 'Classification'),
        scale: findAttribute(planData.requirements, 'Scale'),
        budget: findAttribute(planData.requirements, 'Budget'),

        recipe: normalizeToken(planData.recipe ?? '') || 'unknown',
        stack: normalizeToken(planData.stack ?? '') || 'unknown',

        coreServiceCount: services.count,
        coreServiceTypes: services.types,
        coreServiceSkus: services.skus,
        hasDatabase: hasDatabaseDependency(services.types),

        supportingServiceCount: supporting.count,
        supportingServiceTypes: supporting.types,
    };
}

//#region Section metrics

/**
 * Reads distinct core Azure service types and SKUs from the resources / service-mapping table. The plan lists
 * services in a single flat table with no stable mapping back to the individual project components that
 * consume them, and both sets are deduped, so the returned `types` and `skus` are independent sets kept in
 * document order — they are not positionally aligned per service.
 */
function getCoreServiceMetrics(table: DeploymentPlanTable): { count: number; types: string; skus: string } {
    const serviceIdx = findColumnIndex(table.headers, ['azure service', 'service', 'azure resource', 'resource type', 'resource']);
    const skuIdx = findColumnIndex(table.headers, ['sku', 'tier']);
    if (serviceIdx < 0) {
        return { count: 0, types: '', skus: '' };
    }

    const types = new Set<string>();
    const skus = new Set<string>();
    for (const row of table.rows) {
        addToken(types, cell(row, serviceIdx));
        addToken(skus, cell(row, skuIdx));
    }

    return { count: types.size, types: joinSet(types), skus: joinSet(skus) };
}

/**
 * Reads distinct supporting services from the `Supporting Services` architecture subsection, which the
 * parser surfaces as an architecture table keyed by its subsection title.
 */
function getSupportingServiceMetrics(planData: DeploymentPlanData): { count: number; types: string } {
    const table = planData.architecture.find(entry => /supporting services/i.test(entry.title ?? ''))?.table;
    if (!table) {
        return { count: 0, types: '' };
    }

    const serviceIdx = Math.max(0, findColumnIndex(table.headers, ['service', 'component', 'resource']));
    const types = new Set<string>();
    for (const row of table.rows) {
        addToken(types, cell(row, serviceIdx));
    }

    return { count: types.size, types: joinSet(types) };
}

/**
 * Detects whether the plan involves a database (and therefore may need migrations) by scanning the
 * Azure service types for a database-like token.
 */
function hasDatabaseDependency(azureServiceTypes: string): boolean {
    return /\b(?:postgres|mysql|mariadb|sqlite|mssql|sql server|sql|mongo|cosmos|oracle|dynamo|database)/.test(azureServiceTypes.toLowerCase());
}

//#endregion

//#region Parsing helpers

/** Reads an attribute value from a two-column `Attribute | Value` table, normalized to a token, or `unknown`. */
function findAttribute(table: DeploymentPlanTable | undefined, attribute: string): string {
    if (!table) {
        return 'unknown';
    }
    const needle = attribute.toLowerCase();
    const row = table.rows.find(candidate => cell(candidate, 0).toLowerCase().trim() === needle);
    return (row && normalizeToken(cell(row, 1))) || 'unknown';
}

/** Finds the first header whose normalized text matches (equals or contains) one of the candidates, in order. */
function findColumnIndex(headers: string[], candidates: string[]): number {
    const normalized = headers.map(normalizeHeader);
    for (const candidate of candidates) {
        const index = normalized.findIndex(header => header === candidate || header.includes(candidate));
        if (index >= 0) {
            return index;
        }
    }
    return -1;
}

function cell(row: string[], index: number): string {
    return index >= 0 && index < row.length ? row[index] : '';
}

function normalizeHeader(header: string): string {
    return header
        .replace(/[`*_]/g, '')
        .replace(/\s*\/\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function addToken(set: Set<string>, value: string | undefined): void {
    const token = normalizeToken(value ?? '');
    if (token) {
        set.add(token);
    }
}

function joinSet(set: Set<string>): string {
    // Deduped, in document order (Sets preserve insertion order); not sorted.
    return [...set].join(',');
}

/** Lowercases and collapses a value to a stable, low-cardinality token; drops placeholder dashes. */
function normalizeToken(value: string): string {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === '' || trimmed === '—' || trimmed === '-' || trimmed === 'n/a') {
        return '';
    }
    return trimmed.replace(/\s+/g, ' ');
}

//#endregion
