# Zero-Code Path

For an empty workspace (no project files, no Dockerfile), prereq scaffolds a starter project before evaluation.

## Step 0: Check Existing Context

⛔ **Before asking, check `context.json.intent.userPrompt`.** The orchestrator (or direct-entry original message) captured user intent. If `userPrompt` describes an app (e.g., "build me a todo app", "REST API with auth", "a notes app with three tabs"), use it as the answer to "what are you building?" and skip to Step 2 (recommend stack). Ask Step 1 only when `userPrompt` is vague ("help me get started", "deploy to Azure") or empty.

## Flow

1. **Ask what they want to build** (skip if Step 0 resolved it): *"What kind of app are you building?"* (e.g., "a todo app", "REST API"). Users know desired app, not stack.
2. **Recommend a stack** from the app description (`userPrompt` or Step 1): *"For a REST API with a database, I'd suggest Node.js with a framework like Express or Fastify. Sound good?"* User may accept or override.
3. ⛔ **Confirm before scaffolding** via `ask_user`.
4. **Scaffold minimal starter project** — ⛔ **Read [subagent-starter-scaffold.md](subagent-starter-scaffold.md).** NEXT action MUST be a `task` call containing FULL template text (verbatim) + app description + chosen stack + workspace path + data needs flag + multi-page flag. Do NOT generate code inline; sub-agent applies starter patterns and writes workspace files. Verify returned file list is non-empty, then proceed to Step 5.
5. **Validate generated code** — ⛔ **When agent WRITES code from scratch, offer build validation before evaluation.** Generated code is untested. Present: **"I've scaffolded your app. Want me to install dependencies, build, and run tests? (Yes / Skip)"** ⛔ **General prior consent** (e.g., "yes", "go ahead", "fix it") **does NOT authorize this**; user must answer THIS specific question. Skip → run nothing.
   - If **Yes**: run `npm install` → `npm run build` → `npm test` (or stack equivalent). If any step fails, fix the issue and retry (max 2 attempts). This is allowed because the agent WROTE the code — it's not an existing repo.
   - If **Skip**: proceed to Step 6. The deploy phase will handle builds via Oryx/ACR.
   - ⛔ **This gate applies ONLY to agent-generated code.** Existing repos follow deploy-as-is with ABSOLUTE PROHIBITION on `npm install` during prereq.
6. Run the full 3-axis evaluation (from prereq Step 3) on the scaffolded code.
7. Continue to prereq Step 4 (write artifacts + readiness gate).

## Rules

- Max 3 interactions before scaffolding (count from Step 1; Step 0's `userPrompt` check does not count).
- Scaffold dynamically from app description; no hardcoded templates. Follow stack conventions (e.g., `npm init` patterns for Node, `dotnet new webapi` patterns for .NET).
- If user gives no app description after 2 attempts AND `userPrompt` was also vague: *"I can't evaluate an empty workspace without knowing what you want to build. Try: 'I want to build a REST API' or 'Help me scaffold a Node.js API.'"*
- ⛔ **Do NOT generate Azure infrastructure (Bicep/Terraform/azure.yaml) here.** This path creates application source code only. Infrastructure is the scaffold phase's job.
- Generated code must start locally (e.g., `node index.js` serves HTTP on a port), enabling real prereq evaluation.
