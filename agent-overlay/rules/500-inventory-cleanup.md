# 500 — Inventory and cleanup

Upstream derives its cleanup list from what the agent remembers doing and from a session tag. Both
miss resources created by healing retries or imperative fallbacks. These rules replace memory with
a deterministic ARM diff.

---

### R-501 — Baseline before the first deployment

| | |
|---|---|
| Applies to | `deploy/instructions.md` step 5b |
| Anchor | "Write deploy-result.json skeleton" row |
| Operation | append a mandatory `capture_deployment_inventory` call with `phase: "baseline"` before the first `az deployment` |
| Idempotency key | `phase: "baseline"` in step 5b |
| Check | `C-501` |

Snapshot is held **in memory** — no workspace files are written. Without a baseline the post-deploy
diff attributes every pre-existing resource in the subscription to this session.

---

### R-502 — Capture after every attempt

| | |
|---|---|
| Applies to | `deploy/instructions.md` steps 6, 8, 9; `deploy/references/error-classification.md`; `deploy-checklist-template.md` |
| Operation | require `phase: "capture"` after **every** `az deployment` — success, failure, and each healing retry |
| Idempotency key | `phase: "capture"` present in all three steps |
| Check | `C-502` |

Pass `expectedResourceGroup`, all `deploymentNames[]`, and every `resourceGroups[]` touched
**including abandoned healing RGs**. Upstream's healing loop deliberately never deletes and rolls
to a new RG suffix; those abandoned groups are exactly the resources users get billed for.

---

### R-503 — Re-baseline on resume

| | |
|---|---|
| Applies to | `references/session-protocol.md` |
| Anchor | Resume branch of the session gate |
| Operation | require a fresh `baseline` call after the user chooses Resume, before any command that can provision |
| Idempotency key | `capture_deployment_inventory` in the resume branch |
| Check | `C-503` |

⛔ **Preserve the existing inventory.** The resumed segment must be *unioned* into the prior
`createdResources[]` / `orphanedResourceGroups[]` by normalized resource ID and case-insensitive RG
name. Replacing it discards the cleanup evidence from before the resume — which is usually the part
the user most needs.

---

### R-504 — Classification-aware cleanup wording

| | |
|---|---|
| Applies to | `deploy/references/mcp-tools.md`, `references/handoff-protocol.md` |
| Operation | document the four classifications and bind each to required user-facing phrasing |
| Idempotency key | Table containing `expected` / `failed` / `orphaned` / `unverified` |
| Check | `C-504` |

| Classification | Meaning | Required presentation |
|---|---|---|
| `expected` | tracked deployment reported `Succeeded` in the target RG | part of the working deployment; never offer deletion |
| `failed` | tracked deployment reported a non-succeeded state | confirmed ours; a ready-to-run `az resource delete` is fine |
| `orphaned` | appeared in the window, no deployment claimed it | "review before deleting", **no delete command** |
| `unverified` | deployment operations unreadable; nothing attributable | print **no** cleanup list; point at the portal |

⛔ The `orphaned` wording is a safety rule, not a style preference. On a shared subscription an
unattributed resource may belong to a colleague, and we hand the user a command to delete it.

When the tool returns `inventoryUnverified`, record it plus `inventoryUnverifiedReason` and skip
the cleanup section. For `"forbidden"`, explain the account lacks
`Microsoft.Resources/deployments/operations/read`.

---

### R-505 — Inventory fields are tool-populated

| | |
|---|---|
| Applies to | `deploy/references/deploy-schemas.ts`, `deploy/instructions.md` step 8, `references/handoff-protocol.md` |
| Operation | add `CreatedResource`, `CreatedResourceClassification`, `inventoryUnverified`, `inventoryUnverifiedReason`; make `region`/`healingAttempt` optional on orphan RGs |
| Idempotency key | `CreatedResourceClassification` in `deploy-schemas.ts` |
| Check | `C-505` |

`createdResources[]` and `orphanedResourceGroups[]` are written **from tool output**, never
hand-authored. `region` and `healingAttempt` become optional because a diff-derived orphan has
neither.

⛔ `createdResources` is an **array** — not the raw `az resource list` envelope `{"value": […]}`.
The handoff and cleanup paths both read it positionally.
