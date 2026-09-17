# 1. Direct private socket

## I. Introduction

CoR's MCP server already runs inside the VS Code extension-host process. It receives HTTP requests through a Unix socket, a local communication channel addressed by a filesystem path rather than a TCP port. This experiment asked whether Copilot could use that same connection once it had the real address, without adding a stdio bridge process or TCP listener.

## II. Hypothesis

Give Copilot the address of a running server and the secret required to access it. Copilot should then be able to list the tools, call a test command and open CoR's existing Next Steps screen. If it rejects the address before connecting, supplying the address alone is not enough.

## III. Investigation

The [current implementation](00-current-implementation.md#what-happens-with-the-same-code-under-copilot) returns a placeholder until VS Code calls its server-start callback, a step the Copilot forwarding path skips. We changed the connection-settings provider to start the server itself, check that the socket accepted connections, then return the real address and an Authorization header containing a temporary secret. Only two tools were registered: `prototype_instance` to identify the receiving VS Code window, and `open_scaffold_next_steps_view` to open the existing Next Steps screen. The experiment required a trusted local folder and exposed no deployment actions.

The automated tests were controls for this experiment. A test program that understands Unix sockets sent real MCP requests to the prototype's server. It checked that valid calls reached the expected tool, missing secrets were rejected and shutdown stopped further access. Test functions stood in for VS Code commands, so these checks did not open a real screen. All twelve groups passed. Separately, VS Code's Local MCP client connected to the prototype and listed both tools, without a model calling them. These controls confirmed the server worked with a compatible client; they did not test Copilot's connector.

The real Copilot trial tested that remaining question. VS Code forwarded the ready address, `unix:/.../mcp.sock#/mcp`, and secret, but Copilot reported `invalid MCP server URL: invalid format`. The server was running; Copilot established no MCP session and neither tool ran. This proves that publishing a real address succeeded, and disproves the hypothesis that this change alone enables direct access on the tested runtime. It does not rule out every socket format or future runtime. The experiment is valuable because it separates a working server from a client-connection failure: further work belongs in address handling or socket support, not CoR tools or weaker authentication.

## IV. Diagram of what we built

![Copilot receives a real socket address but rejects it before sending any HTTP request](assets/01-direct-socket.png)

[SVG source](assets/01-direct-socket.svg)

The diagram shows the real Copilot trial, not the successful controls. Blue arrows deliver the socket address and secret; the crossed arrow marks rejection before connection. In `unix:/.../mcp.sock#/mcp`, the part before `#` identifies the socket and `/mcp` is the HTTP path. No Copilot request reached the server's authentication checks or CoR code.

## V. Conclusion

First inspect Copilot's address parser and test any supported alternative format with an actual MCP call, since accepting a URL does not prove the client can open its socket. If HTTP-over-Unix-socket support is missing, pursuing this route requires a change in Copilot itself, a release carrying it, and testing across supported versions and operating systems. Fixing VS Code's skipped startup callback would not add that socket support; the existing ready-address implementation remains available as uncommitted code in [microfish91-mcp-prototype-1-direct-socket](ghapp://sessions/a7a6f6a0-1163-4410-af48-92f0bcd860df), a local worktree not published to origin.
