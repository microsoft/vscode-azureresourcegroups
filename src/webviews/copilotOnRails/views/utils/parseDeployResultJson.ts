/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type DeployResultData,
    type DeployResultCleanupResource,
    type DeployResultEndpoint,
    type DeployResultHealingAttempt,
    type DeployResultHealthDetail,
    type DeployResultHealthService,
    type DeployResultHealthStatus,
    type DeployResultNetworkPolicy,
    type DeployResultOrphanedResourceGroup,
    type DeployResultResource,
    type DeployResultStatus,
} from './deployResultTypes';

type Json = Record<string, unknown>;

const HEALTH_STATUSES: DeployResultHealthStatus[] = ['healthy', 'degraded', 'unreachable', 'unknown'];
const DEPLOY_STATUSES: DeployResultStatus[] = ['succeeded', 'failed', 'in-progress', 'unknown'];

/**
 * Friendly labels for the well-known keys of the `resources` object map. Any key
 * not listed here falls back to a camelCase-to-Title-Case conversion, so new
 * resource kinds still render sensibly without a code change.
 */
const RESOURCE_TYPE_LABELS: Record<string, string> = {
    functionApp: 'Function App',
    staticWebApp: 'Static Web App',
    appService: 'App Service',
    containerApp: 'Container App',
    containerRegistry: 'Container Registry',
    storage: 'Storage Account',
    storageAccount: 'Storage Account',
    postgres: 'PostgreSQL',
    sql: 'SQL Database',
    cosmos: 'Cosmos DB',
    redis: 'Redis Cache',
    keyVault: 'Key Vault',
    openAI: 'Azure OpenAI',
    appInsights: 'Application Insights',
    logAnalytics: 'Log Analytics',
    managedIdentity: 'Managed Identity',
    servicePlan: 'App Service Plan',
};

/** Endpoint names rendered with a nicer label than the generic title-casing. */
const ENDPOINT_LABELS: Record<string, string> = {
    api: 'API',
    web: 'Web',
    health: 'Health check',
    frontend: 'Frontend',
    backend: 'Backend',
};

/**
 * Order used to pick the endpoint featured as "your app is live at".
 *
 * Only user-facing front ends qualify. "Open app" promises a browsable UI, so a
 * backend-only deployment (a Function App or bare API with no Static Web App)
 * must not offer the button at all rather than opening a JSON endpoint the user
 * can't do anything with. API/backend/health endpoints are therefore never
 * featured — they remain listed in the endpoints section.
 */
const PRIMARY_ENDPOINT_PREFERENCE = ['web', 'frontend', 'app', 'ui', 'portal', 'spa', 'site'];

/**
 * Host suffixes that only ever serve a browsable front end. Names alone are not
 * enough: the artifact's array form omits `name` entirely (every entry then falls
 * back to the generic `endpoint`), so a Static Web App would otherwise go
 * unrecognized and hide the "Open app" button on a deployment that plainly has a
 * front end.
 */
const FRONTEND_HOST_SUFFIXES = [
    '.azurestaticapps.net',   // Static Web Apps
    '.azurefd.net',           // Front Door
    '.azureedge.net',         // CDN
    '.web.core.windows.net',  // Storage static website
];

/** Host suffixes that serve an API/backend, never a browsable front end. */
const BACKEND_HOST_SUFFIXES = [
    '.azurewebsites.net',     // Functions / App Service
];

function endpointHost(url: string): string {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return '';
    }
}

