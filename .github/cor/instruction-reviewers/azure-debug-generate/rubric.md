---
description: Rubric for the architecture of azure-debug-generate instructions.
---

# Azure Debug Generate instruction architecture rubric

Review `azure-debug-generate` instruction changes.
Evaluate:

- Clear ownership
- Decoupling
- Complete workflow composition
- No mixing or duplicating of responsibility

Do not minimize file count.
Do not prohibit repeated context.
Give important behavior one owner.
Follow comparable instruction-set organization.
Maintainers change owning references.
Avoid synchronized independent definitions.

## Terminology

Registered custom-agent source:
`resources/agents/azure-debug-generate.agent.md`.
It starts workflow.
It points to internal generation instructions:
`resources/agents/azure-debug-generate/instructions.md`.
That file copies into:
`.github/agents/azure-debug-generate/instructions.md`.

This rubric calls it main internal `instructions.md`.
"Keep details out of main internal `instructions.md`" never refers to registered custom-agent source.

## Review outcome

| Outcome | Meaning |
| --- | --- |
| PASS | Important behavior has one clear owner. Ownership follows established patterns. References compose explicitly. Changes remain local. |
| WARN | A useful improvement that does not establish a criterion failure, or a possible criterion failure whose correction is not yet clear. |
| SEVERE | A concrete criterion failure makes ownership ambiguous, creates competing definitions, leaks responsibility, or leaves workflow composition incomplete. |

Repeated concepts alone pass.
A `SEVERE` outcome requires:

- Competing key definitions
- Missing primary ownership
- Independently maintained duplication

Use `WARN` when the evidence supports a recommendation but does not establish
one of those failures, or when a possible failure has no clear correction yet.
An established failure remains `SEVERE` even when the correction is difficult.

## Ownership model

Classify owned knowledge.
Compare similar existing knowledge.
Alternative layouts may pass.
They must preserve ownership and composition.

| Owner | Responsibility |
| --- | --- |
| Main internal `instructions.md` | Stable phases, global invariants, safety, plan/completion contracts, reference dispatch |
| Project-type reference | Intrinsic application behavior, execution, readiness, project-specific configuration destinations |
| Runtime reference | Language, build, debugger, runtime requirements |
| Resource or emulator reference | Local dependency requirements and generation, following comparable references |
| Generation and assembly reference | Combining selected project, runtime, resource, and other reference contributions into artifacts |
| Validation reference | Observable outcomes, commands, lifecycle checks, cleanup. Split further only when existing structure or supported behavior requires it. |

These are categories.
They are not required files.
Existing conventions choose placement.
Exception: deliberate ownership improvements.
Changed ownership structure requires maintainer notice.
Maintainers must update this rubric.

## Criteria

### AR-01: Files have focused ownership

Pass:

- Place new information with comparable owned information.
- Keep sections within established responsibility.
- Deliberate responsibility refinements may pass.
- Avoid competing owners.
- Keep each knowledge category with its owner.
- Keep changes local to the references that own the behavior.
- Change shared files only when shared behavior changes.

Severe:

- One file owns unrelated workflow concerns.
- New rules differ from comparable placement without reason.
- Project/runtime references dictate unrelated resource representation or management.
- Generation or lifecycle behavior leaks into files lacking comparable ownership.
- One implementation broadly edits unrelated references.
- One implementation alters another implementation.
- One supported combination requires copied reference trees.
- Structure multiplies project types, runtimes, resources, and implementations instead of composing owned information.

### AR-02: Behavior has one primary owner

Pass:

- Identify each behavior owner.
- Includes commands and generated fields.
- Includes artifact shapes and port rules.
- Includes readiness rules and connection requirements.
- Includes lifecycle operations.
- Match comparable ownership elsewhere.
- Other references may point, consume, or briefly contextualize.
- Never create synchronized independent definitions.
- Maintainers can identify one primary change location.

Severe:

- Multiple files independently maintain one key rule/value.
- Copied examples can conflict.
- Multiple references own one generated field or lifecycle operation.
- Reviewers must choose among similar current instructions.

Repeated context may help usage.
It must not compete.

### AR-03: Internal instructions coordinate the workflow

Pass:

- Explain stable phase flow.
- Delegate implementation details.
- Dispatch applicable detailed references.
- New subcomponents add detailed behavior to owning references.
- Main flow gains only necessary selection/routing.
- Subcomponent behavior stays owned as support expands.

Severe:

- Main file gains concrete subcomponent recipes.
- Includes project-type recipes.
- Includes runtime recipes.
- Includes resource or emulator recipes.
- Main file restates subcomponent rules.
- Every new subcomponent adds main-file implementation branches.
- Detail changes require synchronized main/reference edits.

### AR-04: References compose explicitly

Pass:

- Identify each selected reference's inputs.
- Explain artifact combination.
- Define ownership and precedence for shared artifacts.
- Selected references form a complete workflow.

Severe:

- Assembly order or precedence requires inference.
- No selected reference owns required artifact knowledge.
- Contributors can conflict without resolution.
- Fragments lack whole-workflow assembly.

### AR-05: Shared and specific behavior stay separate

Pass:

- Keep unchanged shared project, runtime, resource, and validation behavior with current owners.
- Keep implementation-specific behavior with selected implementation references.
- Similar instructions may represent genuinely different implementations.

Severe:

- Copy unchanged facts into every implementation.
- Require separate maintenance.
- Present implementation-specific behavior as universal.
- Give shared resource/project behavior multiple owners because multiple implementations use it.

### AR-06: Shared abstractions centralize real complexity

Pass:

- Shared modules hide meaningful composition or invariants behind small, clear interfaces.
- Removing them duplicates rules across callers.
- Internal changes avoid caller retraining.

Severe:

- Shared files only forward or rename concepts.
- Abstractions expose nearly every detail.
- Layers anticipate variation without removing current duplication or clarifying ownership.

Apply deletion test.
Delete the module mentally.
Complexity reappears across callers: useful.
Only pass-through text disappears: unnecessary.

### AR-07: Changes to one orchestrator must not negatively affect others

Pass:

- Changes for one orchestrator remain isolated from other orchestrators.
- Shared changes preserve every supported orchestrator.
- Preserve generation behavior.
- Preserve validation behavior.
- Preserve teardown behavior.

Severe:

- One orchestrator change can alter another's generated artifacts or lifecycle.
- Shared instructions assume behavior invalid for another supported orchestrator.

## When a PR introduces another orchestrator

Instruction set currently assumes Docker Compose.
Another orchestrator may change ownership.
Separate shared behavior.
Separate orchestrator-specific behavior.
Still apply rubric criteria in spirit.

> **TODO for applicable PR owner:** A new orchestrator or orchestration pattern may require rubric updates.
> Report `SEVERE` findings when needed.
> Reflect updated ownership and composition.
> Once general orchestration pattern exists, remove this provisional section.
> Update remaining rubric.
> Describe implemented orchestrator seams.
