# MCP transport comparison

[Overview and diagrams](README.md) | [Direct socket](01-direct-socket.md) | [Stdio bridge](02-stdio-bridge.md) | [Loopback HTTP](03-loopback-http.md)

## I. Prototype results

Results apply to the [recorded runtime](README.md#evidence-boundary). Protocol checks are not model-invocation proof.

| Prototype | Feasibility and observed result | Blocker or qualification |
| --- | --- | --- |
| 1. Direct socket | Not viable as tested. Ready URI, zero sessions/effects. | `invalid MCP server URL: invalid format`; alternate formats TBD. |
| 2. Stdio bridge | Feasible. Current child passed Local and Copilot command/view calls; 16 protocol scenarios. | Same definition/listener, sequential clients; not concurrent workflow proof. |
| 3. Loopback HTTP | Feasible. Original real Copilot command/view once each; 15 checks. | Local follow-up stopped before native enablement; not a transport failure. |

Neither proves the full CoR workflow. Unequal test inventories are not benchmarks.

## II. Implementation comparison

Both feasible options retain activation-owned registration and extension-host handlers. Copilot owns connection, not registration.

| Concern | 2. Stdio bridge | 3. Loopback HTTP |
| --- | --- | --- |
| Implementation | Stdio/private-HTTP relay, frame guard, discovery fallback. | Direct HTTP, listener-local sessions, limits, awaited disposal. |
| Maintenance | Own protocol adaptation; retain backend. | Fewer layers; upstream the experimental server copy. |
| Process/runtime | One VS Code-owned Node child; environment/exit handling. | No helper; request pressure stays in extension host. |
| Package reuse | Public `startInProcHttpServer`; Node-only bridge. | Locked 1.0.0 Hono adaptation with license, not archived Express. |

Stdio avoids a second server implementation but must maintain protocol relaying. HTTP removes child management, not server ownership.

## III. Security comparison

Shipping requires authenticated, window-bound calls, extension-enforced approvals, resource bounds and revocation. Current Local already has private IPC, nonce authentication, a 0700 Unix directory and SDK host protection. It is not a fully secured baseline.

| Area | Current Local baseline | 2. Stdio: added risk and remaining work | 3. HTTP: added risk and remaining work |
| --- | --- | --- | --- |
| Exposure/auth | Private socket, nonce; no TCP. | Keeps IPC; guards/fallback implemented. Harden child packaging, environment and framing. | TCP admits local-user/browser attempts. Loopback/auth/Host/Origin/limits tested; validate OS/network behavior. |
| Bootstrap/secrets | Resolver supplies credential. | Environment/config carry lease; scope delivery with host. | Ready URL/header forwarded; same storage work plus port/credential refresh. |
| OS permissions | Unix 0700; no explicit Windows DACL. | Preserve ownership checks; validate Windows/remote strategy. | No filesystem gate; loopback does not select an OS user. |
| Revocation/resources | Module-wide session map, early startup return, incomplete bounds. | Inherits gaps despite readiness probe/one-hour lease; harden backend and child shutdown. | Local sessions, bounds, 30-minute lease/Stop implemented; productionize cleanup/upstream integration. |

Both trials found credential files at 0644 under 0755 directories, protected by profile root 0700. Ordinary F5 is not covered. Retention/ACL/sync require host integration; the extension cannot erase all copies. Neither isolates malicious same-user processes.

Shared full-catalog work includes window binding, scoped bootstrap and operation-specific approval for database firewall changes and deployment workflows. A nonce is not per-chat identity or human consent. Same-host capabilities need not automatically use full OAuth; remote/shared service authorization is a separate design.

Relative to Local, stdio needs less new endpoint-access protection but more child/protocol work. HTTP has broader exposure, with protections already implemented. Stdio still needs shared-package lifecycle hardening; HTTP already addresses session ownership, limits and disposal. Full-tool authorization and credential-retention work are comparable.

## IV. Local and Copilot compatibility

| Prototype | Local connection/discovery | Local model invocation | Copilot connection/discovery | Copilot model invocation |
| --- | --- | --- | --- | --- |
| 1 | Proven, earlier Test-mode control | TBD | Failed for tested URI | None, blocked before connection |
| 2 | Proven, current definition | Proven marker/view | Proven, current definition | Proven marker/view with current child |
| 3 | Expected from native HTTP support; TBD | TBD, enablement incomplete | Proven, original trial | Proven marker/view, original trial |

"Expected" is source support, not a measured call. Stdio used one unchanged definition/listener sequentially. HTTP's follow-up completed Workspace Trust but not native enablement: no listener, definition or calls, and no fresh Copilot trial. Local HTTP and alternate socket formats remain TBD. Standalone CLI, Windows, remote operation, all 17 tools, allowlists, workflow approvals, handoffs and resume remain untested.

## V. Conclusion

Prefer stdio for private IPC, package reuse and now-proven basic dual-client invocation, despite its extra process and protocol maintenance. HTTP offers fewer processes and better prototype listener ownership, but broader reachability and server upstreaming work.

This is a transport choice, not approval to replace the full CoR workflow. HTTP's dual-client evidence remains incomplete; both options need command policy and credential lifecycle work before expanding the catalog.
