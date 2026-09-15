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
import { isJsonObject } from '../../shared/jsonUtils';

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

/**
 * Alternate tokens for the same service. The prepare agent emits more than one dialect of
 * `prepare-plan.json`, so kebab-case `services[].kind` tokens resolve onto the canonical key.
 */
const SERVICE_NAME_ALIASES: Record<string, string[]> = {
    apiManagement: ['api-management', 'apim'],
    appConfiguration: ['app-configuration'],
    applicationInsights: ['application-insights', 'app-insights', 'appInsights', 'insights'],
    appService: ['app-service', 'web-app', 'webapp', 'appservice-webapp'],
    appServicePlan: ['app-service-plan', 'server-farm'],
    azureOpenAI: ['azure-openai', 'openai'],
    cognitiveServices: ['cognitive-services', 'ai-services', 'azure-ai-services'],
    containerApp: ['container-app', 'container-apps'],
    containerAppsEnvironment: ['container-apps-environment', 'container-app-environment'],
    containerRegistry: ['container-registry', 'acr'],
    cosmosDb: ['cosmos-db', 'cosmos', 'cosmosdb-account'],
    eventHub: ['event-hub', 'event-hubs'],
    frontDoor: ['front-door'],
    functionApp: ['azure-functions', 'function-app', 'function-apps', 'functionapps'],
    keyVault: ['key-vault'],
    logAnalyticsWorkspace: ['log-analytics', 'log-analytics-workspace', 'logAnalytics'],
    mysqlFlexibleServer: ['mysql-flexible-server', 'mysql', 'mysql-server', 'mysqlServer'],
    postgresFlexibleServer: [
        'postgres-flexible-server',
        'postgresql-flexible-server',
        'postgres',
        'postgresql',
        'postgres-server',
        'postgresServer',
    ],
    redisCache: ['redis-cache', 'redis', 'azure-cache-for-redis'],
    searchService: ['search-service', 'ai-search', 'azure-ai-search', 'cognitive-search'],
    serviceBus: ['service-bus'],
    signalR: ['signalr-service'],
    sqlDatabase: ['sql-database', 'azure-sql', 'azure-sql-database'],
    sqlServer: ['sql-server'],
    staticWebApp: ['static-web-app', 'static-web-apps', 'swa'],
    storageAccount: ['storage-account', 'storage'],
    userAssignedIdentity: ['user-assigned-identity', 'user-assigned-managed-identity', 'managed-identity'],
    virtualNetwork: ['virtual-network', 'vnet'],
};

/** ARM resource types -> canonical service key, for plans that identify services by `azureService`. */
const SERVICE_KEY_BY_ARM_TYPE: Record<string, string> = {
    'Microsoft.ApiManagement/service': 'apiManagement',
    'Microsoft.App/containerApps': 'containerApp',
    'Microsoft.App/managedEnvironments': 'containerAppsEnvironment',
    'Microsoft.AppConfiguration/configurationStores': 'appConfiguration',
    'Microsoft.Cache/redis': 'redisCache',
    'Microsoft.Cdn/profiles': 'frontDoor',
    'Microsoft.CognitiveServices/accounts': 'cognitiveServices',
    'Microsoft.ContainerRegistry/registries': 'containerRegistry',
    'Microsoft.DBforMySQL/flexibleServers': 'mysqlFlexibleServer',
    'Microsoft.DBforPostgreSQL/flexibleServers': 'postgresFlexibleServer',
    'Microsoft.DocumentDB/databaseAccounts': 'cosmosDb',
    'Microsoft.EventHub/namespaces': 'eventHub',
    'Microsoft.Insights/components': 'applicationInsights',
    'Microsoft.KeyVault/vaults': 'keyVault',
    'Microsoft.ManagedIdentity/userAssignedIdentities': 'userAssignedIdentity',
    'Microsoft.Network/frontDoors': 'frontDoor',
    'Microsoft.Network/virtualNetworks': 'virtualNetwork',
    'Microsoft.OperationalInsights/workspaces': 'logAnalyticsWorkspace',
    'Microsoft.Search/searchServices': 'searchService',
    'Microsoft.ServiceBus/namespaces': 'serviceBus',
    'Microsoft.SignalRService/signalR': 'signalR',
    'Microsoft.Sql/servers': 'sqlServer',
    'Microsoft.Sql/servers/databases': 'sqlDatabase',
    'Microsoft.Storage/storageAccounts': 'storageAccount',
    'Microsoft.Web/serverfarms': 'appServicePlan',
    'Microsoft.Web/staticSites': 'staticWebApp',
};

