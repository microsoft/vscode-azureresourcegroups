# 1. Direct private socket

[Overview](README.md) | [Next: stdio bridge](02-stdio-bridge.md) | [Comparison](04-comparison.md)

## I. Introduction

The existing package already serves MCP over authenticated private HTTP inside the extension host. Publishing its live socket URI directly could let Copilot reach the same server without a helper process, TCP listener or duplicate tool implementation.

## II. Hypothesis

If activation publishes a ready endpoint and authentication header, Copilot's MCP client can initialize, discover two named tools and invoke a fixed VS Code command. A separately approved Next Steps call should open the existing webview. Rejection before initialization would disprove this hypothesis for the supplied URI and tested runtime.

## III. Investigation

The opt-in provider used the package's public `startInProcHttpServer` export. It waited for an unauthorized HTTP response over the socket before publishing the URI and nonce, proving the listener was ready rather than trusting startup return. Concurrent enumeration shared one listener, and Local resolution returned that same endpoint. The narrow catalog contained `prototype_instance` and `open_scaffold_next_steps_view`. Strict inputs, Workspace Trust, the original local folder and extension lifetime constrained execution; no deployment or general command-dispatch tool was exposed.

Twelve Node test groups passed against real private HTTP and MCP transports, with mocked VS Code effects. They covered publication, authentication rejection, fixed dispatch, argument validation, revocation and restart. An earlier Test-mode control also reached Running in VS Code's Local MCP client and discovered both tools. That was connection/discovery evidence, not a Local model invocation or a rendered view. The unchanged-provider control still published its placeholder after resolution, so manually starting Local was not a forwarding fix.

The decisive real Copilot trial used normal Development mode. The live `unix:/.../mcp.sock#/mcp` URI and Authorization header reached the generated configuration, but the connector reported `invalid MCP server URL: invalid format`. Counters recorded provide=1, resolve=0, listener=1, MCP sessions=0, command calls=0 and view calls=0. Publication succeeded; connection did not. This was neither an authentication denial nor a handler failure. The exact parser rule and alternate socket formats remain unresolved, so the result does not establish that every Unix-socket representation or runtime is incompatible.

## IV. Diagram of what we built

![Live private endpoint publication succeeds, then Copilot rejects the URI before MCP connection](assets/01-direct-socket.png)

[SVG source](assets/01-direct-socket.svg)

Unlike the [current Copilot baseline](README.md#current-copilot), this implementation supplied a ready URI, not a placeholder. The diagram stops at the observed rejection. Nonce authentication and owner-only Unix directory access protect the listener; handler checks are in-process controls, not additional network endpoints.

## V. Conclusion

Publishing the ready definition fixed one compatibility gate but did not produce a Copilot connection on the [tested build](README.md#evidence-boundary); keep this as a bounded reproducer, not a viable transport yet. The implementation remains uncommitted in [microfish91-mcp-prototype-1-direct-socket](ghapp://sessions/a7a6f6a0-1163-4410-af48-92f0bcd860df), a local worktree not published to origin.
