/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure, dependency-free logic for the deterministic deployment-inventory capture used by the
 * Copilot on Rails deploy phase. Kept free of `vscode`/Azure SDK imports so it can be unit-tested
 * directly.
 *
 * The capture works by diffing a snapshot of the subscription's resources taken *before*
 * provisioning against a snapshot taken *after* deployment. Anything present after but not before
 * was created by this session. Each created resource is then classified against what the ARM
 * deployment(s) actually reported so that orphaned / unexpected / failed resources — the ones a
 * user must clean up after a failure — surface deterministically instead of depending on the
 * agent's narration.
 */

/** A single Azure resource, reduced to the fields the inventory needs. */
export interface InventoryResource {
    id: string;
    name?: string;
    type?: string;
    location?: string;
}

/** How a newly-created resource relates to the tracked deployment(s). */
export type CreatedResourceClassification =
    /** Reported as `Succeeded` by a tracked deployment and located in the expected resource group. */
    | 'expected'
    /** Reported by a tracked deployment but with a non-succeeded provisioning state. */
    | 'failed'
    /** Appeared during the deploy window but no tracked deployment reported it, or it landed
     *  outside the expected resource group. Likely left behind by a healing retry or an imperative
     *  `az` fallback — but on a shared subscription it may equally belong to someone else, so this
     *  is a "review this" signal, not an assertion that the deployment created it. */
    | 'orphaned'
    /** The tracked deployment's operations could not be read (permissions, throttling, transient
     *  failure), so the resource cannot be attributed either way. Never a cleanup candidate. */
    | 'unverified';

export interface CreatedResource {
    id: string;
    name?: string;
    type?: string;
    resourceGroup?: string;
    /** Provisioning state as reported by the deployment operations, when known. */
    provisioningState?: string;
    classification: CreatedResourceClassification;
}

export interface OrphanedResourceGroup {
    name: string;
    /** How many created resources fell into this resource group. */
    resourceCount: number;
}

export interface DeploymentInventoryResult {
    baselineCount: number;
    postCount: number;
    /** The resource group the successful deployment was expected to target, if known. */
    expectedResourceGroup?: string;
    createdResources: CreatedResource[];
    /** Resource groups that hold created resources but are not the expected target group. */
    orphanedResourceGroups: OrphanedResourceGroup[];
    /** True when any created resource is `failed` or `orphaned`. Always false when
     *  {@link targetsUnavailable} is set — nothing can be a cleanup candidate if nothing could be
     *  attributed. */
    hasCleanupConcerns: boolean;
    /**
     * Set when the tracked deployment's operations could not be read, so created resources could
     * not be attributed. Consumers must present this as "could not verify" rather than rendering a
     * cleanup list.
     */
    targetsUnavailable?: boolean;
    /** Why the operations were unreadable (`forbidden`/`throttled`/`error`), for telemetry and UI copy. */
    targetsUnavailableReason?: string;
}

export interface ComputeInventoryOptions {
    /**
     * The deployment operations could not be read. Every created resource is classified
     * `unverified` and no cleanup is suggested.
     */
    targetsUnavailable?: boolean;
}

/** A deployment target as reported by ARM deployment operations. */
export interface DeploymentTarget {
    id: string;
    provisioningState?: string;
}

/**
 * ARM resource IDs are case-insensitive; normalize for set membership and lookups. Also strips a
 * single trailing slash so equivalent IDs compare equal.
 */
export function normalizeResourceId(id: string): string {
    return id.trim().replace(/\/+$/, '').toLowerCase();
}

