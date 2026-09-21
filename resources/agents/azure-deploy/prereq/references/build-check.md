# Build Check

> ⛔ **No build/install/test commands during this check.** Use static analysis only.

Detect language/framework stack and build health. Static manifest detection is **default**. Optional build execution requires user confirmation.

> **Dynamic detection:** Derive build commands from project manifest (e.g., `package.json` `scripts` for project-specific script). Table is guidance, not fixed lookup.

## Step 1: Detect Stack

Scan workspace project files to identify stack.

| File | Language/Framework |
|------|-------------------|
| `package.json` | Node.js |
| `package.json` + `tsconfig.json` | TypeScript |
| `requirements.txt` / `pyproject.toml` | Python |
| `*.csproj` / `*.sln` | .NET |
| `pom.xml` | Java (Maven) |
| `build.gradle` / `build.gradle.kts` | Java/Kotlin (Gradle) |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `Gemfile` | Ruby |
| `composer.json` | PHP |
| `docker-compose.yml` / `compose.yml` | (dependency source — parsed during deployability check) |
| `build.gradle` + `com.google.cloud.tools.jib` | Java (Jib) |

**Modern package manager lockfiles:** `uv.lock` → uv, `bun.lock` / `bun.lockb` → bun.

> ⚠️ If **no project file** is found, check for a `Dockerfile`. If a Dockerfile exists, note container-dependent build in findings.

### Multi-Project Detection

Search recursively for manifests; skip `node_modules`/`.git`/`dist`/`build`/`vendor`/`.venv`/`__pycache__`/`.terraform`/`bin`/`obj`. Each directory containing a project file = one component.

## Step 2: Static Detection (Default)

Infer build health from manifests **without commands**.

**Check:** missing dependencies (imports absent from manifest), version conflicts, obvious misconfigurations (missing `main`/`start` script), lockfile presence.

> **Package manager detection:** `package-lock.json` → npm, `yarn.lock` → yarn, `pnpm-lock.yaml` → pnpm. Default to npm if no lockfile.

### Import → Manifest Cross-Check

Find source imports absent from dependency manifest, catching existing Azure build failures.

**Node.js/TypeScript:** Scan `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.mjs` for `import` / `require`. Extract package name (first path segment; `@scope/name` for scoped). Check `dependencies` + `devDependencies`; skip Node.js built-ins and relative paths.

**Python:** Scan `*.py` for `import {pkg}` / `from {pkg} import`; compare with `requirements.txt` / `pyproject.toml`; skip stdlib.

| File location | Severity |
|---|---|
| Build-time config (`next.config.*`, `webpack.config.*`, `vite.config.*`, `babel.config.*`, `postcss.config.*`, `tailwind.config.*`) | ❌ FAIL — build crashes at config load |
| Entry point / source — **package absent from manifest** | ❌ FAIL — `MODULE_NOT_FOUND` at runtime |
| Entry point / source — **version mismatch** | 🔧 Recommended Fix |
| Test files only | ⚠️ WARN |

**Scope:** Scan ALL config files. In `src/`/`app/`/`pages/`/`lib/`, limit to 20 source files per component. Never scan `node_modules/`, `.venv/`, `dist/`, `build/`.

**On ❌ FAIL or 🔧 Fix:** Add to batch-then-approve: "Add `{package}` to `package.json` dependencies."

| Outcome | Verdict |
|---------|---------|
| No issues found | ✅ PASS |
| Warnings in manifest | ⚠️ WARN |
| Obvious errors | ❌ FAIL |
| No build system detected | ⚠️ WARN |
| Only Dockerfile found | ⚠️ WARN |

**Dependency vintage check:** ALL pinned deps 5+ years old AND ecosystem has known breaking changes (e.g., `werkzeug.contrib.*` removed, `flask.ext.*` removed, `itsdangerous<1.0` API changed) → ❌ FAIL. Grep removed-module imports.

**Transitive dependency check (post-migration):** After 🔶 Major Migration dependency upgrades, run install **through build-validation gate (Step 3) — migration intent does NOT authorize install; user must first answer that per-command consent prompt** to catch transitive deps. Also run entry-point import for import-time validation errors (e.g., WTForms `Email()` requires `email-validator`).

**SKU sizing signal:** Check `f1Viable` per [dependency-compatibility.md § SKU Sizing Signals](dependency-compatibility.md). F1 is never selected (floor is B1); a vintage ❌ FAIL requiring 🔶 Major Migration (>5 files) sets `f1Viable: false` as a signal to size **up** from B1.

## Step 3: Build Execution (Optional — User-Confirmed)

⛔ **Build-validation gate.** Before ANY install/build/test command, ask via `ask_user`: "I'd like to run `{command}` to verify the build. Run it? (Yes / Skip)". General prior consent (e.g., "fix my issues", "yes", "go ahead", "fix them") does NOT authorize this; user must answer THIS specific question naming exact command. Skip → static-only verdicts.

Derive actual build script from manifest. Install deps first. Capture output. Timeout 5 min.

| Outcome | Verdict |
|---------|---------|
| Exit code 0 | ✅ PASS |
| Succeeds with warnings | ⚠️ WARN |
| Exit code ≠ 0 | ❌ FAIL |
| Timeout >5 min | ⚠️ WARN |

## Native Module Detection

Use [dependency-compatibility.md § Native Module Detection](dependency-compatibility.md) canonical procedure, edge cases, and package table. Write results to `buildRequirements.hasNativeModules`.

> ⛔ **Prebuild-install exception:** Lockfile packages with `prebuild-install` but no `node-gyp` use prebuilt binaries → `hasNativeModules: false`. Examples: `better-sqlite3` v12+ = prebuilt, `sharp` v0.33+ = prebuilt, `bcrypt` = always native, `canvas` = always native. Check lockfile, never package name alone.
