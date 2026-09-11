/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { type LoadingStep, type LoadingStepStatus } from "../../views/utils/viewConfigTypes";

/**
 * Derives the per-resource provisioning checklist shown under "Provisioning Azure resources"
 * from raw ARM deployment operations.
 *
 * Everything here is pure so the mapping rules — which are the part most likely to be wrong —
 * can be unit tested without an Azure subscription or a VS Code host.
 */

/** The deploy target read out of the `deploy-result.json` skeleton the agent writes before deploying. */
export type DeployTarget = {
    subscriptionId: string;
    resourceGroupName: string;
    /**
     * ARM deployment names recorded so far. Empty during the deploy: the agent only fills
     * `deploymentNames` when it finalizes the artifact, so the poller discovers deployments by
     * listing the resource group instead.
     */
    deploymentNames: readonly string[];
};

/** The shape this module needs from `@azure/arm-resources`' `DeploymentOperation`. */
export type ArmDeploymentOperationLike = {
    properties?: {
        provisioningState?: string;
        timestamp?: Date;
        targetResource?: {
            id?: string;
            resourceName?: string;
            resourceType?: string;
        };
    };
};

/** The shape this module needs from `@azure/arm-resources`' `DeploymentExtended`. */
export type ArmDeploymentLike = {
    name?: string;
    properties?: {
        provisioningState?: string;
        timestamp?: Date;
    };
};

/**
 * Nested ARM deployments are an artifact of how Bicep compiles modules, not resources the user
 * asked for. Listing them alongside real resources roughly doubles the checklist with entries
 * that mean nothing to the reader.
 */
const NESTED_DEPLOYMENT_TYPE = 'microsoft.resources/deployments';

/**
 * Friendly names for the ARM types this pipeline actually provisions.
 *
 * ARM resource *names* are frequently useless on their own — role assignments are named with a
 * GUID, and child resources arrive as `parent/child` — so the type is what tells the user what is
 * being created. Anything not listed here falls back to {@link humanizeResourceType}.
 */
const RESOURCE_TYPE_LABELS: Readonly<Record<string, string>> = {
    'microsoft.app/containerapps': 'Container app',
    'microsoft.app/managedenvironments': 'Container Apps environment',
    'microsoft.apimanagement/service': 'API Management service',
    'microsoft.authorization/roleassignments': 'Role assignment',
    'microsoft.cache/redis': 'Azure Cache for Redis',
    'microsoft.cdn/profiles': 'CDN profile',
    'microsoft.cognitiveservices/accounts': 'Azure AI service',
    'microsoft.containerregistry/registries': 'Container registry',
    'microsoft.dbformysql/flexibleservers': 'MySQL server',
    'microsoft.dbformysql/flexibleservers/databases': 'MySQL database',
    'microsoft.dbforpostgresql/flexibleservers': 'PostgreSQL server',
    'microsoft.dbforpostgresql/flexibleservers/configurations': 'PostgreSQL configuration',
    'microsoft.dbforpostgresql/flexibleservers/databases': 'PostgreSQL database',
    'microsoft.dbforpostgresql/flexibleservers/firewallrules': 'PostgreSQL firewall rule',
    'microsoft.documentdb/databaseaccounts': 'Cosmos DB account',
    'microsoft.eventhub/namespaces': 'Event Hubs namespace',
    'microsoft.insights/components': 'Application Insights',
    'microsoft.keyvault/vaults': 'Key vault',
    'microsoft.keyvault/vaults/secrets': 'Key vault secret',
    'microsoft.managedidentity/userassignedidentities': 'Managed identity',
    'microsoft.network/privatednszones': 'Private DNS zone',
    'microsoft.network/privateendpoints': 'Private endpoint',
    'microsoft.network/virtualnetworks': 'Virtual network',
    'microsoft.operationalinsights/workspaces': 'Log Analytics workspace',
    'microsoft.search/searchservices': 'AI Search service',
    'microsoft.servicebus/namespaces': 'Service Bus namespace',
    'microsoft.signalrservice/signalr': 'SignalR service',
    'microsoft.sql/servers': 'SQL server',
    'microsoft.sql/servers/databases': 'SQL database',
    'microsoft.sql/servers/firewallrules': 'SQL firewall rule',
    'microsoft.storage/storageaccounts': 'Storage account',
    'microsoft.web/certificates': 'App Service certificate',
    'microsoft.web/connections': 'API connection',
    'microsoft.web/serverfarms': 'App Service plan',
    'microsoft.web/sites': 'App Service',
    'microsoft.web/sites/basicpublishingcredentialspolicies': 'Publishing credentials policy',
    'microsoft.web/sites/config': 'App Service configuration',
    'microsoft.web/sites/slots': 'Deployment slot',
    'microsoft.web/staticsites': 'Static Web App',
};

