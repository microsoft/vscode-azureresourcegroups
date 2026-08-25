/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type DeploymentPlanCostBreakdownItem,
    type DeploymentPlanCostEstimate,
    type DeploymentPlanData,
    type DeploymentPlanDeploymentVariables,
    type DeploymentPlanRecommendation,
    type DeploymentPlanService,
    type DeploymentPlanTable,
} from './deploymentPlanTypes';

/**
 * Friendly labels for the `services[].name` tokens emitted by the prepare phase.
 * Unmapped names fall back to a de-camel-cased title, so a new service type still
 * renders sensibly instead of showing a raw identifier.
 */
const SERVICE_DISPLAY_NAMES: Record<string, string> = {
    apiManagement: 'API Management',
    appConfiguration: 'App Configuration',
    applicationInsights: 'Application Insights',
    appService: 'App Service',
    appServicePlan: 'App Service Plan',
    azureOpenAI: 'Azure OpenAI',
    cognitiveServices: 'Azure AI Services',
    containerApp: 'Container App',
    containerAppsEnvironment: 'Container Apps Environment',
    containerRegistry: 'Container Registry',
    cosmosDb: 'Cosmos DB account',
    eventHub: 'Event Hubs',
    frontDoor: 'Front Door',
    functionApp: 'Functions App',
    functions: 'Functions App',
    keyVault: 'Key Vault',
    logAnalyticsWorkspace: 'Log Analytics Workspace',
    mysqlFlexibleServer: 'MySQL Flexible Server',
    openAI: 'Azure OpenAI',
    postgresFlexibleServer: 'PostgreSQL Flexible Server',
    redisCache: 'Azure Cache for Redis',
    searchService: 'AI Search',
    serviceBus: 'Service Bus',
    signalR: 'SignalR Service',
    sqlDatabase: 'Azure SQL Database',
    sqlServer: 'Azure SQL Server',
    staticWebApp: 'Static Web Apps',
    storageAccount: 'Storage Account',
    userAssignedIdentity: 'Managed Identity',
    virtualNetwork: 'Virtual Network',
};

export type PreparePlanRenderIssue = 'empty' | 'invalidJson' | 'missingServices';

/** True when the given file content looks like a `prepare-plan.json` document. */
export function isPreparePlanJson(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed.startsWith('{')) {
        return false;
    }
    try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!isRecord(parsed)) {
            return false;
        }
        return 'services' in parsed || 'costEstimate' in parsed || 'naming' in parsed;
    } catch {
        return false;
    }
}

/**
 * Parses a `prepare-plan.json` document (the azure-deploy prepare phase artifact) into
 * the structured data rendered by the deployment plan view. Every field is read
 * defensively: a plan that is still being written renders whatever it already contains.
 *
 * Throws only when the content is not valid JSON.
 */
export function parsePreparePlanJson(content: string): DeploymentPlanData {
    const raw: unknown = JSON.parse(content);
    const plan = isRecord(raw) ? raw : {};

    const services = readServices(plan.services);
    const deploymentVariables = readDeploymentVariables(plan.deploymentVariables);

    const regionCode = firstNonEmpty(
        deploymentVariables?.location,
        services.find(service => service.region)?.region,
    ) ?? '';

    return {
        // The plan stores only the ARM region code; the view resolves its display name from the
        // live location list once that loads.
        location: '',
        locationCode: regionCode,
        resources: buildServicesTable(services),
        services,
        costEstimate: readCostEstimate(plan.costEstimate),
        postDeployRecommendations: readRecommendations(plan.postDeployRecommendations),
        deploymentVariables,
    };
}

export function getPreparePlanRenderIssue(content: string, plan: DeploymentPlanData | undefined): PreparePlanRenderIssue | undefined {
    if (content.trim().length === 0) {
        return 'empty';
    }
    if (!plan) {
        return 'invalidJson';
    }
    if ((plan.services?.length ?? 0) === 0) {
        return 'missingServices';
    }
    return undefined;
}

/** Human-readable label for a `services[].name` token. */
export function getServiceDisplayName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
        return '';
    }
    return SERVICE_DISPLAY_NAMES[trimmed] ?? titleCaseFromCamel(trimmed);
}

//#region Table projections

/**
 * Projects `services[]` into the editable resources table. The SKU column is last
 * because the view's SKU dropdown edits the final column of the resources table.
 */
function buildServicesTable(services: DeploymentPlanService[]): DeploymentPlanTable {
    if (services.length === 0) {
        return emptyTable();
    }
    return {
        headers: ['Service', 'Resource Name', 'Component', 'Purpose', 'SKU'],
        rows: services.map(service => [
            getServiceDisplayName(service.name),
            service.version ? `${service.resourceName} (v${service.version})` : service.resourceName,
            service.component,
            service.purpose,
            service.sku,
        ]),
    };
}

//#endregion

//#region Field readers

function readServices(value: unknown): DeploymentPlanService[] {
    return readArray(value).map(entry => ({
        name: readString(entry.name) ?? '',
        sku: readString(entry.sku) ?? '',
        purpose: readString(entry.purpose) ?? '',
        component: readString(entry.component) ?? '',
        region: readString(entry.region) ?? '',
        resourceName: readString(entry.resourceName) ?? '',
        version: readString(entry.version),
    })).filter(service => service.name.length > 0 || service.resourceName.length > 0);
}

function readCostEstimate(value: unknown): DeploymentPlanCostEstimate | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const breakdown: DeploymentPlanCostBreakdownItem[] = readArray(value.breakdown).map(entry => ({
        service: readString(entry.service) ?? '',
        sku: readString(entry.sku) ?? '',
        monthlyUsd: readNumber(entry.monthlyUsd) ?? 0,
        note: readString(entry.note),
    }));
    const monthlyUsd = readNumber(value.monthlyUsd)
        ?? breakdown.reduce((total, item) => total + item.monthlyUsd, 0);

    return {
        monthlyUsd,
        currency: readString(value.currency) ?? 'USD',
        breakdown,
        disclaimer: readString(value.disclaimer),
    };
}

function readRecommendations(value: unknown): DeploymentPlanRecommendation[] | undefined {
    const recommendations: DeploymentPlanRecommendation[] = readArray(value).map(entry => ({
        title: readString(entry.title) ?? '',
        reason: readString(entry.reason) ?? '',
        effort: readString(entry.effort),
        services: readStringArray(entry.services),
    })).filter(entry => entry.title.length > 0);
    return recommendations.length > 0 ? recommendations : undefined;
}

function readDeploymentVariables(value: unknown): DeploymentPlanDeploymentVariables | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    return {
        environmentName: readString(value.environmentName),
        location: readString(value.location),
    };
}

//#endregion

//#region Primitive readers

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readArray(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readString(value: unknown): string | undefined {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    return undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const entries = value
        .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(entry => entry.length > 0);
    return entries.length > 0 ? entries : undefined;
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
    return values.find(value => value !== undefined && value.trim().length > 0)?.trim();
}

function titleCaseFromCamel(value: string): string {
    const spaced = value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function emptyTable(): DeploymentPlanTable {
    return { headers: [], rows: [] };
}

//#endregion
