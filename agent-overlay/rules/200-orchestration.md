# 200 — Orchestration

Upstream phases are skills that invoke each other through the skill dispatcher. Ours are folders
inside one agent. Every cross-phase transition therefore has to become a file read, and every
external skill handoff has to become either an in-tree phase or an explicit refusal.

---

### R-201 — Replace skill dispatch with instruction reads

| | |
|---|---|
| Applies to | `instructions.md` workflow table |
| Anchor | `{"skill": "…"}` dispatch objects in phase rows |
| Operation | replace with a mandatory read of the phase's `instructions.md` |
| Idempotency key | No `{"skill":` dispatch objects remain |
| Check | `C-201` |

Upstream row 3 dispatches `{"skill": "azure-app-onboard-prereq"}`. Ours must read
`prereq/instructions.md` and continue at step 4. Keep upstream's halt conditions
(`overallHealth: "blocked"`, `routeToSkill` set) intact — only the transport changes.

⛔ **Scope is wider than the orchestrator table.** Dispatch objects also appear in sub-agent briefs
(`subagent-iac-gen.md`, `subagent-review.md`, `subagent-validate.md`, `subagent-pricing.md`,
`subagent-quota.md`, `subagent-starter-scaffold.md`) and in `approval-gates.md`,
`intent-gathering.md`, and `azd-template-routing.md`. A measured `apply` run left 16 occurrences
behind when this rule was read as covering only the workflow table.

---

### R-202 — Close the self-referential handoff

| | |
|---|---|
| Applies to | `instructions.md` (deploy recovery note, deploy approval gate row) |
| Anchor | Upstream's `NEVER invoke {"skill": "azure-deploy"}` warning |
| Operation | rewrite to "always use this pipeline's own `deploy/instructions.md`; do not hand off to any other deployment workflow" |
| Idempotency key | No `{"skill": "azure-deploy"}` string remains |
| Check | `C-202` |

⛔ This rule is load-bearing and counterintuitive. Upstream warns against a *different* skill that
happens to be named `azure-deploy`. Our agent **is** named `azure-deploy`. Copied verbatim, the
line reads as "never invoke yourself" and has been observed to stall the pipeline at the deploy
gate. Never restore upstream's wording here, however tempting the diff looks.

The warning appears in the orchestrator **and** in three sub-agent briefs. Rewriting only the
orchestrator leaves the hazard live in the briefs — and a check keyed to the orchestrator's exact
sentence will report green while it does.

---

### R-203 — Neutralize external skill routing

| | |
|---|---|
| Applies to | `references/azd-template-routing.md`, `references/handoff-protocol.md`, `prereq/**` `routeToSkill` paths |
| Operation | keep the *detection*, replace the *dispatch* with a user-facing report |
| Idempotency key | No upstream sibling-skill names appear as invocation targets |
| Check | `C-203` |

Upstream can route to `azure-prepare`, `azure-cost`, and friends because they are all installed
siblings. We ship one agent. Detecting "this repo already has an azd template" is still valuable —
tell the user and stop. Silently continuing the greenfield path over an existing template is worse
than either alternative.

---

### R-204 — Keep both approval gates mandatory

| | |
|---|---|
| Applies to | `references/approval-gates.md`, `instructions.md` steps 6 and 8 |
| Anchor | Scaffold gate and Deploy gate sections |
| Operation | preserve upstream gate text verbatim; add the view calls from `300-mcp-tools.md` |
| Idempotency key | Both gate headings present |
| Check | `C-204` |

The gates are upstream's, not ours — we add rendering around them, we do not reword the prompt or
merge the two into one confirmation. Also: an upstream `[AUTOPILOT MODE]` marker does **not**
suppress these gates. Provisioning spend and resource creation stay human-approved.

---

### R-205 — Session artifacts stay in the pipeline's own namespace

| | |
|---|---|
| Applies to | `instructions.md`, `references/session-protocol.md`, `prereq/references/session-protocol.md` |
| Anchor | `.copilot-azure/sessions/{id}/` references |
| Operation | preserve unchanged; add a prohibition on writing pipeline artifacts into `.azure/` |
| Idempotency key | Prohibition sentence present in `instructions.md` |
| Check | `C-205` |

`.azure/` belongs to the sibling project agents (`project-plan`, `project-scaffold`,
`project-integrate`). `prepare-plan.json` landing there collides with `deployment-plan.md` and
makes resume ambiguous for both pipelines.