const supportedArmResourceTypes = new Set([
    'microsoft.alertsmanagement/smartdetectoralertrules',
    'microsoft.apimanagement/service',
    'microsoft.app/containerapps',
    'microsoft.app/jobs',
    'microsoft.app/managedenvironments',
    'microsoft.app/managedenvironments/storages',
    'microsoft.authorization/roleassignments',
    'microsoft.cache/redis',
    'microsoft.cache/redis/accesspolicyassignments',
    'microsoft.cognitiveservices/accounts',
    'microsoft.cognitiveservices/accounts/deployments',
    'microsoft.communication/communicationservices',
    'microsoft.compute/virtualmachines',
    'microsoft.containerregistry/registries',
    'microsoft.dbformysql/flexibleservers',
    'microsoft.dbformysql/flexibleservers/administrators',
    'microsoft.dbformysql/flexibleservers/configurations',
    'microsoft.dbformysql/flexibleservers/databases',
    'microsoft.dbformysql/flexibleservers/firewallrules',
    'microsoft.dbforpostgresql/flexibleservers',
    'microsoft.dbforpostgresql/flexibleservers/administrators',
    'microsoft.dbforpostgresql/flexibleservers/configurations',
    'microsoft.dbforpostgresql/flexibleservers/databases',
    'microsoft.dbforpostgresql/flexibleservers/firewallrules',
    'microsoft.documentdb/databaseaccounts',
    'microsoft.documentdb/databaseaccounts/sqlroleassignments',
    'microsoft.eventhub/namespaces',
    'microsoft.insights/components',
    'microsoft.insights/diagnosticsettings',
    'microsoft.keyvault/vaults',
    'microsoft.managedidentity/userassignedidentities',
    'microsoft.network/virtualnetworks',
    'microsoft.network/virtualnetworks/subnets',
    'microsoft.operationalinsights/workspaces',
    'microsoft.resources/deployments',
    'microsoft.resources/resourcegroups',
    'microsoft.search/searchservices',
    'microsoft.servicebus/namespaces',
    'microsoft.signalrservice/signalr',
    'microsoft.sql/servers',
    'microsoft.sql/servers/databases',
    'microsoft.storage/storageaccounts',
    'microsoft.storage/storageaccounts/blobservices/containers',
    'microsoft.web/serverfarms',
    'microsoft.web/sites',
    'microsoft.web/sites/basicpublishingcredentialspolicies',
    'microsoft.web/staticsites',
]);

/**
 * Extracts the resource group name from a full ARM resource ID. Returns `undefined` for IDs that
 * are not scoped to a resource group (e.g. subscription-level resources).
 */
export function parseResourceGroupFromId(id: string): string | undefined {
    const match = /\/resourceGroups\/([^/]+)/i.exec(id);
    return match?.[1];
}

/**
 * Aggregates privacy-safe ARM resource types as a stable, bounded `type=count` list.
 * Resource names and IDs are used only to derive the provider type and are never returned.
 */
