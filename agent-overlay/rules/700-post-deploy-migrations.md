# 700 — Post-deploy migrations

Upstream stops at a healthy endpoint. Our pipeline built the schema in an earlier phase, so leaving
migrations as a manual TODO ships an app pointed at an empty database. The risk is that the
shortest path to "migration applied" is opening the database firewall — which these rules forbid.

All content lands in `cor-references/`, namespaced so an upstream re-vendor can never collide with
it.

---

### R-701 — Migrations are part of the deploy

| | |
|---|---|
| Applies to | `azure-deploy.agent.md` (overlay-only) |
| Anchor | After the prerequisite section |
| Operation | insert the `## Post-deploy migrations` block inside the re-vendor-safe addendum markers |
| Idempotency key | Heading `## Post-deploy migrations` |
| Check | `C-701` |

Wrap in:

```html
<!-- BEGIN copilot-on-rails addendum (survives re-vendoring — do not remove on re-vendor) -->
<!-- END copilot-on-rails addendum -->
```

The markers let `apply` replace the block wholesale without diffing prose, and they tell a human
reader that the content is deliberately ours.

---

### R-702 — Tier ladder, in order

| | |
|---|---|
| Applies to | `cor-references/migration-access.md` (overlay-authored) |
| Operation | author the three-tier decision table |
| Idempotency key | File exists and contains all three tier headings |
| Check | `C-702` |

| Tier | Mechanism | Network change |
|---|---|---|
| 1 | Exec inside the deployed app (`az containerapp exec`, `az webapp ssh`) | none |
| 2 | One-shot job in the same Container Apps environment | none |
| 3 | Temporary **single-IP** firewall allow rule | yes — last resort |

Tiers 1 and 2 work because the generated IaC already allows Azure services
(`AllowAllAzureServicesAndResourcesWithinAzureIps`) — compute inside Azure can reach the database
and a laptop cannot. That is why only tier 3 needs a network change.

Escalate only on stated grounds: tier 1 → image dropped the migration CLI, scaled to zero, or
Windows App Service; tier 2 → no Azure-side compute in the database's network.

---

### R-703 — Network posture is never weakened

| | |
|---|---|
| Applies to | `cor-references/migration-access.md`, `azure-deploy.agent.md` |
| Operation | prohibit widening to `0.0.0.0`–`255.255.255.255`, disabling enforcement, enabling public access on a disabled server, and deleting or editing any pre-existing rule |
| Idempotency key | "Never weaken network posture" |
| Check | `C-703` |

If the database is private-only, stop at tier 2 or fail the deploy. ⛔ A failed migration is a
recoverable state; a silently opened database is not.

Tier 3 preconditions, all required: tiers 1–2 genuinely impossible (state why in
`deploy-result.json`); `publicNetworkAccess` already **Enabled**; the migration runs with the
developer's own Entra credentials — never by copying an admin password locally.

---

### R-704 — Tier 3 goes through the lease tools

| | |
|---|---|
| Applies to | `azure-deploy.agent.md`, `cor-references/migration-access.md` |
| Operation | require `open_database_migration_access` / `close_database_migration_access` over raw `az` |
| Idempotency key | `open_database_migration_access` |
| Check | `C-704` |

They record the lease **before** creating the rule, so the extension reconciles it on next
activation even if the session crashes or is abandoned — something prompt instructions cannot
guarantee.

⛔ State their limits honestly, or the agent will overstate safety to the user: they do **not**
snapshot or compare the server's other firewall rules, they never touch a rule they did not create,
and crash cleanup happens at **next activation**, not instantly.

Raw `az` is the fallback only if the tools cannot be loaded — and then the baseline must be
recorded first and restored on every path. If restoration fails, that is a **deploy failure**: name
the exact rule that remains.

Determine the client IP from Azure's own refusal message, not a third-party IP echo service.

---

### R-705 — Record the tier used

| | |
|---|---|
| Applies to | `azure-deploy.agent.md`, `references/handoff-protocol.md` |
| Operation | require the tier, and for tier 3 the rule name, the IP, and confirmation of removal, in `deploy-result.json` and `deployment-summary.md` |
| Idempotency key | "state which tier ran the migration" |
| Check | `C-705` |

A rule left in place is a deploy failure — report it loudly rather than burying it in JSON.