/** `Microsoft.Web/sites` hosts both web apps and function apps; `kind` is the only discriminator. */
const WEB_SITES_ARM_TYPE = 'Microsoft.Web/sites';

/** Normalized alias (lowercase, punctuation removed) -> canonical `SERVICE_DISPLAY_NAMES` key. */
const SERVICE_KEY_BY_ALIAS: Map<string, string> = buildServiceAliasIndex();

export type PreparePlanRenderIssue = 'empty' | 'invalidJson' | 'missingServices';

/** True when the given file content looks like a `prepare-plan.json` document. */
export function isPreparePlanJson(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed.startsWith('{')) {
        return false;
    }
    try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!isJsonObject(parsed)) {
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
    const plan = isJsonObject(raw) ? raw : {};

    const planRegion = readString(plan.region) ?? readString(plan.location);
    const resourceNamesByService = readNamingResources(plan.naming);
    const componentsByService = readComponentMapping(plan.componentMapping);
    const { services, servicesByPlanId, inlineCosts } = readServices(plan.services, planRegion, resourceNamesByService, componentsByService);
    const deploymentVariables = readDeploymentVariables(plan, planRegion);

    const regionCode = firstNonEmpty(
        deploymentVariables?.location,
        planRegion,
        services.find(service => service.region)?.region,
    ) ?? '';

    return {
        // The plan stores only the ARM region code; the view resolves its display name from the
        // live location list once that loads.
        location: '',
        locationCode: regionCode,
        resources: buildServicesTable(services),
        services,
        costEstimate: readCostEstimate(plan.costEstimate, servicesByPlanId, inlineCosts),
        postDeployRecommendations: readRecommendations(plan.postDeployRecommendations)
            ?? readRecommendations(isJsonObject(plan.costEstimate) ? plan.costEstimate.postDeployRecommendations : undefined),
        deploymentVariables,
    };
}

/**
 * Reports why a plan can't be rendered. A plan is only rejected when it carries nothing
 * displayable at all — a plan missing some sections still renders the sections it has.
 */
export function getPreparePlanRenderIssue(content: string, plan: DeploymentPlanData | undefined): PreparePlanRenderIssue | undefined {
    if (content.trim().length === 0) {
        return 'empty';
    }
    if (!plan) {
        return 'invalidJson';
    }
    const hasContent = (plan.services?.length ?? 0) > 0
        || plan.costEstimate !== undefined
        || (plan.postDeployRecommendations?.length ?? 0) > 0
        || plan.deploymentVariables !== undefined
        || plan.locationCode.length > 0;
    return hasContent ? undefined : 'missingServices';
}

/** Human-readable label for a `services[].name` (or `services[].kind`) token. */
export function getServiceDisplayName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
        return '';
    }
    const canonical = resolveServiceKey(trimmed);
    return (canonical ? SERVICE_DISPLAY_NAMES[canonical] : undefined) ?? titleCaseFromCamel(trimmed);
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

/**
 * Reads `services[]` in any dialect the prepare agent emits, filling gaps from
 * `naming.resources` and `componentMapping[]`. Also indexes services by their plan-level
 * `id`, which `costEstimate.byService[]` references instead of repeating the label, and
 * collects per-service costs for plans that omit a `costEstimate` breakdown array.
 */