/**
 * Turns an ARM resource type into a readable label, e.g.
 * `Microsoft.Web/sites/basicPublishingCredentialsPolicies` → "Basic publishing credentials policy".
 *
 * Used for types absent from {@link RESOURCE_TYPE_LABELS} so a resource Azure adds tomorrow still
 * reads as something rather than falling back to a bare GUID.
 */
export function humanizeResourceType(resourceType: string | undefined): string | undefined {
    const leaf = resourceType?.split('/').pop()?.trim();
    if (!leaf) {
        return undefined;
    }

    const words = leaf
        // `basicPublishingCredentialsPolicies` → `basic Publishing Credentials Policies`
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .trim();
    if (words.length === 0) {
        return undefined;
    }

    const singular = words
        .replace(/ies$/, 'y')
        .replace(/sses$/, 'ss')
        .replace(/([^s])s$/, '$1');

    return singular.charAt(0).toUpperCase() + singular.slice(1);
}

/** The display label for an ARM resource type, or undefined when the type is unknown. */
export function resourceTypeLabel(resourceType: string | undefined): string | undefined {
    const normalized = resourceType?.trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }
    return RESOURCE_TYPE_LABELS[normalized] ?? humanizeResourceType(resourceType);
}

/**
 * Reads `subscriptionId` / `resourceGroupName` / `deploymentNames` out of a `deploy-result.json`.
 * Returns undefined unless both identifiers needed to query ARM are present.
 */
export function parseDeployTarget(content: string): DeployTarget | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return undefined;
    }

    const { subscriptionId, resourceGroupName, deploymentNames } = parsed as Record<string, unknown>;
    if (typeof subscriptionId !== 'string' || subscriptionId.trim().length === 0) {
        return undefined;
    }
    if (typeof resourceGroupName !== 'string' || resourceGroupName.trim().length === 0) {
        return undefined;
    }

    return {
        subscriptionId: subscriptionId.trim(),
        resourceGroupName: resourceGroupName.trim(),
        deploymentNames: Array.isArray(deploymentNames)
            ? deploymentNames.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
            : [],
    };
}

/**
 * Maps an ARM `provisioningState` onto the checklist's vocabulary.
 *
 * ARM reports a wider set than we render (`Accepted`, `Creating`, `Updating`, `Deleting`, …); every
 * non-terminal state means the same thing to the user, so they all collapse to `active`.
 */
export function mapProvisioningState(state: string | undefined): LoadingStepStatus {
    switch (state?.toLowerCase()) {
        case 'succeeded':
            return 'done';
        case 'failed':
        case 'canceled':
        case 'cancelled':
            return 'failed';
        default:
            return 'active';
    }
}

/**
 * Collapses the operations of one or more ARM deployments into a per-resource checklist.
 *
 * A resource accumulates several operations over a deployment's life (and again across healing
 * retries), so entries are de-duplicated by resource ID with the most advanced state winning —
 * otherwise a resource that finished would flip back to "running" when an older operation is read.
 */
