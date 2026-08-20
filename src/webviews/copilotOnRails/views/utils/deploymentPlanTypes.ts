/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DeploymentPlanTable {
    headers: string[];
    rows: string[][];
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
    /** Services the plan will provision, projected into an editable `Service … SKU` table. */
    resources: DeploymentPlanTable;
    /** Services the plan will provision, in plan order. */
    services?: DeploymentPlanService[];
    costEstimate?: DeploymentPlanCostEstimate;
    postDeployRecommendations?: DeploymentPlanRecommendation[];
    deploymentVariables?: DeploymentPlanDeploymentVariables;
    parseError?: DeploymentPlanParseError;
}

export interface DeploymentPlanParseError {
    message: string;
    fileLabel?: string;
}
