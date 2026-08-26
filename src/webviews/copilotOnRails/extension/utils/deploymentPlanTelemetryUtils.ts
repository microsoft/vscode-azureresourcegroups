/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DeploymentPlanData, type DeploymentPlanService } from "../../views/utils/deploymentPlanTypes";

export const DEPLOYMENT_PLAN_TELEMETRY_PREFIX = 'deploymentPlan.';

export interface DeploymentPlanTelemetry {
    /** Whether `prepare-plan.json` parsed into a structured view without error. */
    planParsedOk: boolean;

    /** Target Azure location (e.g. `westus2`). */
    location: string;

    /** Number of distinct core Azure services that will be built. */
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

    /** Estimated monthly cost in the plan's currency, or 0 when the plan carries no estimate. */
    estimatedMonthlyCost: number;
}

export function getDeploymentPlanTelemetry(planData: DeploymentPlanData): DeploymentPlanTelemetry {
    const { core, supporting } = getServiceMetrics(planData.services ?? []);

    return {
        planParsedOk: !planData.parseError,

        location: normalizeToken(planData.locationCode) || 'unknown',

        coreServiceCount: core.count,
        coreServiceTypes: core.types,
        coreServiceSkus: core.skus,
        hasDatabase: hasDatabaseDependency(core.types),

        supportingServiceCount: supporting.count,
        supportingServiceTypes: supporting.types,

        estimatedMonthlyCost: planData.costEstimate?.monthlyUsd ?? 0,
    };
}

//#region Service metrics

/**
 * Service tokens (from `prepare-plan.json` `services[].name`) that back the application
 * indirectly — observability, secrets, and identity — rather than hosting or storing app data.
 */
const SUPPORTING_SERVICE_NAMES = new Set([
    'applicationinsights',
    'appconfiguration',
    'keyvault',
    'loganalyticsworkspace',
    'userassignedidentity',
]);

/**
 * Splits `services[]` into the core services that host or store application data and the supporting
 * services (monitoring, secrets, identity). Types and SKUs are deduped independently, so they are
 * not positionally aligned per service; both keep plan order (Sets preserve insertion order).
 */
function getServiceMetrics(services: DeploymentPlanService[]): {
    core: { count: number; types: string; skus: string };
    supporting: { count: number; types: string };
} {
    const coreTypes = new Set<string>();
    const coreSkus = new Set<string>();
    const supportingTypes = new Set<string>();

    for (const service of services) {
        if (SUPPORTING_SERVICE_NAMES.has(service.name.toLowerCase())) {
            addToken(supportingTypes, service.name);
        } else {
            addToken(coreTypes, service.name);
            addToken(coreSkus, service.sku);
        }
    }

    return {
        core: { count: coreTypes.size, types: joinSet(coreTypes), skus: joinSet(coreSkus) },
        supporting: { count: supportingTypes.size, types: joinSet(supportingTypes) },
    };
}

/**
 * Detects whether the plan involves a database (and therefore may need migrations) by scanning the
 * Azure service types for a database-like token.
 */
function hasDatabaseDependency(azureServiceTypes: string): boolean {
    return /\b(?:postgres|mysql|mariadb|sqlite|mssql|sql server|sql|mongo|cosmos|oracle|dynamo|database)/.test(azureServiceTypes.toLowerCase());
}

//#endregion

//#region Helpers

function addToken(set: Set<string>, value: string | undefined): void {
    const token = normalizeToken(value ?? '');
    if (token) {
        set.add(token);
    }
}

function joinSet(set: Set<string>): string {
    // Deduped, in plan order (Sets preserve insertion order); not sorted.
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
