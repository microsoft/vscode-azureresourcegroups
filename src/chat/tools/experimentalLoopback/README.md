# Experimental authenticated loopback MCP

Prototype 3, not a production transport migration. Default activation still calls the unchanged
`@microsoft/vscode-inproc-mcp` private IPC provider. HTTP replaces that registration only in a
development/test extension host launched with `AZURE_RESOURCES_MCP_HTTP_PROTOTYPE=1`.

## Run

From this worktree with Node 22.18.0 and dependencies installed:

```sh
npm ci
npm run test:mcp-http-prototype
npm run prototype:mcp-http
```

The last command builds the extension/webviews and launches stable `code` with a fresh OS-temp
user-data directory, extensions directory, and empty fixture. Set `VSCODE_EXECUTABLE=code-insiders`
to select Insiders. It prints the isolated profile path, never the endpoint or credential. Close
that window when finished. It deliberately retains the isolated profile for inspection.
The launcher sets the containing profile directory to `0700` before VS Code starts. This matters
even if Agent Host writes its synthetic configuration with more permissive individual file modes.
For manual use it builds a tiny companion development extension in that directory. The companion
activates Azure Resources on startup so the hidden opt-in commands become available. It does not
enable the listener or approve anything. Real signed-in Chat runs never use `--extensionTestsPath`.
`node --import tsx scripts/launchMcpHttpPrototype.mts --prepare-only` prepares these artifacts
without launching a window, useful before a parent-coordinated serialized GUI slot.

1. Trust only the new empty fixture. Run **Azure: Enable MCP HTTP Prototype** and approve its
   window-scoped modal. No listener exists before approval. The lease lasts 30 minutes.
2. In Output, select **Azure Resources MCP HTTP Prototype**. Note the opaque window marker.
   The ready message is not a tool-call result.
3. Use the actual local Copilot Agent Host Chat type `agent-host-copilotcli`, not Local,
   the older `copilotcli` integration, or cloud. If prompted, sign in through VS Code's normal UI.
   Never copy auth tokens from another profile.
4. Enable only **Copilot Azure Resources Extension Tools** in the tool picker. Ask the agent to call
   `experimental_loopback_instance_marker` with `{}` and return its exact value. Approve the tool
   normally. Compare the response with the output channel and confirm the fixed-command invocation
   entry. Neither a server status nor `tools/list` establishes this result.
5. Ask it to call `open_scaffold_next_steps_view` with `{}`. Confirm the **Next steps** tab renders.
   Do not click workflow buttons, enable CoR autopilot/global auto-approval, or start Azure work.
6. Run **Azure: Stop MCP HTTP Prototype**. The definition disappears and old credentials/sessions
   stop working. Enable again and start a fresh chat to check declaration refresh. Reload Window
   requires fresh explicit enablement. For a second window, repeat the launch command and compare
   its different marker. Opening the same folder twice must not mix the markers.

For Local control, select Local in the same isolated window with the HTTP opt-in. To reproduce
unchanged private IPC behavior, launch the extension using its normal development configuration
without the opt-in, also in a dedicated profile. The unchanged 1.0.0 provider initially publishes
`http://invalid.invalid`; only `resolveMcpServerDefinition` starts IPC and supplies the nonce.
This source/contract difference is not evidence that a real Agent Host connection failed.

## Account-independent actual extension-host check

```sh
npm run test:mcp-http-extension
```

This also launches a dedicated VS Code window, so serialize it with other GUI tests. It bundles
`test/experimentalLoopback/extensionHost.ts` into the companion Development extension. Trust the
empty fixture, then approve the normal **Enable for this window** modal. There is no test-only
consent override. Test mode is deliberately avoided: in this installed VS Code build,
`--extensionTestsPath` uses in-memory storage and loses Workspace Trust even for a previously
trusted fixture, while suppressing the trust dialog.

The test uses the extension's existing test API to read the same ready definition returned by the
registered provider. A standard SDK client then calls the real fixed command and existing
`openScaffoldNextStepsViewTool.execute`. It asserts the marker, actual controller state, visible
Next steps tab, and stopped endpoint. This is extension-host integration, not a model-driven
Copilot invocation or a standalone CLI result. Trust prompts or missing native dependencies may
still require local user action.
Wait for **PASS** in the **Azure HTTP Prototype Check** Output channel before closing the window.
The launcher checks a credential-free, mode-0600 result file and exits nonzero if the check failed
or the window closed before it finished. Native OS consent dialogs may require a human click;
do not bypass OS permissions to automate them.

## Implementation and provenance

Azure base: `5dacef3a7ddbf090717e71dc94d56112a5e4e5be`.

`loopbackServer.ts` adapts the Hono routing, per-session `McpServer`, and
`WebStandardStreamableHTTPServerTransport` construction from the installed, locked
`@microsoft/vscode-inproc-mcp` **1.0.0** artifact, specifically
`dist/cjs/vscode/inProcHttpServer.js`. Its MIT notice is preserved in `LICENSE.md`.
Package tarball integrity:
`sha512-KYj0A2dsKTrllAqxA+5CafhR8gY5mfdLTC5vKKNBb3aJ4Dcgau5su/3+S1HMwrRy9j68EgaPhtmCvKGjuOB+9g==`.

