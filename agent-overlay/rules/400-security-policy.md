# 400 — Security policy

The largest and most invasive category: upstream allows password-authenticated data services, Key
Vault, and free compute tiers. Copilot on Rails allows none of them. These rules touch ~35 files
and are the most likely to conflict on a re-vendor.

> **Why this is a policy overlay and not an upstream bug report:** upstream serves scenarios where
> a shared-key connection string is a legitimate choice. Ours does not. Expect this category to
> stay divergent indefinitely.

---

### R-401 — Managed identity on every compute resource

| | |
|---|---|
| Applies to | `scaffold/references/bicep-patterns-security.md`, `bicep-app-service.md`, `bicep-container-apps.md`, `terraform-patterns.md`, `self-review-checklist.md`, `subagent-*.md`, `waf-checklist.md` |
| Operation | require `identity: { type: 'SystemAssigned' }` on all compute; missing identity is a **mandatory FAIL**, not a warning |
| Idempotency key | "There is NO exception" clause in `bicep-patterns-security.md` |
| Check | `C-401` |

No SKU, tier, or service combination is exempt. User-assigned only where a shared identity is
genuinely required (MySQL Entra admin — see R-404).

---

### R-402 — Entra-only data services

| | |
|---|---|
| Applies to | `scaffold/references/bicep-patterns-data.md`, `bicep-patterns-security.md`, `terraform-patterns.md`, `deploy/references/database-post-deploy.md`, both conformance scripts |
| Operation | forbid `administratorLogin` / `administratorLoginPassword` / access keys on **every** data service, including inside conditional branches |
| Idempotency key | Conformance code `DB-NO-LOCAL-AUTH` |
| Check | `C-402` |

Per-service form: PostgreSQL `passwordAuth: 'Disabled'` + `activeDirectoryAuth: 'Enabled'`;
Azure SQL `azureADOnlyAuthentication: true`; MySQL `aad_auth_only`; Storage
`allowSharedKeyAccess: false`; Redis `disableAccessKeyAuthentication: true`; Cosmos
`disableLocalAuth: true`; Service Bus / Event Hubs `disableLocalAuth: true`.

The deploying principal becomes the server's Entra administrator so migrations run token-based.

⛔ **Never re-enable password auth to unblock a failing migration.** That is the one fix that is
never available — see `700-post-deploy-migrations.md`.

---

### R-403 — No Key Vault

| | |
|---|---|
| Applies to | `scaffold/references/bicep-patterns-security.md`, `bicep-patterns.md`, `bicep-container-apps.md`, `env-var-secrets.md`, `iac-generation-rules.md`, `rbac-roles.md`, `terraform-patterns.md`, both conformance scripts |
| Operation | forbid `Microsoft.KeyVault/vaults`, `@Microsoft.KeyVault(...)`, `keyVaultUrl`, and KV role assignments |
| Idempotency key | Conformance code `NO-KEYVAULT` |
| Check | `C-403` |

Azure resource auth is managed identity + token, so there is nothing to store. Genuinely
app-internal secrets (`SECRET_KEY`, JWT signing key, third-party API keys) go **on the compute
resource** from an `@secure()` parameter: App Service app settings, or Container Apps *native*
`secrets[]` + `secretRef`.

⛔ App settings and container `env` must never hold a connection string, password, access key, or
SAS token. If a value would authenticate you, it does not belong there.

---

### R-404 — MySQL Entra admin requires a user-assigned identity

| | |
|---|---|
| Applies to | `scaffold/references/bicep-patterns-data.md`, `scaffold-conformance.{ps1,sh}` |
| Operation | require a UAMI on the server identity and a non-null `identityResourceId` on the `administrators` child |
| Idempotency key | Conformance code `MYSQL-ENTRA-UAMI` |
| Check | `C-404` |

Unlike PostgreSQL, `identityResourceId: null` **fails to deploy**. Emit a
`postDeployRecommendation` to grant that UAMI **Directory Readers** — it cannot be assigned from
ARM, so the deploy will otherwise look clean and the app will fail to authenticate later.

---

### R-405 — Compute floors

| | |
|---|---|
| Applies to | `prepare/references/sku-matrix.md`, `pricing-guide*.md`, `sku-quota-validation.md`, `subagent-*.md`, `validation-rubric.md`, `prereq/references/*`, `references/pipeline-rules-runtime.md`, conformance scripts |
| Operation | App Service floor **B1**; Static Web Apps floor **Standard**; Functions floor **Flex Consumption**. Never emit F1, D1, Free SWA, classic Consumption, or Elastic Premium |
| Idempotency key | Conformance code `NO-FREE-SKU` |
| Check | `C-405` |

Rationale chain, which must survive in the text because it is what stops the rule being "optimized
away" later: managed identity is mandatory (R-401) → the free-tier MI sidecar OOMs on Linux → F1/D1
cannot host an MI. And Consumption/Elastic Premium back `AzureWebJobsStorage` with Azure Files,
which needs `allowSharedKeyAccess` — banned by R-402. Flex is the only Functions plan compatible
with both.

Consequence for the estimate: **there is no $0 tier.** Any app with compute gets a live pricing
call and a non-zero monthly figure at the gate.

---

### R-406 — Quota checks are not optional for paid SKUs

| | |
|---|---|
| Applies to | `prepare/references/sku-quota-validation.md`, `subagent-quota.md` |
| Anchor | Upstream's "Free ≠ unlimited" note |
| Operation | rewrite to "Paid ≠ unlimited" — B1, Flex, and Serverless all carry per-subscription, per-region quotas |
| Idempotency key | "Paid ≠ unlimited" |
| Check | `C-406` |

Upstream's phrasing implies quota checks exist *because* a tier is free, which invites skipping
them once R-405 removes free tiers.

---

### R-407 — Conformance gate covers policy, not just syntax

| | |
|---|---|
| Applies to | `scaffold/instructions.md` step 10a-conf, `scaffold/scripts/scaffold-conformance.{ps1,sh}` |
| Operation | extend the script beyond ARM-validity into policy codes: `NO-KEYVAULT`, `DB-NO-LOCAL-AUTH`, `DB-ENTRA-ADMIN`, `PG-ENTRA-ONLY`, `MYSQL-ENTRA-UAMI`, `STORAGE-NO-SHARED-KEY`, `REDIS-NO-KEYS`, `COSMOS-NO-LOCAL-AUTH`, `MSG-NO-LOCAL-AUTH`, `NO-FREE-SKU` |
| Idempotency key | All ten codes present in both scripts |
| Check | `C-407` |

`az bicep build` cannot catch any of these — a Key Vault compiles perfectly. Keep the two scripts
byte-equivalent in behavior; a check that exists only in the PowerShell variant silently stops
applying on macOS and Linux.

> **Known stale content in the current tree:** several scaffold references still explain how to
> handle F1/D1 (Dockerfile suppression, MI omission) even though R-405 forbids ever selecting them.
> Dead guidance that contradicts an active policy is a re-anchor candidate, not a no-op.
