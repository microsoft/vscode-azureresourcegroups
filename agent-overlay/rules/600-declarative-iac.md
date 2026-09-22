# 600 — Declarative IaC and deploy safety

Every resource must originate from a template in the workspace. Upstream mostly assumes this; our
agent has been observed reaching for `az containerapp up` when a template deployment failed, so the
rule is stated as an explicit, non-negotiable contract.

---

### R-601 — Hard rules block in the wrapper

| | |
|---|---|
| Applies to | `resources/agents/azure-deploy.agent.md` (overlay-only) |
| Anchor | Immediately after frontmatter, before the startup report |
| Operation | insert `## Hard rules — read first, do not skip, do not negotiate` |
| Idempotency key | Heading `## Hard rules` |
| Check | `C-601` |

Four rules, in order:

1. Every resource comes from a template written into the workspace; provisioning happens by
   deploying it (`az deployment sub|group create`, `azd up`/`provision`, `terraform apply`).
2. Never provision imperatively — `az containerapp up`, `az webapp up`, `az … create` and friends
   are blocked **including as a fallback when a template deployment fails**.
3. A deployment that created resources without a template is a **failed** deployment regardless of
   app health. Never record `status: "succeeded"`, and never invent a deployment name like
   `manual-azure-cli-provision` to stand in for an ARM deployment that never happened.
4. `deploy-result.json` records what actually happened — `createdResources` is an array,
   `deploymentNames` lists real ARM deployment names.

---

### R-602 — Move the blocked-patterns trigger earlier

| | |
|---|---|
| Applies to | `deploy/instructions.md` (top), `deploy/references/blocked-patterns.md` |
| Anchor | Top of the deploy phase, above Quick Reference |
| Operation | require reading `blocked-patterns.md` before the **first resource-creating command**, not before `az deployment sub create` |
| Idempotency key | "before your first resource-creating command" |
| Check | `C-602` |

⛔ The precise trigger is the entire point. Keyed to the declarative command alone, the rule is
unreachable on the one path that needs it: an agent that decided to provision imperatively never
runs `az deployment sub create`, so it never reaches the file explaining that imperative
provisioning is forbidden.

Also state the corollary: if `infra/` holds no template, you are not ready to deploy — return to
scaffold. Reaching for `az containerapp up` because the template is failing is never available.

---

### R-603 — Never auto-open the portal

| | |
|---|---|
| Applies to | `deploy/instructions.md` step 6, `deploy/references/portal-links.md`, `deploy-safety.md` |
| Anchor | Portal link generation snippets |
| Operation | remove every `Start-Process $link` / browser-launch call; print the bare URL only |
| Idempotency key | No `Start-Process` under `deploy/` |
| Check | `C-603` |

Seizing the user's foreground window mid-deploy is hostile, and it fires again on every healing
retry. Print a ctrl-clickable URL and let them choose.

---

### R-604 — Bicep warnings fail validation

| | |
|---|---|
| Applies to | `scaffold/references/validation-and-manifest.md`, `scaffold/references/scaffold-schemas.ts` |
| Anchor | The `az bicep build` pass criteria |
| Operation | treat any `Error BCP*` **or** `Warning BCP*` as fail; carve out `BCP081` as advisory; linter warnings pass |
| Idempotency key | `BCP035` in the pass-criteria table |
| Check | `C-604` |

Exit code 0 does not mean valid: a resource missing its required `location`, `sku`, and `kind`
compiles with exit 0 and only `Warning BCP035`. Read **stderr**, not the exit code.

`BCP081` is advisory because bicep's bundled type index lags ARM, so it also fires on API versions
that are real and current.

---

### R-605 — Validation evidence must be observed

| | |
|---|---|
| Applies to | `scaffold/references/validation-and-manifest.md`, `scaffold-schemas.ts` |
| Operation | `validationResult` is `{ status, checks: [{ name, passed: boolean, detail? }] }` |
| Idempotency key | `"passed": true` shape in the example block |
| Check | `C-605` |

Upstream's `{ "result": "PASS" }` shape does not match its own `ValidationResult` type, and
`ConformanceResult` (`{ passed, failures[], source }`) is a *different* type for a different gate —
they are not interchangeable.

⛔ `detail` must describe what was actually observed: the command run and its real output. Never
write a `detail` claiming a command succeeded unless it was run.