The read-only primary containers checkout was `e403927879ed68487c83eb856f7e0d7923593698`;
its working source was the older Express implementation. It was not used or modified.
The research snapshot `19fa49a6b8a8d4c2680ca2ce1140c0da252394c5` was not usable at the
expected package path in that local checkout. No archived 0.3.0 implementation was copied.
No `node_modules` files were patched.

Direct prototype dependencies pin the already locked `@hono/node-server` 2.1.0 and Hono 4.13.0.
Tests add `@modelcontextprotocol/client` 2.0.0-beta.4. The existing server/core stay
2.0.0-beta.4. These are SDK versions, not negotiated MCP wire versions.

The upstream-ready change is a separate awaited loopback listener mode with explicit host/port,
pre-publication auth, instance-local transport ownership, terminated-session 404, resource bounds,
and asynchronous shutdown. The experimental copy avoids changing the public package API or its
private IPC defaults. Moving this to the maintained package should preserve that default and
upstream these narrowly scoped lifecycle changes, rather than maintain another protocol.

`toolCatalog.ts` only adapts two named callbacks to SDK registration with strict empty-object
schemas. The marker calls a fixed VS Code command; callers cannot select command IDs or arguments.
The other callback invokes the existing Next Steps tool and checks actual controller state before
reporting success. No workflow implementation, deployment, inventory, dev-server, or firewall
capability is copied or added. The existing view's buttons retain their normal actions and are not
part of this experiment.

## Security and lifecycle limits

The endpoint is explicit IPv4 `127.0.0.1:0`, not IPv6, wildcard, remote forwarding, or a TCP proxy.
Every request must have the exact local Host/authority. A present Origin must equal the actual
`http://127.0.0.1:<port>` origin; absent Origin is accepted for native clients. No CORS is enabled.
POST, GET, DELETE, and initialization require the same 256-bit random per-listener capability in
`Authorization: Nonce ...`. MCP session IDs are independent UUIDs, never credentials.

This local out-of-band capability is **not OAuth**. It has no OAuth discovery, per-chat identity,
TLS, client pairing, or per-client grant. The lease authorizes the two-tool listener in one local
extension-host window. Two clients share that window's application state. Their MCP sessions are
separate. A compromised same-user process or extension is outside the protection of this scheme.

Limits are 16 KiB POST body, 8 KiB headers, 32 TCP connections, 16 concurrent HTTP handlers,
8 sessions, 4 concurrent tool executions, and one in-flight Next Steps call across all sessions.
Header/body timeouts are 5/10 seconds, socket inactivity and session inactivity are 60 seconds,
the lease is 30 minutes, and shutdown has a one-second deadline. Idle sessions are reaped at
60-second intervals. Long-running handlers must honor the SDK cancellation signal; stopping a
listener cannot undo an effect already dispatched. No server-side retry or event replay is added.
The SDK test explicitly disables client reconnection retries. Real client retry behavior remains
unverified, so never automatically repeat ambiguous mutating calls.

Stop, extension disposal, lease expiry, and folder changes revoke authorization. Execution also
rechecks Workspace Trust and local-folder constraints. Restart creates a new secret/session set
and definition version, even if the OS happens to reuse a port. The first provided definition
already contains URL/auth; there is no resolve-only placeholder in HTTP mode.

VS Code Agent Host may serialize the header to a synthetic plugin `.mcp.json`. This code does not
control that file's permissions, retention, sync, or redaction. Inspect only the dedicated profile,
redact the entire Authorization value, and record mode/ownership and persistence after stop/reload.
Never retain the live header in reports, screenshots, URLs, command lines, workspace configuration,
or tool results. Revocation prevents reuse but cannot erase third-party client copies.

Standalone CLI pairing is intentionally not implemented. Do not paste credentials into a project
MCP config or run the CLI with secrets in command arguments to claim compatibility. A separately
approved owner-only descriptor/refresh mechanism needs its own design and validation.

## Evidence boundaries and logs

`npm run test:mcp-http-prototype` is Node's test runner with real HTTP and the standard SDK.
Its provider tests run the actual provider module against a mocked VS Code API. They are not real
extension-host or Copilot tests. `npm run test:mcp-http-extension` is the separate actual
extension-host check above. Record its result separately from Copilot Agent Host, Local, and CLI.
The Node-only tests use `.node.ts` names so the repository's normal VS Code/Mocha `*.test.ts`
discovery does not import them into ordinary extension tests.
SDK 2.0.0-beta.4 defaults to legacy negotiation. An additional explicit `mode: 'auto'` test
records `server/discover`, the HTTP pre-initialization rejection, then genuine `initialize`
negotiation of `2025-11-25` and a successful marker call. No modern discovery success is fabricated.

Logs live under the printed `<isolated-profile>/user-data/logs/`. Extension test output is also
in the launching terminal. The prototype Output channel logs only lifecycle events and the opaque
marker. Inspect the isolated user-data tree for forwarded configuration only after a real Agent
Host session has consumed the declaration. Source research does not prove its security at runtime.

No Windows, Linux, SSH, WSL, container, other-user, or remote-host validation is claimed.
