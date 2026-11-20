# Generic Runtime Sandbox

Use this contract when the approved Local Development plan selects `Sandbox` but no certified
runtime-specific Sandbox image exists. Prefer a runtime-specific contract when one is available.

## Image Contract

Build locally; never publish or require a registry-hosted project image.

Use Microsoft's multi-platform Bookworm development base pinned to this immutable OCI index:

`mcr.microsoft.com/devcontainers/base:bookworm@sha256:99f5250dd2d5f8b11046d5662dd94c1e3c1dae56b560c7caad5ceb7edf349046`

The index contains linux/amd64 and linux/arm64 manifests. Reuse its non-root `vscode` user, Git, CA
certificates, build tools, curl, and common developer utilities.

The generated Dockerfile must install the exact runtime/version recorded by the approved plan. Use the
runtime vendor's documented, checksummed package or archive source. Pin every package repository key,
repository suite, package version, and downloaded archive checksum. Never select a runtime from the host
installation, use a floating `latest` channel, or silently change the project's declared version.

Install Azure CLI and Azure Functions Core Tools only when the project requires them. Record the installed
runtime, package manager, Azure tools, and their exact versions under `CoR-Added Tools`. Keep application
dependencies project-owned and install them from committed lockfiles during the first-run lifecycle.

## Runtime-Specific Preference

Python 3.12 projects should prefer the pinned Microsoft image:

`mcr.microsoft.com/devcontainers/python:3.12-bookworm@sha256:5ff1ba19e3b9273b24ec101055172d0e75046bc9ec40780643c530d2df2c75e5`

Use its non-root `vscode` user and base-provided Python/pip tooling. Other Python versions use the generic
base and an exact, checksummed runtime installation until a certified image entry is added.

Node 22/24 Azure Functions projects continue to use
[`node-functions-sandbox.md`](node-functions-sandbox.md), not this generic fallback.

## Compose, Lifecycle, and F5

Follow the same host-workspace model as the Node Sandbox:

- `dev` builds locally, bind-mounts the workspace, and runs as the image's non-root user.
- Runtime dependency/cache directories use named volumes where a host bind mount would hide container
  dependencies.
- Emulators remain separate Compose services with health checks.
- The single first-run path is `docker compose up --build --wait dev`; the `dev` entrypoint installs locked
  project dependencies before becoming healthy.
- VS Code tasks invoke runtime commands through `docker compose exec -T dev ...`.
- Generate runtime-appropriate attach/launch configurations and source/path mappings.
- Do not generate `.devcontainer` or require the Dev Containers extension.

## Validation

Validate a clean-volume startup, non-root dependency installation, exact runtime/tool versions, emulator
health, application ports, debugger attachment, project build/type-check/tests, and deterministic teardown.
