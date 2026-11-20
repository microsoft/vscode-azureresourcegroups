# Node 22 + Azure Functions sandbox fixture

This fixture proves the supported Copilot on Rails sandbox topology for a React/Vite frontend and a
TypeScript Azure Functions API with Azurite and PostgreSQL as separate Compose services.

## Host-workspace F5 (primary)

1. Use **File > Open Folder...** to open this fixture directory as the normal VS Code workspace:
   `evals/local-dev/fixtures/node-functions-sandbox`. The Explorer should show `compose.yaml`,
   `Dockerfile`, and `package.json` at its top level.
2. Confirm Docker Desktop is running and ports 5173, 7071, 9229, 10000-10002, and 5432 are free.
3. Press **F5** and choose **Sandbox: F5**.

The F5 bootstrap task runs `docker compose up --build --wait dev` before any application task. The
`dev` entrypoint runs
`npm ci` against the checked-in lockfile inside the container, and the named `node_modules` volume
keeps those Linux dependencies separate from the host bind mount. The service becomes healthy only
after installation succeeds. A one-shot `dev-volume-init` service first assigns a newly created
dependency volume to the non-root `node` user, avoiding platform-specific root ownership on a clean
first run. The long-running `dev` service and dependency installation still run as `node`.

VS Code remains attached to the host workspace. Its tasks run the API and frontend inside `dev`
through `docker compose exec`, attach the built-in Node debugger to the published inspector port,
and launch the frontend through the forwarded host URL. TypeScript source maps use
`localRoot`/`remoteRoot` to map host files to their container paths. Stopping the debug session runs
the Compose teardown task. Dev Containers are not used.

If F5 reports a port allocation failure, use `docker compose ps -a` and
`docker ps --filter publish=<port>` to identify the conflicting stack. Stop that stack and press F5
again. The fixed F5 configuration intentionally keeps one known port set so launch URLs and debugger
attachment stay deterministic.

The host requires only VS Code, Docker with Compose, a Chromium-based browser, and the recommended
project debugging extensions. The pinned Microsoft JavaScript/Node base supplies Node.js, npm, pnpm,
Yarn, Git, certificates, build tools, and common developer utilities. The thin CoR layer adds Azure
CLI, Azure Functions Core Tools, DNS/netcat diagnostics, and the PostgreSQL client. All are invoked
through Compose tasks.

## Manual equivalent

The default host mappings can be overridden for manual testing without changing container-side
service discovery:

```sh
export FRONTEND_PORT=15173 FUNCTIONS_PORT=17071 NODE_INSPECTOR_PORT=19229
export AZURITE_BLOB_PORT=11000 AZURITE_QUEUE_PORT=11001 AZURITE_TABLE_PORT=11002
export POSTGRES_PORT=15432
npm run sandbox:reset
npm run sandbox:up
```

Keep those exports in the terminal used for later Compose commands. The frontend and health endpoint
are then available on ports 15173 and 17071. If startup does not complete, run
`docker compose ps -a` and `docker compose logs dev azurite postgres`; `docker compose exec` cannot
work until `dev` is running.

Start these commands in separate terminals:

```sh
docker compose exec dev npm run dev:api
```

```sh
docker compose exec dev npm run dev:web
```

The manual API command performs a clean TypeScript build, then keeps the compiler watcher running
alongside Functions Core Tools, so it works immediately after a clean sandbox startup and continues
to rebuild edits without a separate command. The health endpoint performs authenticated checks
against Azurite over the Compose network and PostgreSQL; a successful response reports both services
as `ready`.

## Bounded validation

```sh
bash scripts/validate-sandbox.sh
```

The validation builds the image, waits for all services, verifies the pinned toolchain, runs the
exact documented manual API and frontend commands before any separate build step, checks Functions
discovery and authenticated Azurite/PostgreSQL health, verifies the host F5 task/launch contract,
published inspector endpoint, emitted source maps, and host/container path mapping, type-checks and
builds both workspaces, probes ports 7071 and 5173, then removes its containers and volumes. It
always deletes the validation project's volumes before startup and asserts that the fresh dependency
volume is owned by and writable to the non-root runtime user. It does not publish the image.
