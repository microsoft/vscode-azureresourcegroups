/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deploy artifact schema — deploy-result.json.
 * Read by deploy instructions.md Step 8 (finalize artifacts).
 */

export type HealthStatus = "healthy" | "degraded" | "unreachable" | "unknown";

// ─── Deploy healing types ────────────────────────────────────────────────────

export type DeployErrorClassification = "IAC_ERROR" | "INFRA_TRANSIENT" | "ENVIRONMENT_BLOCKING";
export type DeployHealingPhase = "validation" | "deployment";

/** Tracks a resource group created during a healing attempt that is no longer
 *  the final deployment target. Surfaced at handoff for manual cleanup. */
export interface OrphanResourceGroup {
  /** Azure resource group name */
  name: string;
  /** Region where the RG was created. Omitted when derived by the deterministic
   *  `capture_deployment_inventory` diff, which doesn't track a region. */
  region?: string;
  /** Which healing attempt created or targeted this RG. Omitted when derived by the
   *  deterministic `capture_deployment_inventory` diff rather than a tracked healing attempt. */
  healingAttempt?: number;
  /** Why this RG was abandoned (e.g., "region fallback to westus2") */
  reason: string;
}
export type DeployHealingAction = "routed-to-scaffold" | "retried" | "surfaced-to-user";
export type DeployHealingResult = "fixed" | "still-failing" | "blocked";

// ─── Deterministic resource inventory (capture_deployment_inventory) ─────────

/** How a resource created during this session relates to the tracked deployment(s).
 *  Computed deterministically by the `capture_deployment_inventory` MCP tool from a
 *  before/after `resources.list()` diff — NOT inferred from chat history. */
export type CreatedResourceClassification =
  /** Reported `Succeeded` by a tracked deployment and located in the final target RG.
   *  Part of the working deployment — never a cleanup candidate. */
  | "expected"
  /** Reported by a tracked deployment but with a non-succeeded provisioning state.
   *  Confirmed to belong to this deployment, so a delete command may be offered. */
  | "failed"
  /** Appeared during the deploy window but no tracked deployment reported it, or it landed
   *  outside the final target RG. Probably a healing retry or an imperative `az` fallback —
   *  but on a shared subscription it may belong to someone else entirely. Surface for the
   *  user to REVIEW; never describe it as safe to delete. */
  | "orphaned"
  /** The tracked deployment's ARM operations could not be read (permissions, throttling,
   *  transient failure), so nothing could be attributed. Never a cleanup candidate. */
  | "unverified";

/** A resource that exists now because of this session (post − baseline diff). */
export interface CreatedResource {
  /** Full ARM resource ID. */
  id: string;
  name?: string;
  type?: string;
  /** Resource group parsed from the ARM ID. */
  resourceGroup?: string;
  /** Provisioning state reported by the deployment operations, when known. */
  provisioningState?: string;
  classification: CreatedResourceClassification;
}

export interface DeployHealingError {
  source: string;
  detail: string;
  classification: DeployErrorClassification;
}

export interface DeployHealingAttempt {
  attempt: number;
  phase: DeployHealingPhase;
  errors: DeployHealingError[];
  action: DeployHealingAction;
  result: DeployHealingResult;
  /** Resource group targeted by this attempt — useful for audit and debugging */
  resourceGroupName?: string;
  /** True when this healing attempt changed the service type or region — requires re-approval */
  planLevelChange?: boolean;
  /** What changed: "service-type", "region", "sku" */
  changeType?: "service-type" | "region" | "sku";
  /** Original value before the change (e.g., "App Service B1 eastus") */
  originalValue?: string;
  /** New value after the change (e.g., "Container Apps Consumption eastus") */
  newValue?: string;
}

// ─── deploy-result.json ──────────────────────────────────────────────────────

export interface DeployEndpoint {
  name: string;
  url: string;
  healthStatus: HealthStatus;
}

export interface DeployDuration {
  startedUtc: string;
  completedUtc: string;
}

export type DeployStatus = "in-progress" | "succeeded" | "failed";

export type ResourceDeployStatus = "succeeded" | "failed" | "skipped";

export interface ResourceResult {
  resourceId: string;
  type: string;
  status: ResourceDeployStatus;
  error?: string;
}

export interface DeployResult {
  sessionId: string;
  /** Azure subscription ID from context.json.azure.subscriptionId */
  subscriptionId: string;
  /** All ARM deployment names used during this session (initial + healing retries).
   *  First entry is the initial deployment; subsequent entries are from scope/RG changes. */
  deploymentNames: string[];
  resourceGroupName: string;
  status: DeployStatus;
  resourceIds: string[];
  endpoints: DeployEndpoint[];
  healthStatus: HealthStatus;
  duration: DeployDuration;
  warnings: string[];
  partial: boolean;
  resourceResults: readonly ResourceResult[];
  /** Resources that exist now because of this session, computed deterministically by
   *  `capture_deployment_inventory` (before/after `resources.list()` diff). Includes
   *  expected, failed, and orphaned resources — the source of truth for the handoff
   *  cleanup section. Populated at Step 8 and on the Step 9 failure path. */
  createdResources: readonly CreatedResource[];
  /** RGs created during healing that are not the final deployment target.
   *  Derived from `createdResources` (resources whose RG != the final target RG).
   *  Surfaced at handoff (Step 9) with manual cleanup commands. */
  orphanedResourceGroups: readonly OrphanResourceGroup[];
  /** Set when `capture_deployment_inventory` could not read the deployment's ARM operations,
   *  so `createdResources` could not be attributed. When true, present NO cleanup list and
   *  tell the user to review the resource group in the portal. */
  inventoryUnverified?: boolean;
  /** Why verification failed: `"forbidden"` (missing
   *  `Microsoft.Resources/deployments/operations/read`), `"throttled"`, or `"error"`. */
  inventoryUnverifiedReason?: string;
  healingAttempts?: readonly DeployHealingAttempt[];
}