export function buildResourceSteps(operations: readonly ArmDeploymentOperationLike[]): LoadingStep[] {
    const byId = new Map<string, { label: string; note?: string; status: LoadingStepStatus }>();

    for (const operation of operations) {
        const target = operation.properties?.targetResource;
        const id = target?.id?.trim();
        if (!id) {
            // Operations that don't name a target (template validation, output evaluation) have
            // nothing to show the user.
            continue;
        }

        const resourceType = target?.resourceType?.trim() || resourceTypeFromId(id);
        if (resourceType?.toLowerCase() === NESTED_DEPLOYMENT_TYPE) {
            continue;
        }

        const name = target?.resourceName?.trim() || id.split('/').pop() || id;
        const typeLabel = resourceTypeLabel(resourceType);
        const status = mapProvisioningState(operation.properties?.provisioningState);
        const existing = byId.get(id);

        byId.set(id, {
            // Lead with the resource type: ARM names are often opaque (role assignments are named
            // with a GUID) so the type is what actually tells the user what is being created. The
            // name is demoted to a note. With no known type there's nothing better than the name.
            label: existing?.label ?? (typeLabel ?? name),
            note: existing?.note ?? (typeLabel ? name : undefined),
            status: existing ? mostAdvanced(existing.status, status) : status,
        });
    }

    return [...byId.entries()]
        .map(([id, { label, note, status }]) => (note ? { id, label, note, status } : { id, label, status }))
        // Group by state so what's still running is easy to find, then by type and name for a
        // stable order that doesn't churn as ARM returns operations in different sequences.
        .sort((a, b) =>
            statusRank(a.status) - statusRank(b.status)
            || a.label.localeCompare(b.label)
            || (a.note ?? '').localeCompare(b.note ?? ''));
}

/**
 * Recovers the resource type from an ARM resource ID, for the operations where ARM reports the ID
 * but omits `resourceType`.
 *
 * IDs are `/providers/{namespace}/{type}/{name}[/{childType}/{childName}]…`, so the type is the
 * namespace followed by every other segment after it.
 */
function resourceTypeFromId(id: string): string | undefined {
    const segments = id.split('/').filter((segment) => segment.length > 0);
    const providerIndex = segments.findIndex((segment) => segment.toLowerCase() === 'providers');
    if (providerIndex === -1 || providerIndex + 2 >= segments.length) {
        return undefined;
    }

    const namespace = segments[providerIndex + 1];
    const typeSegments = segments.slice(providerIndex + 2).filter((_, index) => index % 2 === 0);
    return [namespace, ...typeSegments].join('/');
}

/**
 * Picks the ARM deployments whose operations are worth reading.
 *
 * A resource group accumulates deployment history, so reading every one would both cost an ARM
 * request each and surface resources from previous runs. Only deployments that are still running,
 * or that started after tracking began, belong to the deploy the user is watching.
 */
export function selectTrackedDeployments(
    deployments: readonly ArmDeploymentLike[],
    options: { knownNames: readonly string[]; since: number; limit: number },
): string[] {
    const known = new Set(options.knownNames);

    const candidates = deployments.filter((deployment) => {
        if (!deployment.name) {
            return false;
        }
        if (known.has(deployment.name)) {
            return true;
        }
        if (mapProvisioningState(deployment.properties?.provisioningState) === 'active') {
            return true;
        }
        const timestamp = deployment.properties?.timestamp?.getTime();
        return timestamp !== undefined && timestamp >= options.since;
    });

    return candidates
        .sort((a, b) => (b.properties?.timestamp?.getTime() ?? 0) - (a.properties?.timestamp?.getTime() ?? 0))
        .slice(0, options.limit)
        .map((deployment) => deployment.name as string);
}

/** Sub-label for the provisioning step, e.g. "4 of 7 resources ready". */
export function buildResourceSummary(steps: readonly LoadingStep[]): string | undefined {
    if (steps.length === 0) {
        return undefined;
    }
    const done = steps.filter((step) => step.status === 'done').length;
    return vscode.l10n.t('{0} of {1} resources ready', done, steps.length);
}

/** Ordering used to keep running resources at the top of the list. */
function statusRank(status: LoadingStepStatus): number {
    switch (status) {
        case 'failed':
            return 0;
        case 'active':
            return 1;
        case 'done':
            return 2;
        default:
            return 3;
    }
}

/**
 * Resolves two observed states for the same resource. `failed` is sticky so a retry's early
 * `Accepted` operation can't hide a failure the user needs to see; otherwise the later lifecycle
 * stage wins.
 */
function mostAdvanced(a: LoadingStepStatus, b: LoadingStepStatus): LoadingStepStatus {
    if (a === 'failed' || b === 'failed') {
        return 'failed';
    }
    if (a === 'done' || b === 'done') {
        return 'done';
    }
    return a === 'active' || b === 'active' ? 'active' : a;
}
