# Prototype 3: Local and Copilot compatibility

Investigation date: 2026-09-13. BEFORE revision:
`493135aef262a62ebf0079348659da69fcd74930`.
The AFTER evidence commit adds only this document; implementation is unchanged.

This is a historical result. The branch now starts HTTP automatically without the earlier
enablement dialog. These results do not claim UI validation of the newer startup behavior.

## Result

**The same HTTP definition is designed for Local and Copilot, but real Local compatibility remains TBD.**
The bounded trial did not complete native listener enablement. This is a consent/UI limit, not an observed HTTP transport failure.

| Check | Result | Revision and evidence scope |
| --- | --- | --- |
| Full extension/webview build, TypeScript, targeted lint | PASS | Rerun immediately before the BEFORE commit. |
| SDK protocol and provider tests | PASS, 15/15 | BEFORE revision. Includes two clients on one listener, separate sessions, auth rejection, lifecycle isolation, and explicit automatic negotiation. Not model-driven Local evidence. |
| Real Local marker and Next Steps view | TBD: native enablement not completed | BEFORE revision, normal Development host, fresh empty fixture. Normal Workspace Trust completed; the final readiness check still showed the prototype disabled. No tool invocation attempted. |
| Fresh Copilot on the same listener in this followup | Not run | Enablement did not complete, so no shared-listener UI comparison was possible. |
| Earlier real Copilot Agent Host marker and Next Steps | Historical PASS | 2026-09-12 uncommitted prototype build, before final launch-helper/Test-consent cleanup. Do not relabel this as a new UI pass at the BEFORE revision. |

The historical Copilot trial returned the correct opaque window marker exactly once and separately opened the existing Next Steps view after session-scoped approval. Backend logs counted one marker invocation; independent CoR diagnostics counted one Next Steps start/success. No workflow actions were clicked.

## Why one definition should work

[`registerLoopbackPrototype.ts`](../src/chat/tools/experimentalLoopback/registerLoopbackPrototype.ts) returns one ready `McpHttpServerDefinition` with the listener URL, auth header and version. It does not select a different transport by chat harness or depend on a resolver to populate the connection.

VS Code's HTTP definition contract supports editor-side Streamable HTTP initialization and headers on every request. The standard SDK listener accepts separate authenticated MCP sessions without a Local/Copilot identity filter. Existing two-client tests support this expectation. They do not establish Local model/tool-selection/approval behavior or simultaneous Local/Copilot execution.

## Runtime and bounded trial

Observed installed application metadata: VS Code **1.137.0**, commit
`645f29cc3176500b4b5762ba887cf2a7f0ffdf2c`; bundled
`@github/copilot` **1.0.84-canary.70.gdb75d0d.unsigned** and
`@github/copilot-sdk` **1.0.13-preview.4**. This is not the stock dependency graph assumed by the earlier source research.
Automated checks used Node22.18.0, TypeScript5.9.3, tsx4.22.4 and MCP client/server/core2.0.0-beta.4 on macOS arm64.

The trial ran approximately08:25-08:28 PDT in normal Development mode using this revision, its own companion activation extension and a fresh empty fixture. The previously signed-in isolated profile was reused in place under owner-only0700 directories. No auth was copied, no `--extensionTestsPath` was used, and no AppleEvents/system permission request or bypass was attempted.

After normal Workspace Trust, the Enable command was invoked. At the final08:27:35 check, the extension output still contained only `Prototype available but disabled`; native enablement had not completed. Per the bounded-investigation instruction, testing stopped rather than changing consent or security settings. Tracked Code PID70105 and loopback CDP9331 were stopped; CDP closure was verified. No HTTP endpoint was published by this trial. The shared profile was preserved.

## Security delta from private IPC

The maintained private IPC implementation already has nonce authentication on MCP requests, named handlers, SDK protocol/session machinery and a0700 Unix socket directory. Authentication and avoiding arbitrary command RPC are not new inventions of HTTP mode.

TCP adds reachable local-network authority beyond the private socket's filesystem boundary. Prototype3 therefore binds explicitly to127.0.0.1, validates exact Host/request authority and present Origin, avoids permissive CORS, and uses a revocable256-bit per-listener capability. Auth, origin/host, loopback and resource-bound tests pass. The capability is not OAuth or proof of human consent.

Listener-local sessions, awaited readiness, stale-session404, shutdown, and request/session/connection limits are implemented improvements that also benefit private IPC. The current loopback wiring exposes the existing full CoR catalog; this broadens the prototype's tool authorization surface and is not a production-readiness claim.

Production still needs full-tool operation authorization, safe host-owned credential storage/ACLs/retention/sync, pairing/window scope, real-client refresh/retry/concurrency validation and platform/remote testing. The earlier actual Copilot trial observed synthetic config0644 under0755 parents protected by an enclosing0700 profile; the revoked credential remained in historical config after Stop. Revocation worked, but the extension does not control downstream copies.

See the experimental loopback implementation for reproduction and limits. No production-readiness or cross-platform claim follows from these results.
