# Dockerfile Generation

Generate Dockerfiles for Container Apps or B1+ App Service components lacking one. Read when `iac-generation-rules.md` Step 6b applies.

## When to Generate

- Component targets Container Apps and has NO Dockerfile (and no `Dockerfile.azure`)
- Component targets App Service B1+ with `deployStrategy.containerized: true`
- ⛔ Do NOT generate for F1/D1 SKUs — use platform runtime stack instead
- ⛔ Do NOT overwrite an existing Dockerfile — create `Dockerfile.azure` only if BuildKit stripping is needed

## Principles

### Layer ordering

Copy dependency manifests and install BEFORE source to preserve layer cache:

```
COPY {manifest files} ./
RUN {install command}
COPY . .
```

### Base image selection

| Principle | Rule |
|-----------|------|
| Pin version | `node:{major}-slim`, NOT `node:latest` |
| Slim variants | `-slim` or `-alpine` for smaller images |
| Multi-stage | Go, .NET, Java, Rust: build in SDK image, copy binary to runtime |
| Match runtime | Read `engines`, `python_requires`, `go.mod`, `<TargetFramework>` |

### Port alignment

`EXPOSE`, app listening port, and Container App `targetPort` must match. Mismatch silently fails health probe. Read app config, set `EXPOSE {port}`, add `ENV PORT={port}` if app reads `PORT`.

### Security defaults

- Non-root user — Debian/`-slim` base: `RUN groupadd -r app && useradd -r -g app app`; Alpine base: `RUN addgroup -S app && adduser -S app -G app`. Then `USER app`
- Never `COPY .env` or secrets — use `.dockerignore`
- Direct exec: `CMD ["node", "server.js"]` not `CMD ["npm", "start"]`

### .dockerignore

Always generate beside Dockerfile. Exclude: `.git`, `node_modules`, `__pycache__`, `*.pyc`, `.env`, `.env.*`, `.azure`, `.copilot-azure`, `infra`, `*.md`.

### Common pitfalls

| Mistake | Fix |
|---------|-----|
| `COPY . .` before deps | Copy manifests first, install, then source |
| `npm install` in prod | `npm ci --omit=dev` |
| Wrong EXPOSE port | Read actual listening port from app source |

### Next.js multi-container build args

`NEXT_PUBLIC_*` vars enter client JS bundle at `npm run build`; runtime Container App vars cannot affect client code. For multi-container Next.js frontends calling another component API:

1. Dockerfile MUST include `ARG NEXT_PUBLIC_API_URL` before the `RUN npm run build` step
2. Deploy phase passes `--build-arg NEXT_PUBLIC_API_URL=https://{api-fqdn}` to `az acr build`

Detect `.env*` files containing `NEXT_PUBLIC_*` targeting another service (e.g., `NEXT_PUBLIC_API_URL=http://localhost:3001`).

### ACR Build Compatibility — `Dockerfile.azure` Generation

⛔ ACR `az acr build` uses **classic Docker builder, NOT BuildKit**. Do NOT assume BuildKit support.

**Generate `Dockerfile.azure` when:** `buildRequirements.hasBuildKitSyntax == true` OR existing Dockerfile contains BuildKit-only syntax. Create `{component}/Dockerfile.azure` without any BuildKit syntax.

**Strip all BuildKit-only syntax:** `# syntax=` directives, `RUN --mount=...` (cache, secret, bind, tmpfs), `RUN --network=...`, `RUN --security=...`, `COPY --link`, `COPY --chmod=...`, heredoc (`RUN <<EOF`).

⛔ **Also pin package manager.** When stripping BuildKit, replace `npm install -g {pm}@latest` with exact project `packageManager` version from `package.json` (e.g., `pnpm@9.4.0`). Upstream `@latest` may conflict with base image Node.js version.

⛔ For multi-line continuations (`\`), remove BuildKit flag but preserve command across all lines. Never leave bare `RUN`.
