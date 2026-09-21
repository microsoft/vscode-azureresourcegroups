# Deploy Strategy

Choose Azure code deployment from prereq scan. Prepare writes `deployStrategy` to `prepare-plan.json`; scaffold encodes Bicep; deploy executes.

## Deployment Patterns

Select one of three patterns from `prereq-output.json.components[].buildRequirements`:

> ⛔ **Dockerfile ≠ Container Apps.** A Dockerfile serving only static files (nginx, httpd, `COPY . /usr/share/nginx/html`) is NOT backend. Route it as static site per `service-mapping.md § Static Dockerfile sites`, not Pattern C.

| Pattern | When | `deployStrategy` needed? |
|---------|------|--------------------------|
| **A: Oryx auto-build** | No native modules or Dockerfile | Yes—startup command + app settings enter Bicep during scaffold |
| **B: Startup-install** | Native modules (`hasNativeModules: true`) | Yes—startup command + fallback install + app settings in Bicep |
| **C: Container-only** | Dockerfile runs server process (Express, Flask, uvicorn, etc.) | No—route to Container Apps; Dockerfile IS strategy |

**Additional routing:**

| Condition | Action |
|-----------|--------|
| Jib plugin (Java + `com.google.cloud.tools.jib`) | Container-only via Jib push to ACR; no Dockerfile |

---

## Pattern A: Oryx Auto-Build (Default)

**Languages:** Node.js, Python, .NET, Go, Java, PHP, Ruby

Oryx detects stack, installs dependencies, and builds during zip deploy.

**Still write `deployStrategy` to `prepare-plan.json`**. Despite auto-detection, startup command and app settings MUST enter Bicep at scaffold, not deploy; no imperative deploy CLI.

```json
"deployStrategy": {
  "codeDeployPattern": "oryx-auto",
  "requiredAppSettings": {
    "SCM_DO_BUILD_DURING_DEPLOYMENT": "true",
    "ENABLE_ORYX_BUILD": "true",
    "ORYX_DISABLE_COMPRESSION": "true"
  },
  "reason": "Standard Oryx build — no native modules, no Dockerfile. Compression disabled to avoid startup extraction delays. No custom appCommandLine — Oryx launcher handles decompression + start."
}
```

 Read app start file from `prereq-output.json.entryPoint`; do NOT re-read manifests. Build startup command from `package.json` `start` script (Node.js) or framework convention (Python gunicorn, .NET/Go/Java Oryx-native).

> ⛔ **Do NOT set custom `appCommandLine` for Pattern A.** Let Oryx use `package.json` `start` or framework defaults. Custom `appCommandLine` (`cd /home/site/wwwroot && node {entryPoint}`) replaces its launcher, bypassing `node_modules.tar.gz` decompression and causing `MODULE_NOT_FOUND`. Only set `appCommandLine` when `initCommands[]` contains `required: true` migrations.
>
> ⛔ **TypeScript projects:** Keep `typescript` + `@types/*` in `dependencies`, not `devDependencies`; Oryx production skips devDeps, causing `tsc` failure.
>
> ⛔ **When `initCommands[]` has `required: true` entries:** Set `startupCommand` to prepend migrations: `"cd /home/site/wwwroot && {initCommand} && {framework-default-start}"`. Idempotent migrations are cold-start safe. Otherwise omit `startupCommand`; let Oryx handle it.

Scaffold maps `startupCommand` → Bicep `appCommandLine` and `requiredAppSettings` → Bicep `siteConfig.appSettings`. Deploy only waits → zips → health-checks.

---

## Pattern B: Startup-Install (Native Modules)

Native modules may fail Oryx compilation. Startup-install provides two layers.

### Two-Layer Strategy

1. **Primary — Oryx zip build:** `SCM_DO_BUILD_DURING_DEPLOYMENT=true` + `ENABLE_ORYX_BUILD=true` installs dependencies during Kudu zip deploy. App Service Linux Kudu has `gcc`, `make`, and build tools, enabling native compilation.

2. **Fallback — startup-install command:** `appCommandLine` installs dependencies on first boot IF dependency directory is absent. Guard skips later runs because `/home` persists.

Set both in Bicep during scaffold. Startup command is fallback, not primary.

> **Why two layers?** `az webapp deploy --type zip` uses OneDeploy, which may skip Oryx despite `SCM_DO_BUILD_DURING_DEPLOYMENT=true`. Startup catches this; guard skips install after successful Oryx build.

### Deploy Strategy Schema

Write `prepare-plan.json.deployStrategy`:

```json
"deployStrategy": {
  "codeDeployPattern": "startup-install",
  "startupCommand": "cd /home/site/wwwroot && if [ ! -d node_modules ]; then npm install --production; fi && node index.js",
  "requiredAppSettings": {
    "WEBSITES_CONTAINER_START_TIME_LIMIT": "1800",
    "SCM_DO_BUILD_DURING_DEPLOYMENT": "true",
    "ENABLE_ORYX_BUILD": "true",
    "ORYX_DISABLE_COMPRESSION": "true"
  },
  "reason": "Native module (better-sqlite3 via node-gyp) requires server-side npm install."
}
```

Replace `startupCommand` and `reason` with language-specific entry-point values below.

### Entry Point & Startup Commands

Same as Pattern A; Node.js prepends dependency guard `if [ ! -d node_modules ]; then npm install --production; fi`.

> ⛔ **Inline commands only.** Never generate `.sh` startup script; CRLF causes `bash` exit code 2.
> ⛔ **Python: do NOT use `venv` in startup commands.**

### SKU Implications

Compute floor: **B1 (Basic, ~$13/mo)**. Never select F1/D1/Free: managed identity is mandatory; free-tier MI sidecar OOMs. If native modules, TypeScript build, large deps, or WSGI/ASGI server need more resources, size up from B1 (B2/S1) and show at approval gate: "⚠️ {reason}. {sku} required." Never size below B1.

### Container Timeout

`WEBSITES_CONTAINER_START_TIME_LIMIT` controls Azure container response wait.

| Value | Use case |
|-------|----------|
| 230 (default) | Standard apps; no native compilation |
| 1800 (max) | Startup-install; native compilation takes 2-5 min, longer with Python scipy/scikit-learn |

Set `1800` whenever `codeDeployPattern == "startup-install"`.

---

## Pattern C: Container-Only

For Dockerfile backend logic, route to **Container Apps**. Dockerfile IS strategy; omit `deployStrategy` from `prepare-plan.json`.

Deploy handles ACR build → image push → Bicep redeploy with real image. See [code-deployment-container-apps.md](../../deploy/references/code-deployment-container-apps.md).

For Java Jib (`build.gradle` + `com.google.cloud.tools.jib`), build container image without Dockerfile; push to ACR via `jib` task.
