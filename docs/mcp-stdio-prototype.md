# MCP stdio prototype

This worktree implements prototype 2 and always registers the stdio prototype
during extension activation. It replaces the original HTTP provider and full tool
catalog in this branch. Do not package or publish this prototype.

## Run

With development dependencies installed, select **Launch Extension** and press
F5. Once Azure Resources activates in a trusted local workspace, it provisions the
listener and registers the bridge. No prototype flag, Node path, or pairing command
is required for VS Code Chat. The ordinary F5 configuration uses VS Code's normal
development profile rather than creating an isolated one. Sign-in and tool
approvals remain user-controlled.

For an isolated profile and disposable workspace, use Node 22 to run these commands:

```sh
npm ci
npm run test:mcp-stdio
npm run prototype:mcp-stdio
```

The final command builds the extension and opens a dedicated VS Code development
window with its own user-data directory, extensions directory, and disposable
workspace. It prints the artifact directory and launcher PID. It does not copy
credentials, disable Workspace Trust, or enable automatic tool approvals.
Trust only the generated disposable workspace. Close that window to finish.
`VSCODE_BINARY=code-insiders npm run prototype:mcp-stdio` selects Insiders.
If the extension first activated in Restricted Mode, trust the generated folder
and run **Developer: Reload Window** before starting the MCP server.
On macOS the launcher resolves the CLI to the application executable so reloading
does not release its process ownership.

The extension uses its own `process.execPath` with `ELECTRON_RUN_AS_NODE=1` and
`ELECTRON_NO_ASAR=1`, following the existing Cloud Shell launcher pattern. This
runs the bundled `dist/mcpStdioBridge.js` using VS Code's Node runtime, without
requiring a separate Node installation for the bridge. There is no runtime
download or shell command construction. The executable and socket must be
reachable from the local Agent Host. Windows, WSL, SSH and containers remain
unsupported in this prototype.

## VS Code Copilot check

1. In the development window, open the Output channel
   **Azure Resources MCP stdio prototype**. Expect a ready message and an opaque
   instance marker. The disposable `.azure/project-plan.md` activates the extension.
2. Create a new **Copilot** chat using the local Agent Host, UI scheme
   `agent-host-copilotcli`. Do not use Local, the older `copilotcli` integration,
   or cloud. Sign in in this dedicated profile if prompted.
3. Find **Azure Resources stdio prototype** in the tool picker and explicitly
   enable it. Approve server startup and individual calls when prompted.
4. Ask: `Use cor_stdio_probe once, with the instance value shown in its schema.
   Report its instance and count. Do not use terminal tools.`
5. Expect the identical marker in the tool result and one new `probe` entry in
   the Output channel. Ask to call `open_scaffold_next_steps_view`.
   Expect the existing **Next steps** webview.
6. Do not click its debug or deployment buttons. Those are existing workflow
   actions, not part of this transport experiment.

The provider publishes a complete `McpStdioServerDefinition` during activation,
after its private listener answers an authenticated readiness request. It does
not depend on `resolveMcpServerDefinition`. Reload creates a new marker, listener,
and nonce. Start a fresh chat/server connection after reload. Old connections
fail rather than selecting another window or replaying a tool.

## Automated extension-host check

For the normal Development-mode companion used in the successful live trial:

```sh
npm run prototype:mcp-stdio:companion
```

The tiny generated companion waits for Workspace Trust, runs the account-independent
SDK checks, closes its control webview and leaves Chat available for the real
Copilot trial. Its `provider-state.json` records non-secret instance and effect
counters once per second. The companion is not part of the shipped extension.

The separate VS Code Test-mode entry is also available:

```sh
npm run test:mcp-stdio:extension
```

This opens another isolated VS Code test window. It activates the real extension,
uses its explicit pairing command to launch the same stdio bridge with the public
SDK client, checks the two-tool catalog, invokes the fixed command, tests failure
and cancellation, and checks for the real **Next steps** webview tab.
It writes `extension-result.json` to the printed artifact directory.
VS Code logs are under that directory's `profile/logs/`.

This is an extension-host integration test, not a model-driven Copilot chat test.
The non-GUI `test:mcp-stdio` suite instead uses the actual locked HTTP package and
MCP SDK with a fixture only at the VS Code command and telemetry boundary.
Do not use `--extensionTestsPath` for interactive sign-in or Copilot trials.
VS Code Test mode can suppress authentication and Workspace Trust dialogs.

