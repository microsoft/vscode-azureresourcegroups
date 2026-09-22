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

Call that the internal `instructions.md`.
"Keep details out of the internal `instructions.md`" never means the registered custom-agent source.

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
| Internal `instructions.md` | Defines the workflow, shared rules, safety checks, plan requirements, and which references to use |
| Project-type reference | Defines how the app runs, how readiness is checked, and where project settings belong |
| Runtime reference | Defines language, build, debugger, and runtime requirements |
| Resource or emulator reference | Defines local dependency setup and generated settings |
| Generation reference | Combines the selected references into the output files |
| Validation reference | Defines expected results, commands, checks, and cleanup. Split only when needed. |

These are categories.
Files need not match.
Existing conventions choose placement.
Deliberate ownership improvements may differ.
Notify maintainers about ownership changes.
Maintainers update this rubric.

## Criteria

### AR-01: Focused file ownership

Pass:

- Put similar rules in the same kind of file. Keep current responsibilities unless the change clearly improves them.
- Give each rule one clear owner.
- Change only the owning reference. Change shared files only when the rule applies to all implementations.

Request changes:

- A file covers unrelated work, or a rule is placed differently from similar rules without a reason.
- Project, runtime, resource, generation, start, stop, or cleanup rules appear in the wrong file.
- One implementation changes another, requires copied references, or adds separate files for every possible combination.

### AR-02: One primary behavior owner

Pass:

- Give every command, field, artifact format, port rule, readiness check, connection rule, and start, stop, or cleanup step one primary owner.
- Put similar rules in the same kind of file and keep one main place to change each rule.
- Pointers and short reminders may repeat a rule, but must not redefine it.

Request changes:

- Multiple files define the same key rule, value, generated field, or start, stop, or cleanup step.
- Copied examples can conflict, or reviewers must choose between competing instructions.

Repeated context may help.
It must not compete.

### AR-03: Internal instructions coordinate

Pass:

- Explain the main phase flow and point to the references needed for each case.
- Keep project, runtime, resource, and emulator details in their own references. Add only the links needed to bring them together.

Request changes:

- The main file adds or repeats project, runtime, resource, or emulator instructions.
- Supporting another project type, runtime, resource, or emulator requires new branches in the main file, or one detail must be changed in several files.

### AR-04: References work together

Pass:

- List the references used for a case and explain how their instructions form a complete workflow.
- State which reference defines shared output and which rule wins if references disagree.

Request changes:

- Reviewers must guess the order or which rule wins.
- Required output has no clear owner, conflicts have no answer, or the instructions never explain how to produce the complete output.

### AR-05: Separate shared/specific behavior

Pass:

- Keep shared project, runtime, resource, and validation rules in their current references.
- Keep implementation details in the reference for that implementation. Different implementations may differ when needed.

Request changes:

- The same facts are copied across implementations and must be updated separately.
- Details for one implementation are stated as rules for all implementations, or a shared rule has more than one owner.

### AR-06: Shared modules simplify callers

Pass:

- Put shared rules behind a small, clear interface.
- Removing the module would copy those rules into its callers. Internal changes do not require caller changes.

Request changes:

- A shared file only forwards or renames things, or callers still need to know most internal details.
- A module adds another layer without removing repeated rules or making ownership clearer.

Apply deletion test.
Mentally delete module.
Repeated rules in callers mean useful.
Only pass-through loss means unnecessary.

### AR-07: Preserve other orchestrators

Pass:

- Keep changes for one orchestrator out of the others.
- Shared changes preserve file generation, checks, and cleanup for every orchestrator.

Request changes:

- One orchestrator changes another's files, start steps, stop steps, or cleanup.
- Shared instructions assume behavior that another orchestrator cannot support.

### AR-08: Match category templates

Pass:

- New entries follow the root `_template.md`; new folder categories add one.
- Add common sections and fields to the template. Keep headings, required sections, placeholders, and ownership notes consistent.
- Explain non-obvious exceptions.

Request changes:

- An entry adds a shared rule that is missing from the template, or conflicts with the template's structure or ownership.
- A category lacks a root `_template.md`, uses inconsistent structures, or repeats rules across entries.

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
