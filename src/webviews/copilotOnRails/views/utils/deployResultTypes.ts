/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * View model for the Deployment Results webview, derived from the azure-deploy
 * agent's `deploy-result.json` artifact.
 *
 * The shape here intentionally re-declares the artifact loosely (almost every
 * field optional) rather than importing the agent's `DeployResult` interface:
 *
 * - The artifact is written as a skeleton at the start of the deploy phase and
 *   finalized at the end, so the view may load a partially written file.
 * - Two field layouts exist in the wild. `deploy-schemas.ts` documents
 *   `endpoints[]`/`resourceIds[]`/`duration.*`, while emitted plans commonly use
 *   object maps (`endpoints{}`/`resources{}`) with top-level timestamps. The
 *   parser normalizes both into the types below.
 */

export type DeployResultStatus = 'succeeded' | 'failed' | 'in-progress' | 'unknown';

export type DeployResultHealthStatus = 'healthy' | 'degraded' | 'unreachable' | 'unknown';

/** A deployed, reachable application URL. */
export interface DeployResultEndpoint {
    /** Logical endpoint name, e.g. `api`, `web`, `health`. */
    name: string;
    /** Display label derived from `name`, e.g. `Web`. */
    label: string;
    url: string;
    /** Per-endpoint health, when the artifact tracks it individually. */
    healthStatus?: DeployResultHealthStatus;
}

/** A provisioned Azure resource, as a friendly type plus its concrete name. */
export interface DeployResultResource {
    /** Friendly resource type, e.g. `Function App`. */
    type: string;
    /** The resource name in Azure, e.g. `func-scrapbook-dev-5381`. */
    name: string;
    /** Present when the artifact reports per-resource deployment status. */
    status?: string;
    /** Failure detail for a resource that did not deploy. */
    error?: string;
}

/** One dependency probed by the application's health endpoint. */
export interface DeployResultHealthService {
    name: string;
    /** Reported state, e.g. `up` or `down`. */
    state: string;
    /** False for optional dependencies, whose failure should not fail the app. */
    essential: boolean;
}

/** Result of calling the deployed application's health endpoint. */
export interface DeployResultHealthDetail {
    endpoint?: string;
    checkedUtc?: string;
    services: DeployResultHealthService[];
}

/** Public-network posture applied to the deployed compute after go-live. */
export interface DeployResultNetworkPolicy {
    mainSite?: string;
    scmSite?: string;
    /** Whether SCM basic publishing credentials remain enabled. */
    basicPublishingScm?: boolean;
    /** Whether FTP basic publishing credentials remain enabled. */
    basicPublishingFtp?: boolean;
}

/**
 * A recovery attempt made during deployment. Supports both the narrative shape
 * (`issue`/`resolution`) and the structured shape from `deploy-schemas.ts`
 * (`errors[]`/`action`/`result`), normalized to text.
 */
export interface DeployResultHealingAttempt {
    attempt: number;
    issue: string;
    resolution: string;
    /** True when the attempt changed service type, region, or SKU (needs re-approval). */
    planLevelChange?: boolean;
}

/** A resource group abandoned during healing, needing manual cleanup. */
export interface DeployResultOrphanedResourceGroup {
    name: string;
    region?: string;
    reason?: string;
}

/**
 * A single resource surfaced by the deterministic inventory for the user to act on.
 *
 * The two classifications carry very different confidence and must not be presented alike:
 * - `failed` — a tracked ARM deployment reported this resource with a non-succeeded state. It
 *   definitely belongs to this deployment, so a ready-to-run delete command is appropriate.
 * - `orphaned` — the resource appeared in the subscription during the deploy window but no tracked
 *   deployment reported it. It is *probably* a healing/imperative stray, but on a shared
 *   subscription it may belong to someone else entirely, so it is presented for review without a
 *   one-click delete command.
 */
export interface DeployResultCleanupResource {
    /** Friendly resource type, e.g. `Managed Identity`. */
    type: string;
    /** The resource name in Azure. */
    name: string;
    /** Full ARM resource ID, when known — used to build the delete command. */
    id?: string;
    /** The resource group the resource lives in, when known. */
    resourceGroup?: string;
    /** How confidently this resource is attributed to the deployment. */
    classification: 'failed' | 'orphaned';
    /**
     * Azure CLI command that deletes just this resource. Only populated for `failed` resources —
     * `orphaned` ones are unattributed, and pairing a guess with a copyable delete command invites
     * the user to delete something the deployment never created.
     */
    deleteCommand: string;
}

/** Shown instead of the report when the artifact can't be rendered. */
export interface DeployResultParseError {
    message: string;
    /** Workspace-relative path of the source file, for the "open file" affordance. */
    fileLabel?: string;
}

export interface DeployResultData {
    status: DeployResultStatus;
    healthStatus: DeployResultHealthStatus;
    /** True when the agent deployed only part of the application. */
    partial: boolean;

    sessionId: string;
    subscriptionId: string;
    resourceGroupName: string;
    region: string;

    startedUtc: string;
    completedUtc: string;
    /** Pre-formatted elapsed time, e.g. `4m 32s`. Empty when not computable. */
    durationLabel: string;

    /** Azure portal deep link to the resource group, when it can be built. */
    portalUrl: string;

    endpoints: DeployResultEndpoint[];
    /** The endpoint to feature as "your app is live at", when one is identifiable. */
    primaryEndpoint?: DeployResultEndpoint;

    resources: DeployResultResource[];

    healthDetail?: DeployResultHealthDetail;
    networkPolicy?: DeployResultNetworkPolicy;
    healingAttempts: DeployResultHealingAttempt[];
    orphanedResourceGroups: DeployResultOrphanedResourceGroup[];
    warnings: string[];

    /** Azure CLI command that deletes everything this deployment created. */
    cleanupCommand: string;

    /**
     * Resources the deployment is confirmed to have created and left in a failed state. Safe to
     * offer a delete command for.
     */
    resourcesToCleanup: DeployResultCleanupResource[];

    /**
     * Resources that appeared during the deploy window but could not be attributed to a tracked
     * deployment. Shown for review only — no delete commands, because on a shared subscription
     * these may not belong to this deployment at all.
     */
    resourcesToReview: DeployResultCleanupResource[];

    /**
     * Set when the deployment's ARM operations could not be read, so nothing could be attributed.
     * The view shows a "couldn't verify" notice instead of any cleanup list.
     */
    inventoryUnverified?: boolean;
    /** Why verification failed (`forbidden`/`throttled`/`error`), used to pick the explanation. */
    inventoryUnverifiedReason?: string;

    parseError?: DeployResultParseError;
}