## Explicit standalone pairing

In the development window, run **Azure: Pair This Window with MCP Stdio
Prototype**. The Output channel prints a file path. The file contains a
short-lived nonce and must not be shared, checked in, or pasted into chat.
The command creates its own owner-only temporary directory and mode-0600
`mcp-config.json`. It identifies this window, not the most recently active window.

Use a separately authorized CLI profile, without changing the normal profile:

```sh
COPILOT_HOME=/absolute/path/to/isolated-cli-profile \
COPILOT_AUTO_UPDATE=false \
copilot --additional-mcp-config @/absolute/path/from/pairing/mcp-config.json \
  --disable-builtin-mcps
```

Run from a disposable directory, not this repository. Sign in explicitly in that
isolated profile if needed. Do not copy auth files, tokens, or keychain values.
Approve only the named prototype tool calls. CLI configuration acceptance alone
does not prove model invocation or editor UI delivery.

## Security and lifecycle

The bridge forwards MCP messages; it does not implement CoR tools or import
`vscode`. The extension retains schemas, telemetry, fixed command routing,
Workspace Trust checks and workspace identity checks. A successful initialization
must return the expected extension server ID and instance-bound server version.

The connection uses the package's HTTP `/mcp` route over its existing Unix socket.
Undici connects to that socket with HTTP authority `localhost` and the original
`Authorization: Nonce ...` credential. Redirects are rejected. No TCP listener
is added. The socket directory must be owned by the current user with mode 0700.

The lease expires after one hour. Expiry, workspace-folder changes and extension
disposal revoke the listener and remove pairing files. A crash can leave a
pairing file behind, but the old socket/nonce cannot authorize a new listener.
Stdio EOF and signals terminate the individual HTTP session. Backend loss closes
the bridge; there is no automatic request retry or session recovery.

Input frames and individual output messages are limited to 1 MiB, queued output
to 4 MiB, and pending requests to 32. Initialization has a ten-second deadline;
requests have a thirty-second deadline; shutdown has a two-second backstop.
Transport failures close the connection with a generic stderr diagnostic.
Stdout contains only MCP messages.

The nonce is a listener-wide capability, not proof of human consent or chat
identity. Each bridge gets a distinct MCP session, but authorized clients share
the window's application state. The Agent Host may persist the launch environment
in generated configuration. Owner-only storage does not protect against other
processes with the same OS privileges. A production version needs a reviewed
credential bootstrap, per-client grants and revocation strategy.

## Package follow-up, not patched here

`@microsoft/vscode-inproc-mcp` 1.0.0 has a module-global session map and returns
before `listen` completes. This prototype owns exactly one listener per
extension host and probes readiness before publication. Unknown sessions still
return HTTP 400 rather than 404. The bridge fails closed and never retries a call
to compensate. Listener-local session ownership, bounded server resources,
startup errors and deterministic server disposal belong in upstream package work.

The SDK's stdio read buffer silently skips malformed JSON syntax. A small frame
guard rejects that case before the SDK parser, which still owns MCP validation.
The prototype targets the existing 2025 initialization/session protocol; it does
not claim to implement the 2026 protocol. It answers a pre-initialization
`server/discover` probe with standard JSON-RPC `-32601` so automatic-negotiation
clients can fall back to the real backend `initialize`. This was required by the
installed Copilot canary runtime, which otherwise timed out during negotiation.

## Verified result

On macOS arm64, VS Code 1.137.0 commit
`645f29cc3176500b4b5762ba887cf2a7f0ffdf2c`, the actual installed Copilot package was
`1.0.84-canary.70.gdb75d0d.unsigned` with Copilot SDK `1.0.13-preview.4`.
This is not assumed to be an unmodified stock release dependency set.

The public stdio suite passes 16 scenarios, including automatic version
negotiation and twenty reconnect cycles with 400 mixed calls. The normal
Development-mode companion passed real extension-host command, error,
cancellation and Next steps checks. A fresh Copilot Agent Host chat then called
both named tools successfully, with separate permission prompts and exactly one
additional command effect and one additional view call.

The observed tool identifiers were
`Azure-Resources-stdio-prototype-cor_stdio_probe` and
`Azure-Resources-stdio-prototype-open_scaffold_next_steps_view`.
Standalone CLI model invocation and other OS/remote environments remain untested.
This result establishes transport and handler delivery, not full CoR pipeline
compatibility.

The existing Next steps screen is unchanged. No screenshot refresh is required.
