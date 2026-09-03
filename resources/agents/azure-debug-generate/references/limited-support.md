# Limited Support Warnings

> Emit a standardized warning when the skill detects a feature that is not yet fully supported. The warning format is consistent across all feature categories so the user always knows what to expect.

---

## ⛔ Detection Algorithm — MANDATORY

For every project type, runtime, and emulator declared in the plan's tables, follow this procedure **exactly**:

1. **Check for a matching reference file** — List the files and subdirectories in the category folder (ignoring `_template.md`). If any filename or subdirectory name loosely matches the declared value (ignoring case, spaces, dashes, and underscores), the feature has a reference file.
2. **Check the status inside the reference file** — Open the matched reference file and look for a status indicator. If the file is marked `🔲 Planned` (in a frontmatter note, status field, or top-level callout), the feature has **limited support** despite having a reference file. You **MUST** emit a warning.
3. **If a match exists AND the file is not marked Planned** → the feature is fully supported. Proceed normally.
4. **If no match exists** → the feature has limited support. You **MUST** emit a warning. Do NOT substitute a different, supported feature.

| Category | Category Folder | Path Notes |
|----------|-----------------|------------|
| Project type | `references/project-types/` | Some types use subdirectories (e.g., `frontend-spa/frontend-spa.md`). Match against both filenames and subdirectory names. |
| Runtime | `references/runtimes/` | |
| Emulator | `references/emulators/` | |

> ⚠️ **Do NOT skip this check.** Every declared feature MUST be verified against the category folder before generating artifacts.

---

## Warning Format

```
⚠️ LIMITED SUPPORT: {Category} "{value}" is not yet fully supported.
```

Where:
- `{Category}` — a short label for the feature area (e.g., `Project type`, `Runtime`, `Emulator`)
- `{value}` — the specific feature declared in the plan (e.g., `python`, `Container App`, `Cosmos DB`)

---

## ⛔ Emission Protocol — MANDATORY

When a limited-support feature is detected, you **MUST** follow this exact sequence:

### Step 1: Emit in assistant message

Write the canonical warning in your **regular assistant message text**. This is mandatory — the warning must be visible in the chat output, not hidden inside a tool call.

```
⚠️ LIMITED SUPPORT: Emulator "Durable Task Scheduler" is not yet fully supported.
```

### Step 2: Confirm with user

For the **first** limited-support feature encountered in the session, call `ask_user` to confirm whether to proceed:

```
ask_user(
  question: "⚠️ LIMITED SUPPORT: {Category} \"{value}\" is not yet fully supported. Would you still like me to put forth a best-effort attempt?",
  choices: [
    "Yes, proceed with best effort",
    "No, stop here"
  ]
)
```

If the user agrees, treat that as blanket consent for the rest of the session. Any additional limited-support features discovered later should still be emitted as a warning — but do **not** call `ask_user` again.

> Emit each `⚠️ LIMITED SUPPORT:` warning exactly once per `(Category, value)` pair in assistant messages.
---

## No Silent Substitution

**Do NOT silently substitute a supported alternative** when a feature has limited support (e.g. switching a Container App to Azure Functions, or Python to Node.js). Always generate for the project type, runtime, and emulators declared in the plan, even when support is limited.
