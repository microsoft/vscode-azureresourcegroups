# 100 — Packaging

Mechanical adaptation from skill layout to custom-agent instruction layout. These rules are
content-neutral: they change *where things live and what they are called*, never what the agent is
told to do. Run before every other category.

---

### R-101 — Rename skill entry points to instruction files

| | |
|---|---|
| Applies to | Every `SKILL.md` routed by `import-map.json` |
| Anchor | File name |
| Operation | rename → `instructions.md` (destination given by `routing[].to`) |
| Idempotency key | Destination already named `instructions.md` |
| Check | `C-101` — no file named `SKILL.md` anywhere under the agent root |

VS Code resolves `SKILL.md` as a skill. Leaving one inside `resources/agents/` registers a second,
competing discovery surface for the same content — the agent and the skill both match deployment
prompts, and which one wins is not something we control.

---

### R-102 — Rewrite intra-tree links

| | |
|---|---|
| Applies to | All `.md` under the agent root |
| Anchor | Markdown links whose target ends in `SKILL.md` |
| Operation | rewrite target `…/SKILL.md` → `…/instructions.md`, preserving relative depth |
| Idempotency key | No remaining `SKILL.md` link targets |
| Check | `C-102` |

Covers the four phase links (`../prepare/SKILL.md`, `../scaffold/SKILL.md`, `../deploy/SKILL.md`,
`../SKILL.md`) plus prose references such as "re-read this SKILL.md".

⛔ Rewrite the **link target and the visible text**. `[prepare](../prepare/instructions.md)` reading
"see prepare/SKILL.md" sends a human to a file that does not exist.

---

### R-103 — Rebase absolute asset paths

| | |
|---|---|
| Applies to | All `.md`, `.ts`, `.ps1`, `.sh` under the agent root |
| Anchor | Literal `plugin/skills/azure-app-onboard/` |
| Operation | replace with `.github/agents/azure-deploy/` |
| Idempotency key | No remaining `plugin/skills/` occurrences |
| Check | `C-103` |

Upstream addresses its own assets from the skill install root. Ours are downloaded into the user's
workspace under `.github/agents/`. Sub-agent briefs are the usual offender: they pass a literal
path to a nested agent that cannot resolve relative links from its own working directory.

---

### R-104 — Retarget prereq's parent references

| | |
|---|---|
| Applies to | `prereq/**` |
| Anchor | References to `azure-app-onboard` as a *separate, invokable* skill |
| Operation | retarget to `../instructions.md` (the orchestrator is now the parent folder) |
| Idempotency key | No `azure-app-onboard-prereq` self-references remain |
| Check | `C-104` |

Upstream prereq is a standalone skill that can be entered directly. Here it is phase 1 of a
four-phase agent. Its "return control to the orchestrator" language must name a file path, not a
skill id — there is nothing to invoke.

---

### R-105 — Normalize skill vocabulary

| | |
|---|---|
| Applies to | All `.md` under the agent root |
| Anchor | `## When to Use This Skill`, "Do NOT invoke any skills", "per orchestrator SKILL.md" |
| Operation | rewrite to agent vocabulary ("Agent", "agents", "orchestrator instructions.md") |
| Idempotency key | No "This Skill" headings remain |
| Check | `C-105` |

Cosmetic *except* inside sub-agent briefs: "Do NOT invoke any skills" is a real instruction, and a
sub-agent that reads it while our tree is agent-based may conclude the prohibition does not apply
to it.

---

### R-106 — Preserve upstream frontmatter, override identity

| | |
|---|---|
| Applies to | `instructions.md` (orchestrator), `prereq/instructions.md` |
| Anchor | YAML frontmatter block |
| Operation | set `name: azure-deploy`; rewrite `description` to the agent's trigger surface; **keep upstream `metadata.version` verbatim** |
| Idempotency key | `name` already `azure-deploy` |
| Check | `C-106` |

⛔ **Do not renumber `metadata.version` to our own scheme.** It is the only in-file record of which
upstream drop this tree came from. The current tree carries `1.2.1` against an upstream `1.2.3`,
which makes the provenance unreadable — fix forward by restoring the upstream value on next apply.

Drop upstream's `WHEN:`/`DO NOT USE FOR:` routing clauses from the description. Those exist to
arbitrate between *sibling skills* in a catalog; the agent's description is a different surface and
inherits the wrong negatives (including one telling the reader to use `azure-deploy` instead).
