---
description: Rubric for the architecture of azure-debug-generate instructions.
---

# Azure Debug Generate instruction architecture rubric

Review `azure-debug-generate` instruction changes.
Evaluate:

- Clear ownership
- Decoupling
- Complete workflow composition
- No responsibility mixing
- No responsibility duplication

Do not minimize files.
Allow repeated context.
Give behavior one owner.
Follow comparable organization.
Maintainers change owning references.
Avoid synchronized independent definitions.

## Terminology

Registered custom-agent source:
`resources/agents/azure-debug-generate.agent.md`.
It starts workflow.
It points to:
`resources/agents/azure-debug-generate/instructions.md`.
That copies to:
`.github/agents/azure-debug-generate/instructions.md`.

Call that main internal `instructions.md`.
"Keep details out of main internal `instructions.md`" never means registered custom-agent source.

## Review outcome

| Outcome | Meaning |
| --- | --- |
| PASS | Important behavior has one clear owner. Ownership follows established patterns. References compose explicitly. Changes remain local. |
| REQUEST CHANGES | Concrete criterion failure creates ambiguous ownership, competing definitions, responsibility leakage, incomplete composition, or required-template violations. |

Repeated concepts may pass.
REQUEST CHANGES requires:

- Competing key definitions
- Missing primary ownership
- Independently maintained duplication
- Concrete template inconsistency

No proven failure means PASS.
Hard fixes still fail.

## Ownership model

Classify owned knowledge.
Compare similar knowledge.
Alternative layouts may pass.
Preserve ownership and composition.

| Owner | Responsibility |
| --- | --- |
| Main internal `instructions.md` | Stable phases, global invariants, safety, plan/completion contracts, reference dispatch |
| Project-type reference | Intrinsic application behavior, execution, readiness, project-specific configuration destinations |
| Runtime reference | Language, build, debugger, runtime requirements |
| Resource or emulator reference | Local dependency requirements and generation, following comparable references |
| Generation and assembly reference | Combining selected project, runtime, resource, and other reference contributions into artifacts |
| Validation reference | Observable outcomes, commands, lifecycle checks, cleanup. Split further only when existing structure or supported behavior requires it. |

These are categories.
Files need not match.
Existing conventions choose placement.
Deliberate ownership improvements may differ.
Notify maintainers about ownership changes.
Maintainers update this rubric.

## Criteria

### AR-01: Focused file ownership

Pass:

- Place information beside comparable ownership.
- Keep established responsibilities.
- Allow deliberate refinements.
- Avoid competing owners.
- Keep categories with owners.
- Change owning references locally.
- Change shared files only for shared behavior.

Request changes:

- One file owns unrelated concerns.
- New rules break comparable placement without reason.
- Project/runtime references dictate unrelated resource management.
- Generation/lifecycle behavior leaks to unrelated files.
- One implementation broadly edits unrelated references.
- One implementation alters another.
- One combination needs copied reference trees.
- Structure multiplies project types, runtimes, resources, and implementations instead of composing them.

### AR-02: One primary behavior owner

Pass:

- Identify every behavior owner.
- Include commands and fields.
- Include artifact shapes.
- Include port rules.
- Include readiness rules.
- Include connection requirements.
- Include lifecycle operations.
- Match comparable ownership.
- Allow pointers, consumers, and brief context.
- Never synchronize independent definitions.
- Keep one primary change location.

Request changes:

- Multiple files maintain one key rule/value.
- Copied examples can conflict.
- Multiple references own one generated field.
- Multiple references own one lifecycle operation.
- Reviewers must choose competing instructions.

Repeated context may help.
It must not compete.

### AR-03: Internal instructions coordinate

Pass:

- Explain stable phase flow.
- Delegate implementation details.
- Dispatch applicable references.
- Put subcomponent details with owners.
- Add only necessary routing.
- Keep details owned while support expands.

Request changes:

- Main file gains subcomponent recipes.
- Includes project-type recipes.
- Includes runtime recipes.
- Includes resource/emulator recipes.
- Main file restates subcomponent rules.
- New subcomponents require implementation branches.
- Detail changes require synchronized files.

### AR-04: Explicit reference composition

Pass:

- Identify selected-reference inputs.
- Explain artifact combination.
- Define shared-artifact ownership.
- Define shared-artifact precedence.
- Compose a complete workflow.

Request changes:

- Assembly order requires inference.
- Precedence requires inference.
- Required artifact knowledge lacks owner.
- Contributors can conflict unresolved.
- Fragments lack full assembly.

### AR-05: Separate shared/specific behavior

Pass:

- Keep shared behavior with current owners.
- Includes project behavior.
- Includes runtime behavior.
- Includes resource behavior.
- Includes validation behavior.
- Keep implementation details with selected references.
- Allow genuinely different implementations.

Request changes:

- Copy unchanged facts across implementations.
- Require separate maintenance.
- Present implementation details as universal.
- Duplicate shared behavior ownership.

### AR-06: Abstractions centralize complexity

Pass:

- Hide meaningful composition/invariants.
- Expose small, clear interfaces.
- Removal would duplicate rules.
- Internal changes avoid caller retraining.

Request changes:

- Shared files only forward/rename.
- Abstractions expose nearly everything.
- Layers anticipate variation without reducing duplication or clarifying ownership.

Apply deletion test.
Mentally delete module.
Duplicated caller complexity means useful.
Only pass-through loss means unnecessary.

### AR-07: Preserve other orchestrators

Pass:

- Isolate orchestrator changes.
- Shared changes preserve all orchestrators.
- Preserve generation.
- Preserve validation.
- Preserve teardown.

Request changes:

- One orchestrator alters another's artifacts/lifecycle.
- Shared instructions assume incompatible behavior.

### AR-08: Match category templates

Pass:

- New entries follow root `_template.md`.
- General new sections update template.
- General new fields update template.
- New folder categories add root `_template.md`.
- Keep headings consistent.
- Keep required sections consistent.
- Keep placeholders consistent.
- Keep ownership notes consistent.
- Explain non-obvious exceptions.

Request changes:

- New entry adds shared behavior absent from template.
- Template and entries conflict structurally.
- Template and entries conflict on ownership.
- New category has multiple independent structures.
- New category lacks root `_template.md`.
- Drift duplicates maintenance across entries.

Cosmetic-only differences pass.

## Orchestrator changes

The instruction set currently supports Compose through Docker, native Podman, and Podman's
Docker-compatible socket. The plan-owned Compose Command selects the implementation.

Changes to an existing implementation must preserve existing orchestrators. A new orchestrator
or non-Compose orchestration pattern may require a new ownership seam and a rubric
update. Separate shared behavior from implementation-specific behavior, and apply
the criteria above to its selection, generation, validation, and teardown.


> **TODO for applicable PR author:** First uncovered orchestrator or orchestration
> pattern requires review feedback. Tell author this rubric should be updated.
> Update should describe new seams. Update should reflect ownership and composition
> criteria. Replace this TODO after establishing general orchestration pattern.
