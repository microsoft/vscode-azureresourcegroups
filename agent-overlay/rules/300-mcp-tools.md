# 300 — MCP tools and views

Upstream is chat-only. The extension ships webviews and state tools over the same session
artifacts. These rules wire the agent to them — and, just as importantly, stop the agent from
declaring them unavailable and narrating a fallback in chat.

All tools are provided by the in-proc `copilot-azure-resources-extension-tools/*` server declared
in the wrapper's `tools:` frontmatter.

---

### R-301 — Tool-loading contract

| | |
|---|---|
| Applies to | `resources/agents/azure-deploy.agent.md` (overlay-only) |
| Anchor | After frontmatter, before the workflow section |
| Operation | insert the "Azure Resources MCP Tools" section |
| Idempotency key | Heading `## Azure Resources MCP Tools` |
| Check | `C-301` |

Must state: the tools **are** available in this session even when VS Code does not surface them;
load with `tool_search` using the **exact tool name only**, then `activate_tools`, then invoke;
retry on miss; and never substitute a manual workaround or announce completion before the call
actually succeeded.

Without this, the observed failure mode is the agent reporting "the extension does not expose this
MCP endpoint" and continuing — producing a deployment with empty views and no durable state.

---

### R-302 — Launch telemetry

| | |
|---|---|
| Applies to | `azure-deploy.agent.md` |
| Anchor | Top of body, before any workspace read |
| Operation | insert the `report_agent_launch` startup-report section |
| Idempotency key | `report_agent_launch` |
| Check | `C-302` |

Once per chat session, `{ "agentName": "azure-deploy" }`, before reading or writing files. Failure
is non-blocking: retry once, then continue silently. ⛔ Never let telemetry gate user work.

---

### R-303 — Deployment plan view at the scaffold gate

| | |
|---|---|
| Applies to | `references/approval-gates.md`, `azure-deploy.agent.md` |
| Anchor | Scaffold approval gate section |
| Operation | require `open_deploy_plan_view` immediately after `prepare-plan.json` is written, **before** the gate text |
| Idempotency key | `open_deploy_plan_view` |
| Check | `C-303` |

Display only. The chat gate still owns the Yes / Edit plan / Cancel decision — the view never
counts as consent.

---

### R-304 — CLI prerequisite reporting

| | |
|---|---|
| Applies to | `references/approval-gates.md`, `azure-deploy.agent.md` |
| Anchor | Scaffold approval gate, alongside R-303 |
| Operation | probe `azd version` / `az version` in the user's own shell, then call `record_deploy_prerequisites` |
| Idempotency key | `record_deploy_prerequisites` |
| Check | `C-304` |

One entry per tool with `installed` and, when known, `version`. ⛔ Do **not** pass install links or
display names — the view resolves those from its own catalog, and agent-supplied URLs are an
injection surface. ⛔ Do **not** write prerequisite state into `prepare-plan.json`; that is
upstream's artifact and the view does not read it.

Checking the CLIs by hand and describing the result in chat does not satisfy this — the user's
plan view stays empty.

---

### R-305 — Deployment results view at handoff

| | |
|---|---|
| Applies to | `references/handoff-protocol.md`, `azure-deploy.agent.md` |
| Anchor | Artifact self-check, before the chat handoff |
| Operation | require exactly one `open_deploy_result_view` call after `deploy-result.json` reaches a terminal status |
| Idempotency key | `open_deploy_result_view` |
| Check | `C-305` |

Call it on failure too — the failed endpoints and resources are exactly what the user needs. It
**supplements** the chat handoff; all four handoff sections still print.

⛔ Never call it while `status` is `in-progress`: the view reads from disk and will render a
half-written report as if it were final.

> **Known defect in the current tree:** this directive appears twice in
> `references/handoff-protocol.md`. The duplicate is a re-application artifact — evidence that this
> rule's idempotency key was not honored on a previous run. `apply` should collapse it to one.
