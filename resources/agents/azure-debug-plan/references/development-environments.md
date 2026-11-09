# Development Environment Selection

Choose whether application runtimes and development CLIs run in a **Sandbox** or directly on the
**Host**. Emulators remain separate Compose services in both modes.

The submitted requirements and approved project plan are authoritative:

- `Development Environment: Sandbox` means generate a Sandbox for every container-compatible application
  runtime. Prefer a certified runtime-specific Microsoft development image; otherwise use the pinned
  generic Microsoft development base and install the exact declared runtime in the local Dockerfile.
- `Development Environment: Regular` means use Host mode.
- Never infer Azure account or subscription state during local planning. The requirements controller
  already verified availability before it persisted Sandbox. Account, tenant, and subscription IDs must
  never appear in the plan.

## Optimized Node 22/24 + Azure Functions Sandbox

Use the optimized Node Sandbox when all of these conditions hold:

1. Every generated application service resolves to the same supported Node.js major: 22 or 24.
2. At least one generated service is a Node TypeScript or JavaScript Azure Functions programming
   model v4 project.
3. Other generated services are supported Node services, including React/Vite frontend SPAs.
4. Every planned emulator has a Compose-based implementation. Azurite and PostgreSQL are supported.
5. The workspace does not already contain a conflicting Compose `dev` service that would require
   replacement rather than a non-destructive merge.
6. No required workflow depends on host-only hardware, a host GUI, or a platform-specific binary that
   cannot run in the Linux development container.

Select the Node major from positive project evidence, in this order:

1. an exact major in `package.json#engines.node`;
2. the package manager's workspace/root manifest when all application packages inherit it;
3. `.nvmrc` or `.node-version`; or
4. an exact application runtime version already recorded by the approved project plan.

The project plan's Prerequisites inventory is not an application runtime declaration; its Node version
describes the machine observed during planning and must not select the Sandbox image.

Explicit declarations always win. Conflicting evidence, ranges spanning multiple majors, or an
unrecognized version means Host. Do not select an image from the Node version currently installed on
the host.
Do not treat `@types/node`, a lockfile dependency version, or the host-installed Node version as an
application runtime declaration.

New CoR scaffolds must normally provide explicit `engines.node = 24.x` evidence in every generated Node
application manifest. The marker-based rule below is a compatibility fallback for generated projects that
predate that scaffold contract. When there is no explicit Node declaration anywhere in the generated
application services, select Node 24 only when all of the following are true:

1. `.azure/created-by-cor.json` is a valid schema-version 1 marker with `source = copilot-on-rails`,
   establishing that this is a CoR-generated project rather than an arbitrary existing workspace.
2. Every generated application service is JavaScript or TypeScript and at least one is Azure Functions
   programming model v4.
3. Package manifests and the lockfile contain no Node engine, package-manager, native-module, or
   dependency constraint that excludes Node 24.
4. All other Sandbox match conditions hold.

Record the default explicitly in Match Rationale: no project runtime was declared, the CoR generation
marker and supported service topology were found, dependency constraints are compatible, and the newest
supported major (Node 24) was selected. Record Node `24.x` for every generated application service in the
Debug Configurations table. Missing runtime evidence in an unmarked or existing project still means Host.
When the Node 24 default is rejected, keep each affected Debug Configurations `Version` cell
`Unknown` (or `—`) rather than writing `24.x`; the Host fallback must not look like a resolved runtime.

The supported image matrix is defined by
`azure-debug-generate/references/development-environments/node-functions-sandbox.md`. It uses:

- Microsoft's public `mcr.microsoft.com/devcontainers/javascript-node:{22|24}-bookworm` image matching
  the declared project runtime, pinned by its certified immutable multi-platform digest
- base-provided Node.js and matching npm plus pnpm `12.16.1`, Yarn `1.22.22`, Git, certificates, build
  tools, common developer tooling, and the non-root `node` user
- CoR-added Azure CLI `2.91.0`, Azure Functions Core Tools `4.16.0`, DNS/netcat diagnostics, and the
  PostgreSQL client required by this workflow

TypeScript is project-owned: install and execute the version locked by the project. Do not bake a global
TypeScript compiler, `ts-node`, or `tsx` into the image.