/** True when the URL is served from hosting that only ever fronts a UI. */
function isFrontendUrl(url: string): boolean {
    const host = endpointHost(url);
    return host.length > 0 && FRONTEND_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** True when the URL is an API surface rather than something worth opening in a browser. */
function isBackendUrl(url: string): boolean {
    const host = endpointHost(url);
    return host.length > 0 && BACKEND_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function isRecord(value: unknown): value is Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map(readString).filter(v => v.length > 0);
}

function readBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

/** Turn `functionApp` / `basic_publishing` into `Function app` for display. */
function titleCase(key: string): string {
    const spaced = key
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim();
    if (spaced.length === 0) {
        return key;
    }
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function readHealthStatus(value: unknown): DeployResultHealthStatus {
    const raw = readString(value).toLowerCase();
    return HEALTH_STATUSES.find(s => s === raw) ?? 'unknown';
}

function readStatus(value: unknown): DeployResultStatus {
    const raw = readString(value).toLowerCase();
    return DEPLOY_STATUSES.find(s => s === raw) ?? 'unknown';
}

function endpointLabel(name: string): string {
    return ENDPOINT_LABELS[name] ?? titleCase(name);
}

/**
 * Normalize endpoints from either layout:
 * - object map — `{ "api": "https://...", "web": "https://..." }`
 * - array — `[{ name, url, healthStatus }]` per `deploy-schemas.ts`
 */
function readEndpoints(value: unknown): DeployResultEndpoint[] {
    if (Array.isArray(value)) {
        const endpoints: DeployResultEndpoint[] = [];
        for (const entry of value) {
            if (!isRecord(entry)) {
                continue;
            }
            const url = readString(entry.url);
            if (url.length === 0) {
                continue;
            }
            const name = readString(entry.name) || 'endpoint';
            endpoints.push({
                name,
                label: endpointLabel(name),
                url,
                healthStatus: entry.healthStatus === undefined ? undefined : readHealthStatus(entry.healthStatus),
            });
        }
        return endpoints;
    }

    if (!isRecord(value)) {
        return [];
    }

    const endpoints: DeployResultEndpoint[] = [];
    for (const [name, raw] of Object.entries(value)) {
        // A map value may be a bare URL string or a nested object carrying health.
        if (typeof raw === 'string') {
            const url = readString(raw);
            if (url.length > 0) {
                endpoints.push({ name, label: endpointLabel(name), url });
            }
            continue;
        }
        if (isRecord(raw)) {
            const url = readString(raw.url);
            if (url.length > 0) {
                endpoints.push({
                    name,
                    label: endpointLabel(name),
                    url,
                    healthStatus: raw.healthStatus === undefined ? undefined : readHealthStatus(raw.healthStatus),
                });
            }
        }
    }
    return endpoints;
}

/**
 * Pick the front end to feature as "your app is live at", or `undefined` when the
 * deployment has no browsable UI. Returning `undefined` hides the "Open app"
 * button — deliberately, since there is no front end to open.
 *
 * Endpoint names are unreliable (the array form of the artifact has no `name` at
 * all), so a recognized front-end host wins even when the name says nothing.
 */
function pickPrimaryEndpoint(endpoints: DeployResultEndpoint[]): DeployResultEndpoint | undefined {
    const candidates = endpoints.filter(e => e.name.toLowerCase() !== 'health' && !isBackendUrl(e.url));

    for (const preferred of PRIMARY_ENDPOINT_PREFERENCE) {
        const match = candidates.find(e => e.name.toLowerCase() === preferred);
        if (match) {
            return match;
        }
    }

    const byHost = candidates.find(e => isFrontendUrl(e.url));
    if (byHost) {
        return byHost;
    }

    return undefined;
}

/** Extract the resource name and provider type from a full ARM resource ID. */
function readResourceFromId(resourceId: string): DeployResultResource | undefined {
    const name = resourceId.split('/').filter(Boolean).pop();
    if (!name) {
        return undefined;
    }
    const providerMatch = /\/providers\/[^/]+\/([^/]+)\//i.exec(resourceId);
    const type = providerMatch ? titleCase(providerMatch[1]) : 'Resource';
    return { type, name };
}

function readCreatedResources(value: unknown): DeployResultResource[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const resources: DeployResultResource[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) {
            continue;
        }
        const resourceId = readString(entry.id);
        const fromId = readResourceFromId(resourceId);
        const name = readString(entry.name) || fromId?.name || resourceId;
        if (!name) {
            continue;
        }
        const rawType = readString(entry.type);
        const classification = readString(entry.classification);
        const provisioningState = readString(entry.provisioningState);
        resources.push({
            type: rawType ? titleCase(rawType.split('/').pop() ?? rawType) : (fromId?.type ?? 'Resource'),
            name,
            status: [classification, provisioningState].filter(Boolean).join(' · ') || undefined,
        });
    }
    return resources;
}

/**
 * Normalize resources from any supported artifact layout. The deterministic
 * `createdResources[]` inventory is authoritative when present; otherwise the
 * object map, `resourceResults[]`, or a bare `resourceIds[]` layout is used.
 */
function readResources(plan: Json): DeployResultResource[] {
    const createdResources = readCreatedResources(plan.createdResources);
    if (createdResources.length > 0) {
        return createdResources;
    }

    const map = plan.resources;
    if (isRecord(map)) {
        const resources: DeployResultResource[] = [];
        for (const [key, raw] of Object.entries(map)) {
            const name = readString(raw);
            if (name.length > 0) {
                resources.push({ type: RESOURCE_TYPE_LABELS[key] ?? titleCase(key), name });
            }
        }
        return resources;
    }

    if (Array.isArray(plan.resourceResults) && plan.resourceResults.length > 0) {
        const resources: DeployResultResource[] = [];
        for (const entry of plan.resourceResults) {
            if (!isRecord(entry)) {
                continue;
            }
            const resourceId = readString(entry.resourceId);
            const fromId = readResourceFromId(resourceId);
            const type = readString(entry.type);
            resources.push({
                type: type.length > 0 ? titleCase(type.split('/').pop() ?? type) : (fromId?.type ?? 'Resource'),
                name: fromId?.name ?? resourceId,
                status: readString(entry.status) || undefined,
                error: readString(entry.error) || undefined,
            });
        }
        return resources;
    }

    return readStringArray(plan.resourceIds)
        .map(readResourceFromId)
        .filter((r): r is DeployResultResource => r !== undefined);
}

/** Extract the resource group segment from a full ARM resource ID, if present. */
function readResourceGroupFromId(resourceId: string): string {
    const match = /\/resourceGroups\/([^/]+)/i.exec(resourceId);
    return match ? match[1] : '';
}

/**
 * Build the itemized cleanup list from the deterministic inventory. Only the
 * `failed` and `orphaned` entries of `createdResources[]` need cleanup — a
 * `succeeded`/`expected` resource is part of the working deployment and must be
 * left alone. Each item carries an `az resource delete --ids` command scoped to
 * that single resource, so the user can remove them one at a time instead of
 * dropping the whole resource group.
 */
function readResourcesToCleanup(value: unknown): DeployResultCleanupResource[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const items: DeployResultCleanupResource[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) {
            continue;
        }
        const classification = readString(entry.classification).toLowerCase();
        if (classification !== 'failed' && classification !== 'orphaned') {
            continue;
        }
        const resourceId = readString(entry.id);
        const fromId = readResourceFromId(resourceId);
        const name = readString(entry.name) || fromId?.name || resourceId;
        if (!name) {
            continue;
        }
        const rawType = readString(entry.type);
        const resourceGroup = readString(entry.resourceGroup) || readResourceGroupFromId(resourceId) || undefined;
        // Prefer the ARM ID — `az resource delete --ids` works for any resource
        // type without needing to know the API version. Fall back to a
        // name/group/type triple when the inventory omitted the ID.
        const deleteCommand = resourceId.length > 0
            ? `az resource delete --ids "${resourceId}"`
            : (resourceGroup && rawType
                ? `az resource delete --name "${name}" --resource-group "${resourceGroup}" --resource-type "${rawType}"`
                : '');
        items.push({
            type: rawType ? titleCase(rawType.split('/').pop() ?? rawType) : (fromId?.type ?? 'Resource'),
            name,
            id: resourceId || undefined,
            resourceGroup,
            classification,
            deleteCommand,
        });
    }
    return items;
}

