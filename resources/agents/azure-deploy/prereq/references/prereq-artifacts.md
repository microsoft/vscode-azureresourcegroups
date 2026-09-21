Prereq exit artifact procedures. Read at Step 4 of the [readiness gate](readiness-gate.md).

## Write Artifacts

> ⛔ **Write all 3 artifacts before prereq exit.** Downstream phases read them.
> ⛔ **Use `create` tool for ALL session files — NEVER `powershell`.** Terminal is OK ONLY for read-only ops: UUID generation, git info, file existence checks.
> ⛔ **Path scoping:** ALL `create` calls target `.copilot-azure/sessions/{uuid}/`. Read back after writing to confirm path.

1. **`prereq-output.json`** — ⛔ Read [`prereq-schemas.ts`](prereq-schemas.ts) for `PrereqOutput`.

   > ⛔ **Per-component verdicts MUST persist.** Every `components[]` entry MUST include `verdicts`: `{ "build", "completeness", "deployability" }`, values `PASS`/`WARN`/`FAIL` (`build` may be `SKIPPED` if build validation was skipped; `completeness`/`deployability` may never be `SKIPPED`). Downstream readiness scoring and prepare require these.
   >
   > ⛔ **Warnings MUST persist.** Every ⚠️ WARN → `warnings[]`: `{ "id": "W-{ID}", "component", "axis", "summary", "detail", "fix", "fixPhase" }`. `fix` and `fixPhase` are required; validate before writing.
   >
   > ⛔ **Health endpoint:** Write detected path to `healthEndpoint` (e.g., `"/api/v1/health/"`). If none → `null` + `W-HEALTH` warning with `fixPhase: "scaffold"`.
   >
   > ⛔ **Entry point:** Write to `entryPoint` (e.g., `"index.js"`). `null` for .NET/Go/Java (Oryx handles startup).
   >
   > ⛔ **`postDeployRecommendations[]`:** For every ⚠️ WARN, write the [`session-schemas.ts`](session-schemas.ts) `PostDeployRecommendation`: `{ "title", "reason", "effort": "low|medium|high", "services": [] }`.

2. **`context.json`** — ⛔ Use `edit`, not `create` (Step 1 created it). Fill `components[]`, `repo`, `detectedInfra[]`, `detectedServices[]`, `app.name` (primary component manifest or workspace root directory name). Append `"prereq"` to `completedPhases` NOW, before presenting; set `currentPhase: null`; update `lastModifiedUtc`.

3. **`readiness-report.md`** — Clean markdown: Build/Completeness/Deployability verdict summary table, detected stack, and all warnings with actionable details. No rigid template.

> ⛔ **Phase exit gate:** All 3 artifacts must exist. If any missing, write NOW.
