# Node 22/24 + Azure Functions Sandbox

Generate this environment only when the approved plan's Development Environment mode is `Sandbox`.
The checked-in proof of concept is
`evals/local-dev/fixtures/node-functions-sandbox`; keep generated behavior aligned with it.

## Image Contract

Build locally; never publish or require a registry-hosted project image.

| Node major | Base image | Base Node.js | Base npm | Base pnpm | Base Yarn |
|------------|------------|--------------|----------|-----------|-----------|
| 22 | `mcr.microsoft.com/devcontainers/javascript-node:22-bookworm@sha256:33cc368bc8ce9dac872703c7b9ebf6dabcc7b14bbb8cfd2b64be0e7232e3a361` | `22.23.4` | `10.9.9` | `12.16.1` | `1.22.22` |
| 24 | `mcr.microsoft.com/devcontainers/javascript-node:24-bookworm@sha256:1bc82e3350b0da52ca1a1b1b2e7527300bc6fdfd778287e0eed564203d66a68c` | `24.22.1` | `11.19.1` | `12.16.1` | `1.22.22` |

| CoR-added component | Pinned value |
|---------------------|--------------|
| Azure CLI | `2.91.0-1~bookworm` from `packages.microsoft.com` |
| Azure Functions Core Tools | npm package `azure-functions-core-tools@4.16.0` |
| User | non-root `node` |

Use the image whose Node major exactly matches every generated application service in the approved plan.
Do not use the host's Node version to select an image and do not run a Node 24 project on the Node 22 image
or vice versa. Node 22 and Node 24 Azure Functions projects must use programming model v4. Route Node 20,
mixed-major, ambiguous-version, and older programming-model projects to Host.

Treat the Microsoft image as a normal Docker/Compose base image; do not generate `.devcontainer` or
require the Dev Containers extension. Reuse its non-root `node` user and included Node.js, npm, pnpm,
Yarn, Git, CA certificates, `build-essential`, curl, `iproute2`, jq, process diagnostics, SSH client,
unzip, and other common developer tooling. The CoR layer installs only the pinned Azure CLI, pinned
Azure Functions Core Tools, DNS diagnostics, netcat, and PostgreSQL client needed by this workflow.
Keep the Microsoft apt key in `/etc/apt/keyrings` and pin the Azure CLI package version. The base
image digests are multi-platform OCI indexes with linux/amd64 and linux/arm64 manifests. TypeScript,
`ts-node`, and `tsx` remain project dependencies installed from the committed lockfile.

Generate the Dockerfile from this base/layer contract, replacing the `FROM` line with the exact selected
matrix entry:

```dockerfile
FROM mcr.microsoft.com/devcontainers/javascript-node:22-bookworm@sha256:33cc368bc8ce9dac872703c7b9ebf6dabcc7b14bbb8cfd2b64be0e7232e3a361

ARG AZURE_CLI_VERSION=2.91.0-1~bookworm
ARG FUNCTIONS_CORE_TOOLS_VERSION=4.16.0

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        dnsutils \
        netcat-openbsd \
        postgresql-client \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
        | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg \
    && chmod go+r /etc/apt/keyrings/microsoft.gpg \
    && printf '%s\n' \
        'Types: deb' \
        'URIs: https://packages.microsoft.com/repos/azure-cli/' \
        'Suites: bookworm' \
        'Components: main' \
        'Architectures: amd64 arm64' \
        'Signed-By: /etc/apt/keyrings/microsoft.gpg' \
        > /etc/apt/sources.list.d/azure-cli.sources \
    && apt-get update \
    && apt-get install --yes --no-install-recommends "azure-cli=${AZURE_CLI_VERSION}" \
    && npm install --global \
        "azure-functions-core-tools@${FUNCTIONS_CORE_TOOLS_VERSION}" \
        --unsafe-perm true \
    && rm -rf /var/lib/apt/lists/*

USER node
```

Add the workspace directory, entrypoint copy, executable bit, and ownership setup around this layer as
described below. Do not reinstall pnpm, Yarn, Git, build tools, or other utilities already supplied by
the pinned Microsoft base.

## Compose Topology

