# MCP transport comparison

[Overview and diagrams](README.md) | [Current implementation](00-current-implementation.md) | [Direct socket](01-direct-socket.md) | [Stdio bridge](02-stdio-bridge.md) | [Stdio security](stdio-bridge-security.md) | [Loopback HTTP](03-loopback-http.md) | [Loopback security](loopback-security.md)

## I. Prototype results

We compared three ways for a chat agent to reach CoR's tools inside VS Code. Each experiment tried to identify the receiving window and open the existing Next Steps screen.

| Prototype | Feasibility and observed result | Blocker or qualification |
| --- | --- | --- |
| 1. Direct socket | Copilot rejected the socket address before connecting. | Other address formats remain untested. |
| 2. Stdio bridge | Copilot ran both tools using the current Node stdio bridge. | The trial covered two test tools, not the complete CoR workflow. |
| 3. Loopback HTTP | Copilot ran both tools using authenticated loopback HTTP. | The successful trial predates the final launch-script cleanup. |

Results apply only to the [tested installation](README.md#evidence-boundary).

## II. Implementation comparison

Both options use the VS Code MCP registry for setup metadata, not tool requests. Both end with an in-process JavaScript call from the MCP server to a CoR handler. They differ between the MCP client and server.

| Concern | 2. Stdio bridge | 3. Loopback HTTP |
| --- | --- | --- |
| Registered metadata | Bridge command, script and lease containing socket URI, nonce, expiry and instance. | Loopback URL and nonce header. |
| Request route | JSON-RPC over stdin/stdout, then authenticated HTTP over an owner-protected Unix socket. | Authenticated HTTP over TCP to `127.0.0.1:<port>/mcp`. |
| Implementation | Translates two transports and handles a startup-version difference. | Client connects directly using ordinary HTTP. |
| Process and runtime | Copilot owns one child using VS Code's Node runtime. The extension cannot kill it directly. | No child. The extension owns and directly closes the listener. |
| Maintenance | Framing, forwarding, cancellation, protocol fallback and bridge cleanup. | Authentication, Host and Origin checks, limits and listener cleanup. |
| Rebuild | An old bridge can retain old code until it exits, but its revoked nonce cannot reach a new server. | Stopping the extension host stops all prototype code. |
| Package reuse | Reuses the existing private server unchanged. | Adapts package 1.0.0's Hono server; changes should move upstream rather than remain copied. |

HTTP has fewer process and transport boundaries. Stdio preserves the existing server package and its owner-protected socket.

## III. Security comparison

The [current implementation](00-current-implementation.md#protections-and-limits-we-already-have) uses an owner-protected Unix socket plus a nonce. This is the existing security baseline rather than compatibility evidence. Both options still need correct window selection and approval for sensitive tools.

| Question | Current implementation | 2. Stdio: what changes | 3. HTTP: what changes |
| --- | --- | --- | --- |
| Exposure | Owner-only socket directory. | Same socket restriction; child-process pipes have no address. Trust the bridge executable and launch definition. | Any local process can try the port. Nonce, Host, Origin and limit checks protect requests. |
| Bootstrap | Callback returns address and nonce. | Registry passes a serialized lease in the child environment; bridge deletes it after reading. | Registry passes URL and nonce header to the client. |
| Credential risks | Retained settings or logs. | Retained launch settings, logs, early environment inheritance or compromised bridge. | Retained settings, logs or stolen bearer nonce. |
| OS work | Validate Unix and Windows private-endpoint permissions. | Also validate child launch and bridge exit. | Validate loopback binding and exposure; TCP does not restrict callers to one user. |
| Revocation | Server shutdown. | Stop, disposal or lease expiry; verify orphan cleanup. | Stop, disposal or lease expiry; verify restart cleanup. |

Lease duration is policy, not a transport property. Both trials retained secrets in generated settings protected by an owner-only outer profile directory; normal profiles still need validation. The extension cannot erase every VS Code copy.

Neither nonce identifies a person or chat, grants user consent, or protects against same-user malware. Stdio narrows who can connect but adds a trusted adapter process. HTTP accepts more local connection attempts but has fewer moving parts. Both share the same in-process authorization requirements.

## IV. Copilot compatibility

| Prototype | Copilot connection | Copilot model calls |
| --- | --- | --- |
| 1 | Address rejected before MCP connection | No call |
| 2 | Connected through stdio bridge | Both test tools passed |
| 3 | Connected through loopback HTTP | Both test tools passed in the original trial |

Neither successful trial covered Windows, remote hosts, all 17 CoR tools, agent tool restrictions, handoffs or resume.

## V. Conclusion

Prefer loopback HTTP. Both options passed the Copilot trial, while loopback HTTP has one request transport, no child process, no protocol adapter and extension-owned shutdown. Its TCP port accepts connection attempts from local processes, but strict loopback binding, a short-lived nonce, Host and Origin validation, and resource limits provide concrete controls for that exposure.

This recommendation depends on adding loopback support to the shared in-process MCP package rather than maintaining a copied server in this extension. The package already contains the MCP-over-HTTP routing and session machinery, so the remaining work is a contained listener and lifecycle change. Neither option should expose the full CoR workflow without the approval, window-binding and secret-handling work above.