function readHealthDetail(value: unknown): DeployResultHealthDetail | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const services: DeployResultHealthService[] = [];
    if (Array.isArray(value.services)) {
        for (const entry of value.services) {
            if (!isRecord(entry)) {
                continue;
            }
            const name = readString(entry.name);
            if (name.length === 0) {
                continue;
            }
            services.push({
                name,
                state: readString(entry.state) || 'unknown',
                // Dependencies are treated as essential unless explicitly marked optional.
                essential: readBoolean(entry.essential) ?? true,
            });
        }
    }

    const endpoint = readString(value.endpoint);
    const checkedUtc = readString(value.checkedUtc);
    if (services.length === 0 && endpoint.length === 0 && checkedUtc.length === 0) {
        return undefined;
    }
    return {
        endpoint: endpoint || undefined,
        checkedUtc: checkedUtc || undefined,
        services,
    };
}

function readNetworkPolicy(value: unknown): DeployResultNetworkPolicy | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const basicPublishing = isRecord(value.basicPublishing) ? value.basicPublishing : undefined;
    const policy: DeployResultNetworkPolicy = {
        mainSite: readString(value.mainSite) || undefined,
        scmSite: readString(value.scmSite) || undefined,
        basicPublishingScm: basicPublishing ? readBoolean(basicPublishing.scm) : undefined,
        basicPublishingFtp: basicPublishing ? readBoolean(basicPublishing.ftp) : undefined,
    };
    const hasAnyValue = Object.values(policy).some(v => v !== undefined);
    return hasAnyValue ? policy : undefined;
}

/**
 * Normalize a healing attempt. The narrative shape carries `issue`/`resolution`
 * directly; the structured shape from `deploy-schemas.ts` carries `errors[]`
 * plus `action`/`result`, which are flattened into the same two strings.
 */
function readHealingAttempts(value: unknown): DeployResultHealingAttempt[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const attempts: DeployResultHealingAttempt[] = [];
    for (const [index, entry] of value.entries()) {
        if (!isRecord(entry)) {
            continue;
        }

        let issue = readString(entry.issue);
        if (issue.length === 0 && Array.isArray(entry.errors)) {
            issue = entry.errors
                .filter(isRecord)
                .map(e => {
                    const detail = readString(e.detail);
                    const source = readString(e.source);
                    return source.length > 0 && detail.length > 0 ? `${source}: ${detail}` : detail || source;
                })
                .filter(text => text.length > 0)
                .join('; ');
        }

        let resolution = readString(entry.resolution);
        if (resolution.length === 0) {
            const action = readString(entry.action);
            const result = readString(entry.result);
            resolution = [action, result].filter(text => text.length > 0).join(' → ');
        }

        if (issue.length === 0 && resolution.length === 0) {
            continue;
        }

        const attemptNumber = typeof entry.attempt === 'number' ? entry.attempt : index + 1;
        attempts.push({
            attempt: attemptNumber,
            issue,
            resolution,
            planLevelChange: readBoolean(entry.planLevelChange),
        });
    }
    return attempts;
}