- `dev` builds the local Dockerfile and bind-mounts the workspace.
- Mount a named volume at the workspace's root `node_modules` path so host dependencies never hide
  or replace Linux container dependencies.
- Before `dev` starts, run a one-shot root-only Compose service that assigns the dependency volume
  to the image's non-root runtime user. Keep `dev`, the locked dependency install, and application
  processes running as that non-root user. Do not rely on a container engine preserving ownership
  from the image when it initializes a fresh named volume.
- Azurite and PostgreSQL are separate services with health checks and named data volumes.
- `dev` depends on healthy emulators and publishes the planned frontend, Functions HTTP, and Node
  inspector ports.
- Use Compose service hostnames (`azurite`, `postgres`) in container-side connection strings.

## First-Run Lifecycle

The F5 bootstrap task and documented manual path use this startup primitive:

```sh
docker compose up --build --wait dev
```

The `dev` entrypoint must:

1. fail if the selected package manager's lockfile is missing;
2. install locked dependencies inside the running container (`npm ci`, `pnpm install --frozen-lockfile`,
   or `yarn install --frozen-lockfile`);
3. signal container health only after installation succeeds; and
4. then run the long-lived command.

Never document `docker compose exec dev ...` as the first command. It fails when `dev` is not running.
Never mount an empty dependency volume without installing into it; that hides host `node_modules` and
causes tools such as `tsc` to be missing.

After `dev` is healthy, a documented manual TypeScript Functions command must compile the service
before starting Core Tools, or run the compiler watcher alongside Core Tools. It must discover
functions on a clean workspace without requiring an undocumented prior build.

Use the Azurite image's well-known development account key and explicit service endpoints such as
`http://azurite:10000/devstoreaccount1`. `UseDevelopmentStorage=true` and localhost endpoints target
the `dev` container itself and do not reach a sibling Azurite service.

## Host-Workspace F5

Do not generate or require `.devcontainer`, `ms-vscode-remote.remote-containers`, or workspace reopen.
VS Code remains attached to the host workspace.

Generate shell tasks that use the exact **Compose Command** recorded in the plan:

1. a foreground bootstrap task runs `{compose command} up --build --wait dev`;
2. each application background task depends on bootstrap and runs its build/watch/start command with
   `{compose command} exec -T dev ...`;
3. a teardown task runs `{compose command} down --remove-orphans`.

Containerized Node.js, package managers, Azure CLI, and Functions Core Tools must only be invoked
through those Compose tasks; never require them on the host. Functions Core Tools 4.14 and later bind
to loopback by default, so Sandbox Functions startup must add `--address 0.0.0.0`; otherwise the
published HTTP port resets connections from the host.

For Node TypeScript Functions debugging:

- publish the Node inspector port from `dev`;
- pass `languageWorkers__node__arguments=--inspect=0.0.0.0:9229` (or the planned internal port) to
  the Functions process;
- generate a standard `node` attach configuration targeting the published host port;
- set `sourceMaps: true`, host `localRoot`, container `remoteRoot`, and host `outFiles` so breakpoints
  bind to workspace TypeScript files;
- use a browser launch configuration with the forwarded host URL and host `webRoot`;
- generate a compound configuration for the supported API + frontend project; and
- connect teardown to debug shutdown, or provide an equally deterministic stop task.

## Validation

Before marking the plan Implemented:

1. Run `docker compose config`.
2. Delete the validation Compose project's named volumes so validation exercises a genuinely clean
   dependency volume.
3. Run the single first-start command and wait for healthy `dev`.
4. Verify the dependency volume is owned by and writable to the non-root runtime user.
5. Verify Node, the selected package managers, Azure CLI, Functions Core Tools, and Git inside `dev`.
6. Run the exact documented manual application commands before any separate build step.
7. Verify Functions discovery and perform authenticated health checks against Azurite and every
   supporting database.
8. Verify the published Node inspector endpoint and assert that launch configuration source mapping
   matches the host workspace and container workspace roots.
9. Run the workspace type-check/build inside `dev`.
10. Probe every forwarded application HTTP port.
11. Tear down every process and run Compose down, following the approved preserve/delete-data behavior.