export function aggregateArmResourceTypes(resources: readonly Pick<InventoryResource, 'id' | 'type'>[]): string | undefined {
    const counts = new Map<string, number>();
    for (const resource of resources) {
        const resourceType = normalizeArmResourceType(resource.type) ?? armResourceTypeFromId(resource.id);
        if (resourceType) {
            counts.set(resourceType, (counts.get(resourceType) ?? 0) + 1);
        }
    }
    return counts.size === 0
        ? undefined
        : [...counts.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .slice(0, 30)
            .map(([type, count]) => `${type}=${count}`)
            .join(',');
}

export function normalizeArmResourceType(value: string | undefined): string | undefined {
    const trimmed = value?.trim().split('@', 1)[0];
    if (!trimmed || !/^Microsoft\.[A-Za-z0-9.]+(?:\/[A-Za-z0-9._-]+)+$/i.test(trimmed)) {
        return undefined;
    }
    const normalized = trimmed.toLowerCase();
    return supportedArmResourceTypes.has(normalized) ? normalized : undefined;
}

function armResourceTypeFromId(value: string): string | undefined {
    const segments = value.split('/').filter(Boolean);
    let providersIndex = -1;
    for (let i = 0; i < segments.length; i++) {
        if (segments[i].toLowerCase() === 'providers') {
            providersIndex = i;
        }
    }
    if (providersIndex >= 0 && providersIndex + 2 < segments.length) {
        const typeSegments: string[] = [];
        for (let i = providersIndex + 2; i < segments.length; i += 2) {
            typeSegments.push(segments[i]);
        }
        return normalizeArmResourceType([segments[providersIndex + 1], ...typeSegments].join('/'));
    }
    const resourceGroupsIndex = segments.findIndex((segment) => segment.toLowerCase() === 'resourcegroups');
    return resourceGroupsIndex >= 0 && resourceGroupsIndex + 1 < segments.length
        ? 'microsoft.resources/resourcegroups'
        : undefined;
}

/**
 * Computes the set of resources created between the baseline and post snapshots, classifies each
 * one against the tracked deployment targets, and derives the orphaned resource groups.
 *
 * @param baseline Resource IDs present before provisioning began.
 * @param post Resources present after deployment finished (or failed).
 * @param deploymentTargets Targets reported by the tracked ARM deployment(s), keyed by resource ID.
 * @param expectedResourceGroup The resource group the successful deployment was meant to target.
 * @param options See {@link ComputeInventoryOptions}.
 */
export function computeDeploymentInventory(
    baseline: readonly string[],
    post: readonly InventoryResource[],
    deploymentTargets: readonly DeploymentTarget[],
    expectedResourceGroup?: string,
    options: ComputeInventoryOptions = {},
): DeploymentInventoryResult {
    const baselineIds = new Set(baseline.map(normalizeResourceId));

    const targetsById = new Map<string, DeploymentTarget>();
    for (const target of deploymentTargets) {
        if (target.id) {
            targetsById.set(normalizeResourceId(target.id), target);
        }
    }

    const expectedRgNormalized = expectedResourceGroup?.toLowerCase();
    const targetsUnavailable = options.targetsUnavailable === true;

    const createdResources: CreatedResource[] = [];
    const orphanRgCounts = new Map<string, { name: string; count: number }>();

    // De-duplicate the post snapshot by normalized ID so a paginated duplicate can't double-count.
    const seen = new Set<string>();

    for (const resource of post) {
        if (!resource.id) {
            continue;
        }
        const normalizedId = normalizeResourceId(resource.id);
        if (baselineIds.has(normalizedId) || seen.has(normalizedId)) {
            continue;
        }
        seen.add(normalizedId);

        const resourceGroup = parseResourceGroupFromId(resource.id);
        const target = targetsById.get(normalizedId);
        const provisioningState = target?.provisioningState;
        const inExpectedRg = expectedRgNormalized === undefined || resourceGroup?.toLowerCase() === expectedRgNormalized;

        let classification: CreatedResourceClassification;
        if (targetsUnavailable) {
            // No deployment operations were readable, so "not reported by a deployment" carries no
            // information. Attributing anything here would hand the user delete commands for
            // resources that may well be the working deployment.
            classification = 'unverified';
        } else if (!inExpectedRg) {
            // Anything outside the final target RG is an orphan regardless of its own state.
            classification = 'orphaned';
        } else if (!target) {
            // Exists now, created during this session, but no tracked deployment reported it.
            classification = 'orphaned';
        } else if (provisioningState && provisioningState.toLowerCase() === 'succeeded') {
            classification = 'expected';
        } else {
            classification = 'failed';
        }

        createdResources.push({
            id: resource.id,
            name: resource.name,
            type: resource.type,
            resourceGroup,
            provisioningState,
            classification,
        });

        if (resourceGroup && !inExpectedRg && !targetsUnavailable) {
            const key = resourceGroup.toLowerCase();
            const existing = orphanRgCounts.get(key);
            if (existing) {
                existing.count++;
            } else {
                orphanRgCounts.set(key, { name: resourceGroup, count: 1 });
            }
        }
    }

    const orphanedResourceGroups: OrphanedResourceGroup[] = Array.from(orphanRgCounts.values())
        .map((v) => ({ name: v.name, resourceCount: v.count }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const hasCleanupConcerns = !targetsUnavailable && createdResources.some((r) => r.classification !== 'expected');

    // Deduped like `baselineCount`, so the two counts are directly comparable.
    const postIds = new Set(post.filter((r) => r.id).map((r) => normalizeResourceId(r.id)));

    return {
        baselineCount: baselineIds.size,
        postCount: postIds.size,
        expectedResourceGroup,
        createdResources,
        orphanedResourceGroups,
        hasCleanupConcerns,
        ...(targetsUnavailable ? { targetsUnavailable: true } : {}),
    };
}