function readOrphanedResourceGroups(value: unknown): DeployResultOrphanedResourceGroup[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const groups: DeployResultOrphanedResourceGroup[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) {
            continue;
        }
        const name = readString(entry.name);
        if (name.length === 0) {
            continue;
        }
        groups.push({
            name,
            region: readString(entry.region) || undefined,
            reason: readString(entry.reason) || undefined,
        });
    }
    return groups;
}

/** Format the elapsed time between two ISO timestamps, e.g. `1d 18h 19m`. */
function buildDurationLabel(startedUtc: string, completedUtc: string): string {
    if (startedUtc.length === 0 || completedUtc.length === 0) {
        return '';
    }
    const start = Date.parse(startedUtc);
    const end = Date.parse(completedUtc);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
        return '';
    }

    const totalSeconds = Math.round((end - start) / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts: string[] = [];
    if (days > 0) {
        parts.push(`${days}d`);
    }
    if (hours > 0) {
        parts.push(`${hours}h`);
    }
    if (minutes > 0) {
        parts.push(`${minutes}m`);
    }
    // Seconds are noise on multi-hour deployments; only show them on short ones.
    if (seconds > 0 && days === 0 && hours === 0) {
        parts.push(`${seconds}s`);
    }
    return parts.join(' ');
}

function buildPortalUrl(subscriptionId: string, resourceGroupName: string): string {
    if (subscriptionId.length === 0 || resourceGroupName.length === 0) {
        return '';
    }
    return `https://portal.azure.com/#@/resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/overview`;
}

function buildCleanupCommand(resourceGroupName: string): string {
    return resourceGroupName.length > 0 ? `az group delete -n ${resourceGroupName} --yes --no-wait` : '';
}

/**
 * Parse the raw text of a `deploy-result.json` artifact into the view model.
 * Throws only when the text is not valid JSON; every other inconsistency is
 * tolerated so a partially written artifact still renders what it does have.
 */
export function parseDeployResultJson(content: string): DeployResultData {
    const parsed: unknown = JSON.parse(content);
    const plan: Json = isRecord(parsed) ? parsed : {};

    // Timestamps live at the top level in emitted artifacts but under `duration`
    // in the documented schema.
    const duration = isRecord(plan.duration) ? plan.duration : {};
    const startedUtc = readString(plan.startedUtc) || readString(duration.startedUtc);
    const completedUtc = readString(plan.completedUtc) || readString(duration.completedUtc);

    const subscriptionId = readString(plan.subscriptionId);
    const resourceGroupName = readString(plan.resourceGroupName);
    const endpoints = readEndpoints(plan.endpoints);

    return {
        status: readStatus(plan.status),
        healthStatus: readHealthStatus(plan.healthStatus),
        partial: readBoolean(plan.partial) ?? false,

        sessionId: readString(plan.sessionId),
        subscriptionId,
        resourceGroupName,
        region: readString(plan.region),

        startedUtc,
        completedUtc,
        durationLabel: buildDurationLabel(startedUtc, completedUtc),

        portalUrl: buildPortalUrl(subscriptionId, resourceGroupName),

        endpoints,
        primaryEndpoint: pickPrimaryEndpoint(endpoints),

        resources: readResources(plan),

        healthDetail: readHealthDetail(plan.healthDetail),
        networkPolicy: readNetworkPolicy(plan.networkPolicy),
        healingAttempts: readHealingAttempts(plan.healingAttempts),
        orphanedResourceGroups: readOrphanedResourceGroups(plan.orphanedResourceGroups),
        warnings: readStringArray(plan.warnings),

        cleanupCommand: buildCleanupCommand(resourceGroupName),
        resourcesToCleanup: readResourcesToCleanup(plan.createdResources),
    };
}

/**
 * Detect artifacts that parse but have nothing worth showing, so the view can
 * explain the situation instead of rendering an empty report. Mirrors the
 * plan views' render-issue check.
 */
export function getDeployResultRenderIssue(content: string, data: DeployResultData): 'empty' | 'unsupported' | undefined {
    if (content.trim().length === 0) {
        return 'empty';
    }

    const hasContent = data.endpoints.length > 0
        || data.resources.length > 0
        || data.resourceGroupName.length > 0
        || data.status !== 'unknown';
    return hasContent ? undefined : 'unsupported';
}
