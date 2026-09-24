# Limited Support Warnings

> Emit standard warning for features not fully supported. Consistent format across categories sets user expectations.

---

## ⛔ Detection Algorithm — MANDATORY

For every planned project type, runtime, and emulator, follow **exactly**:

1. **Check for a matching reference file** — List category files/subdirectories, ignoring `_template.md`. Loose filename/subdirectory match to declared value—ignoring case, spaces, dashes, underscores—means reference exists.
2. **Check the status inside the reference file** — Open match; find status. `🔲 Planned` in frontmatter note, status field, or top-level callout means **limited support** despite reference. Emit warning.
3. **Match exists AND not Planned** → fully supported; proceed.
4. **No match** → limited support; emit warning. Never substitute another supported feature.

| Category | Category Folder | Path Notes |
|----------|-----------------|------------|
| Project type | `references/project-types/` | Some types use subdirectories (e.g., `frontend-spa/frontend-spa.md`). Match against both filenames and subdirectory names. |
| Runtime | `references/runtimes/` | |
| Emulator | `references/emulators/` | |

> ⚠️ **Do NOT skip.** Verify every declared feature against category folder before artifact generation.

---

## Warning Format

```
⚠️ LIMITED SUPPORT: {Category} "{value}" is not yet fully supported.
```

Where:
- `{Category}` — short feature-area label (e.g., `Project type`, `Runtime`, `Emulator`)
- `{value}` — planned feature (e.g., `python`, `Container App`, `Cosmos DB`)

---

## ⛔ Emission Protocol — MANDATORY

On limited-support detection, follow exactly:

### Step 1: Emit in assistant message

Write canonical warning in **regular assistant message text**, visible in chat—not hidden in tool call.

```
⚠️ LIMITED SUPPORT: Emulator "Durable Task Scheduler" is not yet fully supported.
```

### Step 2: Confirm with user

For session's **first** limited-support feature, call `ask_user` to confirm:

```
ask_user(
  question: "⚠️ LIMITED SUPPORT: {Category} \"{value}\" is not yet fully supported. Would you still like me to put forth a best-effort attempt?",
  choices: [
    "Yes, proceed with best effort",
    "No, stop here"
  ]
)
```

Agreement gives session-wide consent. Still warn for later limited-support features, but do not call `ask_user` again.

> Emit `⚠️ LIMITED SUPPORT:` exactly once per `(Category, value)` pair in assistant messages.
---

## No Silent Substitution

**Never silently substitute supported alternatives** for limited support (e.g. Container App → Azure Functions, Python → Node.js). Always generate declared project type, runtime, and emulators.
