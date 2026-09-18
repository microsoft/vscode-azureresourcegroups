# MCP transport conclusion

| Prototype | What it is | Worked? |
| --- | --- | --- |
| [Direct private socket](01-direct-socket.md) | Copilot connects directly to the existing HTTP server over its Unix socket. | **No** |
| [Stdio bridge](02-stdio-bridge.md) | Copilot launches a child process that translates stdio MCP messages to HTTP over the existing Unix socket. | **Yes** |
| [Authenticated loopback HTTP](03-loopback-http.md) | Copilot connects directly to the in-process server over authenticated HTTP on `127.0.0.1`. | **Yes** |

## Recommendation

Between the two working prototypes, choose authenticated loopback HTTP. It has no child process or protocol adapter, uses one request transport, and lets the extension directly own startup and shutdown. It also publishes the endpoint only after the server is ready, avoiding the callback-resolution problem in the current implementation.

The stdio bridge works, but it adds another process plus message translation and cleanup logic. Loopback HTTP does expose a local TCP port, so it must remain bound to `127.0.0.1` and retain the temporary secret and request checks described in the [security assessment](03a-loopback-security.md).
