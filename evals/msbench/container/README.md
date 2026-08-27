# A custom benchmark image for the Copilot-on-Rails suite

Every stimulus in this suite is an Azure Functions project, and the stock
vscbench image has no `func`. `detectFunctionsProject` in
`evals/src/runtime/runtimeTarget.ts` therefore returned
`notApplicable('functionsHostUnavailable')` and all five `runtime-*` gates stood
down on every run since they were written. Not red — *not asked*, which is the
worse failure, because nothing downstream contradicts it.

This directory builds an image that carries `func`, hosted in our own Azure
Container Registry. `build-image.sh` assembles and pushes it.

**Measured, on run `2026082777513216`:**

```
+ command -v func
++ func --version
+ echo 'func already present: 4.14.0'
```

and the agent went on to run `func init services/functions --typescript --model V4`
in the container.

## Why not one of the simpler routes

Both alternatives were tried and failed for reasons worth not rediscovering.

| Route | Outcome |
|---|---|
| Install `func` in the `local.yaml` preamble | `npm error code E401 - Unable to authenticate`. The container's npm resolves through a registry the run holds no token for. |
| Push to the shared MSBench ACR (`codeexecservice.azurecr.io`) | Needs the `MSBench User` entitlement role *and* a local Docker daemon — `build_and_push.py` calls `docker info`. We have neither. |

The fail-soft `func` install in `config/phases/local.yaml` is deliberately kept.
It now finds `func` already present and no-ops, and it is what makes a run on the
stock image degrade rather than explode.

## One-time registry setup

This is the part that cost the most to find, so it is written down precisely.

### 1. The CES service principal needs `AcrPull` on your registry

The CES GitHub Actions runner authenticates to your registry with its own
identity. There is no field anywhere in the dataset for credentials — the only
thing you supply is the registry hostname, so the grant has to exist server-side.

| Property | Value |
|---|---|
| Display name | `Code Execution Service` |
| Client ID | `f5f1c93c-d453-4444-9130-08171f5bf07c` |
| Object ID | `624eaabe-ca87-4607-80ac-28b5b0d6b76f` |

```bash
az role assignment create \
    --assignee-object-id 624eaabe-ca87-4607-80ac-28b5b0d6b76f \
    --assignee-principal-type ServicePrincipal \
    --role AcrPull \
    --scope "$(az acr show -n cormsbench --query id -o tsv)"
```

For `--backend ces-ame` the identity is different (`5681fe46-…` /
`30116bde-…`) **and your registry must live in the AME tenant** — the AME
managed identity cannot authenticate across tenants. We run on `ces-dev1`, so
the Corp service principal above is the one that matters here.

### 2. Leave the registry in `RBAC Registry Permissions` mode

The portal calls the required mode **RBAC Registry Permissions**. In ARM and in
`az acr show` that same mode is spelled **`LegacyRegistryPermissions`**:

```bash
az acr show -n cormsbench --query roleAssignmentMode -o tsv   # LegacyRegistryPermissions
```

The name invites a "fix" that breaks everything. Switching to
`AbacRepositoryPermissions` (`--role-assignment-mode rbac-abac`, shown in the
portal as *RBAC Registry + ABAC Repository Permissions*) stops the legacy
`AcrPull` role being honoured for data-plane operations, so the grant above
silently stops working. A new registry defaults to the correct mode; the only
way to get this wrong is to change it deliberately.

### 3. Anonymous pull does not help

It looks like it should, and it does not. The CES job runs `az acr login`
*before* it pulls, and that step fails on a registry where the identity has no
role assignment regardless of whether unauthenticated pulls are allowed. This
was measured — enabling anonymous pull changed nothing, and it has been turned
back off.

## Pointing a run at the image

The registry is a per-instance property of the benchmark data, so a single run
can mix images from several registries.

```jsonl
{"benchmark":"corbench","instance_id":"cor_functions_host","image_tag":"vscbench.eval.x86_64.cor_functions_host:msbench-1.0.0","container_registry":"cormsbench.azurecr.io"}
```

```bash
BENCHMARK=corbench.cor_functions_host ./run.sh \
    --stimulus debug-plan-approval-gate \
    --dataset /path/to/cor-dataset.jsonl
```

An explicit `--acr <registry>` overrides the value in the row for CES runs, which
is the quickest way to retarget without editing data. Omitting
`container_registry` entirely defaults to `codeexecservice.azurecr.io`.

> The upstream docs warn that `container_registry` must also appear in a row's
> `benchmark_columns` or MSBench silently falls back to the default ACR. That
> warning applies to a *partially* specified `benchmark_columns`. Omitting the
> field altogether is safe: `_instances_from_dataframe` fills it with every
> column, and `container_registry` is in `_EXPLICIT_INSTANCE_FIELDS` so it
> survives either way. Verified by running our dataset through MSBench's own
> parser.

## When an instance comes back `missing`

`missing` means the artifacts were never uploaded — infrastructure, not the
agent. It is indistinguishable from the outside whether the image failed to
pull, failed to start, or was rejected, so go to the telemetry rather than
guessing. This needs only `az login`; it does **not** need access to
`github/code-execution`.

```kusto
// Cluster: https://ces-westus3-adx.westus3.kusto.windows.net
// Database: ces_telemetry_prod
CESBenchmarkInstanceStatusV2View()
| where run_id == '<run_id>' and status == 'completed' and conclusion == 'failure'
| extend rawParsed = parse_json(tostring(raw))
| extend steps = parse_json(tostring(rawParsed.steps))
| mv-expand step = steps
| extend step_name = tostring(step.name), step_conclusion = tostring(step.conclusion)
| where step_conclusion != 'success'
| project run_id, instance_id, step_name, step_conclusion,
          html_url = tostring(rawParsed.html_url)
```

That names the failing workflow step directly. Ours said:

```
success    Compute container name
failure    Login to ACR                              <-- the whole problem
skipped    Pull requested benchmark image from ACR
skipped    Start benchmark container
```

Two runs (`2026082771615858`, `2026082772461452`) failed there in under three
seconds with no output at all. After the `AcrPull` grant, run
`2026082777195896` walked the same steps green and pulled
`cormsbench.azurecr.io/vscbench.eval.x86_64.cor_functions_host:msbench-1.0.0`.

## Known gap: no datastore

`runtime-crud` needs a running PostgreSQL, and `init-custom-workspace.sh` runs
at *build* time only. A database also has to be alive while the agent works,
which needs a decision about the container's single entrypoint. That is
deliberately left undone rather than half-done — one change, one question — and
`react-functions-postgres.yaml` still declares `datastoreRequiresContainer`.

## Reference

The authoritative page is *Bring Your Own Azure Container Registry* at
<https://msbenchapp.azurewebsites.net/documentation/bring-your-own-azure-container-registry>
(Microsoft-managed device required; the agent tooling cannot reach it).