Node 20 is not a supported Azure Functions target because its Azure Functions support has ended. Do not
silently change that runtime. For non-Functions Node 20 services selected for Sandbox, use the generic
runtime contract and install the exact declared runtime. For Node 20 Azure Functions, select Host with the
unsupported-runtime reason rather than presenting Sandbox as a compatibility fix.

The image is built locally. Never publish or require a pre-published image.

## Python and Generic Runtime Sandboxes

When Sandbox is selected but the optimized Node contract does not match:

1. Prefer the pinned Python 3.12 Microsoft development image for Python 3.12 projects.
2. For every other container-compatible runtime/version, use the pinned generic Microsoft Bookworm
   development base.
3. Install the exact approved application runtime and required development CLIs in the local Dockerfile
   from pinned, checksummed vendor sources.
4. Record the base image digest, runtime evidence, runtime install source/version, and added tools in the
   Development Environment table.
5. Keep application dependencies project-owned and install them from committed lockfiles during startup.

Follow
`azure-debug-generate/references/development-environments/generic-runtime-sandbox.md` for the pinned images,
non-root user, Compose lifecycle, F5 integration, and validation rules.

## Host Mode

Host mode is always an explicit alternative. Select it when requirements record `Regular`, preserving an
existing Compose topology prevents safe generation, the runtime cannot run in the supported Linux
container architecture, a required workflow needs host-only hardware/GUI access, or the user explicitly
asks to run application processes on the host. A missing runtime-specific image alone is not a Host reason;
use the generic runtime Sandbox instead. In Host mode, inventory Node.js, package managers, Azure CLI,
Functions Core Tools, and other runtime tools as host prerequisites. Preserve the pre-sandbox plan shape:
do not emit `## Development Environment`. Its absence means Host to the generation phase. For newly
generated Host plans, add this visible blockquote at the start of `## Prerequisites`, before its table:

> **Development Environment:** Host — application runtimes and CLIs will run directly on this machine.
> Sandbox was not selected because {concise, concrete reason}.

Keep the reason specific, such as the Requirements choice, an unresolved/conflicting runtime declaration,
an end-of-support runtime/framework combination, host-only requirements, or an existing Compose conflict.
Do not add a Host environment table. Older Host plans
without the note remain valid and generation-compatible.

## Guided Selection

- When requirements select Sandbox and no hard incompatibility exists, emit the detailed
  `## Development Environment` table with `Mode = Sandbox` and the selected runtime-specific or generic
  image strategy.
- When requirements select Regular or a hard incompatibility exists, omit `## Development Environment`,
  use the legacy Host plan shape, and add the concise visible Host blockquote with the concrete reason.
- Do not ask a separate question. Requirements already captured the user's choice and Azure availability;
  the Local Plan approval gate remains the review.
- Preserve existing configuration. If Sandbox would require replacing user-authored Compose
  configuration, recommend Host and identify the conflict.

## Autopilot Selection

Autopilot must be deterministic and must not ask:

1. Honor the submitted Requirements environment choice.
2. For Sandbox, select a certified exact-runtime image when available; otherwise select the pinned generic
   base and install the exact declared runtime.
3. If runtime evidence is unresolved/conflicting or a hard container incompatibility exists, select Host
   and write the visible deterministic fallback reason.
4. Never overwrite conflicting Compose configuration to force Sandbox mode.
5. Never use floating image tags, a host-installed runtime, or a different runtime version.
6. For Sandbox, record the selected mode, complete Match Rationale, and runtime install strategy. For Host,
   omit the section; absence is the deterministic Host signal.

## Prerequisite Separation

In Sandbox mode:

- **Host Prerequisites** include the selected container runtime and Compose provider, a supported
  browser for frontend debugging, and matching runtime debug extensions.
- **Base-Provided Tools** list the toolchain inherited from the pinned Microsoft image.
- **CoR-Added Tools** list only the tools installed by the generated Dockerfile.
- **Supporting Emulators** list Compose services such as Azurite and PostgreSQL.
- Do not duplicate base-provided or CoR-added tools in the plan's `## Prerequisites` table as host
  requirements.
- Dev Containers and `ms-vscode-remote.remote-containers` are not required or recommended for
  Sandbox mode. VS Code stays in the host workspace and invokes container tools through Compose tasks.

In Host mode, `## Prerequisites` contains the full host runtime and debug toolchain, and the plan has no
`## Development Environment` section.