function readServices(
    value: unknown,
    planRegion: string | undefined,
    resourceNamesByService: Map<string, string>,
    componentsByService: Map<string, string>,
): { services: DeploymentPlanService[]; servicesByPlanId: Map<string, DeploymentPlanService>; inlineCosts: DeploymentPlanCostBreakdownItem[] } {
    const servicesByPlanId = new Map<string, DeploymentPlanService>();
    const services: DeploymentPlanService[] = [];
    const inlineCosts: DeploymentPlanCostBreakdownItem[] = [];

    for (const entry of readArray(value)) {
        const planId = readString(entry.id);
        const name = readServiceNameToken(entry);
        const canonicalKey = name ? resolveServiceKey(name) : undefined;
        const service: DeploymentPlanService = {
            name,
            sku: readServiceSku(entry),
            component: readString(entry.component)
                ?? readString(entry.componentId)
                ?? readString(entry.componentPath)
                ?? (planId ? componentsByService.get(normalizeServiceToken(planId)) : undefined)
                ?? planId
                ?? '',
            purpose: readString(entry.purpose) ?? readString(entry.notes) ?? readString(entry.description) ?? '',
            region: readString(entry.region) ?? readString(entry.location) ?? planRegion ?? '',
            resourceName: readString(entry.resourceName)
                ?? readString(entry.resource)
                ?? (canonicalKey ? resourceNamesByService.get(canonicalKey) : undefined)
                ?? '',
            version: readString(entry.version) ?? readString(entry.engineVersion),
        };
        if (service.name.length === 0 && service.resourceName.length === 0 && service.purpose.length === 0 && service.component.length === 0) {
            continue;
        }
        services.push(service);
        if (planId) {
            servicesByPlanId.set(normalizeServiceToken(planId), service);
        }

        const monthlyUsd = readNumber(entry.estimatedMonthlyCostUsd) ?? readNumber(entry.monthlyCostUsd) ?? readNumber(entry.monthlyUsd);
        if (monthlyUsd !== undefined) {
            inlineCosts.push({
                service: getServiceDisplayName(service.name),
                sku: service.sku,
                monthlyUsd,
                note: readString(entry.costAssumptions) ?? readString(entry.costAssumption) ?? service.purpose,
            });
        }
    }

    return { services, servicesByPlanId, inlineCosts };
}

/**
 * Picks the token identifying a service entry: the first candidate resolving to a known
 * service wins, so an ARM type beats a literal Azure `kind` like `"StorageV2"`.
 * Unrecognized entries keep their most descriptive raw token rather than being dropped.
 */
function readServiceNameToken(entry: Record<string, unknown>): string {
    const armType = readString(entry.azureService) ?? readString(entry.resourceType) ?? readString(entry.armType);
    const kind = readString(entry.kind);

    const explicitName = readString(entry.name);
    if (explicitName && resolveServiceKey(explicitName)) {
        return explicitName;
    }

    // A compound `resourceType` bundles the supporting resources of one service, e.g.
    // `"Microsoft.Web/sites (functionapp,linux) + Microsoft.Web/serverfarms"`. The leading
    // recognizable segment names the service; its parenthetical carries the ARM `kind`.
    for (const segment of splitArmTypes(armType)) {
        if (normalizeServiceToken(segment.type) === normalizeServiceToken(WEB_SITES_ARM_TYPE)) {
            return (segment.kind ?? kind)?.toLowerCase().includes('functionapp') ? 'functionApp' : 'appService';
        }
        if (resolveServiceKey(segment.type)) {
            return segment.type;
        }
    }

    const candidates = [kind, readString(entry.type), readString(entry.service), readString(entry.id)];
    const recognized = candidates.find(candidate => candidate !== undefined && resolveServiceKey(candidate) !== undefined);
    return recognized ?? firstNonEmpty(
        explicitName,
        splitArmTypes(armType)[0]?.type,
        kind,
        readString(entry.type),
        readString(entry.service),
        readString(entry.id),
    ) ?? '';
}

