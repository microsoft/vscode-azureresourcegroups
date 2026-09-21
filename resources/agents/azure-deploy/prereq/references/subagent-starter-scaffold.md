# Subagent Template — Starter App Scaffold (Zero-Code Path Step 4)

Generate a minimal Azure-compatible starter project from user requirements.

## Critical Rules

- ⛔ **Do NOT invoke or hand off to other agents** — no external agent calls. You only generate code.
- ⛔ **Do NOT generate Azure infrastructure** (Bicep, Terraform, `azure.yaml`). Create application source only; prepare/scaffold handles infrastructure.
- ⛔ **Do NOT install dependencies** — no `npm install`, `pip install`, or any package manager commands. The main agent handles the build-validation gate after you return.

## Input (provided by caller)

| Field | Source | Required |
|-------|--------|----------|
| App description | User's answer to "What kind of app?" or `context.json.intent.userPrompt` | YES |
| Chosen stack | Stack the user accepted or overrode (e.g., "Node.js/Express", "Python/FastAPI") | YES |
| Workspace root | Absolute path to write files | YES |
| Data needs | `true` if user described database/storage needs ("with a database", "stores tasks") | YES |
| Multi-page | `true` if user described multiple views/pages ("three tabs", "dashboard + settings") | YES |

## Workflow

### Step 1 — Apply starter patterns

Generate health endpoints, follow stack conventions, avoid common mistakes:

**Health endpoints (MANDATORY):**
- `/healthz` — liveness: `200 { status: "ok" }`. Return 2xx directly (no redirects); allow anonymous access.
- `/readyz` — readiness: check DB/cache/deps. `200` when ready, `503` when not.
- Container Apps: `httpGet.port` must match `targetPort` in ingress config.

**Stack conventions:**
- **Node.js/Express:** Listen on `process.env.PORT || 3000`. `"start"` script required. `"engines": { "node": ">=20" }`. Production deps in `dependencies`.
- **Python (Flask/FastAPI):** Production: `gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app`. Include `gunicorn` in `requirements.txt`. Bind `0.0.0.0`, not `127.0.0.1`.
- **Next.js/React:** Static export: `output: 'export'`. Hybrid SSR works on SWA.

**Project structure:** app code (routes, entry, server) in `src/`. Include `.env.sample`, `.gitignore`, `package.json`/`requirements.txt`, `README.md`.

**Common mistakes to avoid:** hardcoded port, dev server in production, no health endpoint, missing `start` script, secrets in source, no CORS middleware, missing `engines.node`, Python missing `gunicorn`, Python using `passlib` (unmaintained, breaks on Python 3.12+ with bcrypt 5.x — use `bcrypt>=4.0` directly).

### Step 2 — Generate files

Scaffold a minimal starter project with:
- Entry point containing working HTTP server, `/healthz` (liveness), and `/readyz` (readiness)
- Package manifest (`package.json`, `requirements.txt`, `*.csproj`, `go.mod`) with minimal production dependencies
- `.env.sample` listing required environment variables (at minimum: `PORT`)
- `.gitignore` appropriate for the stack
- README.md with project name, one-line description, and local run instructions
- If data needs is `true`: add placeholder data model/schema and in-memory or file-based data layer (NOT a cloud database client; scaffold phase handles that)
- If multi-page is `true`: scaffold route stubs or page components

### Step 3 — Return file list

Return written workspace files for main-agent verification and build validation.

## Output

| Artifact | Location |
|----------|----------|
| Application source files | Workspace root (conventional layout per Step 1 patterns) |
| File list | Return to caller — array of relative paths written |

## Rules

- Scaffold dynamically from app description; no hardcoded templates. Follow stack conventions (e.g., `npm init` patterns for Node, `dotnet new webapi` patterns for .NET).
- Code must start locally (e.g., `node src/server.js` serves HTTP on a port) for real 3-axis evaluation.
- Follow Step 1 project structure and common-mistake guidance exactly.
