
// ─── Deterministic resource inventory (capture_deployment_inventory) ──────────
// Added by the azure-deploy overlay (rule R-505). Upstream has no inventory concept.

/** How a resource created during this session relates to the tracked deployment(s).
 *  Computed deterministically from a before/after `resources.list()` diff —
 *  NEVER inferred from chat history. */
export type CreatedResourceClassification =
  /** Reported `Succeeded` by a tracked deployment and located in the final target RG. */
  | "expected"
  /** Reported by a tracked deployment but with a non-succeeded provisioning state.
   *  Confirmed to belong to this deployment, so a delete command may be offered. */
  | "failed"
  /** Appeared during the deploy window but no tracked deployment reported it, or it
   *  landed outside the final target RG. On a shared subscription it may belong to
   *  someone else — surface for REVIEW, never as safe to delete. */
  | "orphaned"
  /** Deployment operations could not be read (permissions, throttling, transient
   *  failure), so nothing could be attributed. Never a cleanup candidate. */
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

/** Inventory fields merged into DeployResult by the overlay.
 *  `createdResources` is an ARRAY — not the `az resource list` envelope `{ value: [] }`. */
export interface DeployResultInventory {
  createdResources: readonly CreatedResource[];
  /** Set when the deployment's ARM operations could not be read. When true, present
   *  NO cleanup list and tell the user to review the resource group in the portal. */
  inventoryUnverified?: boolean;
  /** `"forbidden"` (missing Microsoft.Resources/deployments/operations/read),
   *  `"throttled"`, or `"error"`. */
  inventoryUnverifiedReason?: string;
}