/** Splits a possibly compound ARM type into its segments, lifting each `(kind)` parenthetical. */
function splitArmTypes(value: string | undefined): { type: string; kind: string | undefined }[] {
    if (!value) {
        return [];
    }
    return value.split('+').map(segment => ({
        type: segment.replace(/\([^)]*\)/g, ' ').trim(),
        kind: /\(([^)]*)\)/.exec(segment)?.[1].trim(),
    })).filter(segment => segment.type.length > 0);
}

/** Reads the SKU, which some plans write as an object of SKU facets rather than a string. */
function readServiceSku(entry: Record<string, unknown>): string {
    const direct = readString(entry.sku) ?? readString(entry.skuName) ?? readString(entry.planSku) ?? readString(entry.tier);
    if (direct) {
        return direct;
    }
    if (!isJsonObject(entry.sku)) {
        return '';
    }
    const sku = entry.sku;
    return readString(sku.name)
        ?? readString(sku.plan)
        ?? readString(sku.tier)
        ?? readString(sku.capacity)
        ?? Object.values(sku).map(readString).filter(value => value !== undefined).join(', ');
}

/** Indexes `componentMapping[]` by the service id it targets, for the table's Component column. */
function readComponentMapping(value: unknown): Map<string, string> {
    const byService = new Map<string, string>();
    for (const entry of readArray(value)) {
        const target = readString(entry.targetService) ?? readString(entry.service) ?? readString(entry.serviceId);
        const component = readString(entry.componentId) ?? readString(entry.component);
        if (target && component) {
            const key = normalizeServiceToken(target);
            if (!byService.has(key)) {
                byService.set(key, component);
            }
        }
    }
    return byService;
}

/**
 * Indexes `naming.resources` by canonical service key, accepting both the `[{ type, name }]`
 * array and the `{ functionApp: "func-…" }` object map. Unknown keys (`resourceGroup`) are skipped.
 */
function readNamingResources(value: unknown): Map<string, string> {
    const byService = new Map<string, string>();
    if (!isJsonObject(value)) {
        return byService;
    }

    const add = (token: string | undefined, resourceName: string | undefined): void => {
        const key = token ? resolveServiceKey(token) : undefined;
        if (key && resourceName && !byService.has(key)) {
            byService.set(key, resourceName);
        }
    };

    for (const entry of readArray(value.resources)) {
        add(readString(entry.type) ?? readString(entry.kind), readString(entry.name));
    }
    if (isJsonObject(value.resources)) {
        for (const [token, resourceName] of Object.entries(value.resources)) {
            add(token, readString(resourceName));
        }
    }
    return byService;
}

function readCostEstimate(
    value: unknown,
    servicesByPlanId: Map<string, DeploymentPlanService>,
    inlineCosts: DeploymentPlanCostBreakdownItem[],
): DeploymentPlanCostEstimate | undefined {
    if (!isJsonObject(value)) {
        return undefined;
    }
    const items = firstArray(value.breakdown, value.items, value.byService);
    const breakdown: DeploymentPlanCostBreakdownItem[] = readArray(items).map(entry => {
        // `byService[]` carries only an id and an amount; the label and SKU come from services[].
        const planId = readString(entry.id);
        const linkedService = planId ? servicesByPlanId.get(normalizeServiceToken(planId)) : undefined;
        return {
            service: readString(entry.service)
                ?? readString(entry.name)
                ?? (linkedService ? getServiceDisplayName(linkedService.name) : undefined)
                ?? (planId ? titleCaseFromCamel(planId) : ''),
            sku: readString(entry.sku) ?? readString(entry.skuName) ?? linkedService?.sku ?? '',
            monthlyUsd: readNumber(entry.monthlyUsd) ?? readNumber(entry.monthlyCostUsd) ?? readNumber(entry.usd) ?? 0,
            note: readString(entry.note) ?? readString(entry.assumption) ?? linkedService?.purpose,
        };
    });
    // Some plans price each service inline and give only a range here, with no breakdown array.
    const effectiveBreakdown = breakdown.length > 0 ? breakdown : inlineCosts;
    const monthlyUsd = readNumber(value.monthlyUsd)
        ?? readNumber(value.monthlyTotalUsd)
        ?? readNumber(value.totalMonthlyUsd)
        ?? readNumber(value.totalUsd)
        ?? effectiveBreakdown.reduce((total, item) => total + item.monthlyUsd, 0);

    return {
        monthlyUsd,
        currency: readString(value.currency) ?? 'USD',
        breakdown: effectiveBreakdown,
        disclaimer: readString(value.disclaimer) ?? readStringArray(value.assumptions)?.join(' '),
    };
}

