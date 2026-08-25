/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DeploymentPlanTable {
    headers: string[];
    rows: string[][];
}

/**
 * A tool the deploy stage depends on (azd, az), with the install status the agent
 * detected. Sourced from our own `record_deploy_prerequisites` MCP tool (never the
 * vendored `prepare-plan.json`), and the install *link* is never stored here — the
 * view resolves it deterministically from its own catalog by tool name, so agent
 * output can never inject a URL.
 */
export interface DeploymentPrerequisite {
    /** Canonical display name resolved by the tool from a fixed catalog (e.g. "Azure CLI (az)"). */
    tool: string;
    /** True when the agent positively detected the CLI; false means unknown (never "not installed"). */
    installed: boolean;
    version?: string;
}

/** A region the plan can target: `name` is the display name, `code` the ARM region name. */
export interface AzureLocationOption {
    name: string;
    code: string;
}

export interface DeploymentPlanService {
    name: string;
    sku: string;
    purpose: string;
    /** The app/workload component this resource serves (e.g. `scrapbook-api`). */
    component: string;
    region: string;
    resourceName: string;
    /** Exact engine version for managed database services (e.g. PostgreSQL `16`). */
    version?: string;
}

export interface DeploymentPlanCostBreakdownItem {
    service: string;
    sku: string;
    monthlyUsd: number;
    note?: string;
}

export interface DeploymentPlanCostEstimate {
    monthlyUsd: number;
    currency: string;
    breakdown: DeploymentPlanCostBreakdownItem[];
    disclaimer?: string;
}

export interface DeploymentPlanRecommendation {
    title: string;
    reason: string;
    effort?: string;
    services?: string[];
}

export interface DeploymentPlanDeploymentVariables {
    environmentName?: string;
    location?: string;
}

export interface DeploymentPlanData {
    /** Display name of the target region, resolved from the live location list. */
    location: string;
    /** ARM region code the plan targets (e.g. `westus2`). */
    locationCode: string;
    availableLocations?: AzureLocationOption[];
    /**
     * Why {@link availableLocations} is absent, so the view can explain the read-only region
     * instead of silently dropping the picker. Omitted once the live list loads.
     */
    locationsUnavailable?: 'signedOut' | 'failed';
    /** Services the plan will provision, projected into an editable `Service … SKU` table. */
    resources: DeploymentPlanTable;
    /** Services the plan will provision, in plan order. */
    services?: DeploymentPlanService[];
    /**
     * Deploy prerequisites (azd, az) with detected install status, recorded by the
     * `record_deploy_prerequisites` MCP tool. Absent when nothing has been recorded
     * yet; the view then falls back to an azd/az list with an "unknown" status so the
     * section still renders.
     */
    prerequisites?: DeploymentPrerequisite[];
    costEstimate?: DeploymentPlanCostEstimate;
    postDeployRecommendations?: DeploymentPlanRecommendation[];
    deploymentVariables?: DeploymentPlanDeploymentVariables;
    parseError?: DeploymentPlanParseError;
}

export interface DeploymentPlanParseError {
    message: string;
    fileLabel?: string;
}