function readRecommendations(value: unknown): DeploymentPlanRecommendation[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const recommendations: DeploymentPlanRecommendation[] = value.map(entry => {
        // Some plans write recommendations as plain strings rather than objects.
        if (typeof entry === 'string') {
            const { title, reason } = splitRecommendationText(entry);
            return { title, reason };
        }
        if (!isJsonObject(entry)) {
            return { title: '', reason: '' };
        }
        const id = readString(entry.id);
        return {
            title: readString(entry.title) ?? (id ? titleCaseFromCamel(id) : ''),
            reason: readString(entry.reason) ?? readString(entry.message) ?? readString(entry.description) ?? '',
            effort: readString(entry.effort) ?? readString(entry.priority),
            services: readStringArray(entry.services),
        };
    }).filter(entry => entry.title.length > 0);
    return recommendations.length > 0 ? recommendations : undefined;
}

/** Splits a free-text recommendation into a bold lead sentence and the rest of the detail. */
function splitRecommendationText(text: string): { title: string; reason: string } {
    const trimmed = text.trim();
    const match = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(trimmed);
    return match ? { title: match[1], reason: match[2] } : { title: trimmed, reason: '' };
}

/**
 * Reads the deployment variables the view displays, falling back to `naming.resourcePrefix`
 * and the plan-level region. `azd`-style `AZURE_ENV_NAME` / `AZURE_LOCATION` keys are read too.
 */
function readDeploymentVariables(plan: Record<string, unknown>, planRegion: string | undefined): DeploymentPlanDeploymentVariables | undefined {
    const variables = isJsonObject(plan.deploymentVariables) ? plan.deploymentVariables : {};
    const naming = isJsonObject(plan.naming) ? plan.naming : {};

    const environmentName = readString(variables.environmentName)
        ?? readString(variables.AZURE_ENV_NAME)
        ?? readString(plan.environmentName)
        ?? readString(naming.resourcePrefix);
    const location = readString(variables.location)
        ?? readString(variables.AZURE_LOCATION)
        ?? planRegion;
    if (environmentName === undefined && location === undefined) {
        return undefined;
    }
    return { environmentName, location };
}

//#endregion

//#region Primitive readers

function readArray(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter(isJsonObject) : [];
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

/** The first of the given values that is a non-empty array — plans name this field differently. */
function firstArray(...values: unknown[]): unknown {
    return values.find(value => Array.isArray(value) && value.length > 0);
}

function titleCaseFromCamel(value: string): string {
    const spaced = value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .trim();
    return spaced
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function buildServiceAliasIndex(): Map<string, string> {
    const index = new Map<string, string>();
    for (const key of Object.keys(SERVICE_DISPLAY_NAMES)) {
        index.set(normalizeServiceToken(key), key);
    }
    for (const [key, aliases] of Object.entries(SERVICE_NAME_ALIASES)) {
        for (const alias of aliases) {
            index.set(normalizeServiceToken(alias), key);
        }
    }
    for (const [armType, key] of Object.entries(SERVICE_KEY_BY_ARM_TYPE)) {
        index.set(normalizeServiceToken(armType), key);
    }
    return index;
}

/** Maps any known service token (canonical or alias) onto its `SERVICE_DISPLAY_NAMES` key. */
function resolveServiceKey(token: string): string | undefined {
    return SERVICE_KEY_BY_ALIAS.get(normalizeServiceToken(token));
}

function normalizeServiceToken(token: string): string {
    return token.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function emptyTable(): DeploymentPlanTable {
    return { headers: [], rows: [] };
}

//#endregion
