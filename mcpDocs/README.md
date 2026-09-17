# Giving Copilot access to CoR tools

Copilot on Rails, or CoR, is the Azure Resource Groups extension's guided project-creation, debugging and deployment flow. Its chat tools can open VS Code screens and run extension actions. MCP, the Model Context Protocol, lets a chat agent request those actions.

VS Code Chat offers two ways to run an agent, **Local** and **Copilot**. They use different MCP clients. The question is how Copilot's client can reach tools that already run inside the extension, without moving those tools into another program.

A Node stdio bridge process let both clients use the existing server. Giving the server an ordinary local HTTP address also worked with Copilot. Giving Copilot the existing private-socket address did not work on the tested build.

## Who does what

| Diagram label | Meaning |
| --- | --- |
| Copilot Chat | The VS Code interface where the user sends a prompt and approves tools. |
| MCP client | Connects to a server, asks which tools it offers, then requests a tool by name. |
| VS Code MCP registry | Stores connection instructions. It does not carry tool requests. |
| MCP server | Receives tool requests and calls the extension code that handles them. |
| VS Code extension | Runs CoR actions inside the extension-host process, where VS Code runs extensions. |
| JSON-RPC | The JSON message format MCP uses. `tools/call` means "run this named tool." |

HTTP describes how requests are exchanged. A Unix socket or TCP supplies the connection underneath. These prototypes use HTTP over either kind of connection. The stdio design adds a separate hop through the Node stdio bridge process's standard input and output.

For example, this MCP message requests the Next Steps screen. The same message can travel through stdio or in an HTTP request to `/mcp`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": { "name": "open_scaffold_next_steps_view", "arguments": {} }
}
```

## Current code

[Current implementation reference](00-current-implementation.md) | [Local](#current-local) | [Copilot](#current-copilot) | [Prototype diagrams](#prototypes)

Each diagram labels the communication method on its arrows, including replies. The server is extension code, not another executable. CoR currently prefers Local, though an explicitly selected Copilot chat can still use Copilot.

### Current Local

The extension initially supplies a placeholder address. Before connecting, Local asks the extension's startup callback to replace it with the real socket address and a secret. Local then sends MCP requests as HTTP over that Unix socket, without a TCP port.

![Local asks the extension to start its server, then sends HTTP over a Unix socket](assets/00-current-local-flow.png)

[SVG source](assets/00-current-local-flow.svg)

### Current Copilot

Copilot receives connection settings through VS Code's generated configuration. Code inspection found that this path skips the startup callback, leaving Copilot with the placeholder. This is a prediction from source code. Prototype 1 separately tested a real address and observed a different failure.

![Current Copilot receives only a placeholder because VS Code skips the server-start callback](assets/00-current-copilot-flow.png)

[SVG source](assets/00-current-copilot-flow.svg)

## Prototypes

| Read | How tool requests travel | What happened |
| --- | --- | --- |
| [1. Direct socket](01-direct-socket.md) | Intended: client sends HTTP over the existing Unix socket. | Copilot rejected the address before connecting. |
| [2. Stdio bridge](02-stdio-bridge.md) | Client sends through stdin/stdout to the Node stdio bridge; the bridge sends HTTP over the Unix socket. | Local and Copilot both opened the requested screen. |
| [3. Loopback HTTP](03-loopback-http.md) | Client sends HTTP over TCP to `127.0.0.1`, the same machine. | Copilot worked; Local testing stopped before server enablement. |

[Compare implementation, security and remaining work](04-comparison.md).

### 1. Direct socket

![Copilot receives a real socket address but rejects it before opening a connection](assets/01-direct-socket.png)

[Report](01-direct-socket.md) | [SVG source](assets/01-direct-socket.svg). The server was ready, but no Copilot request reached it.

### 2. Stdio bridge

![Copilot sends through stdin to the Node stdio bridge process, which forwards HTTP over a Unix socket; replies return through stdout](assets/02-stdio-bridge.png)

[Report](02-stdio-bridge.md) | [Security assessment](stdio-bridge-security.md) | [SVG source](assets/02-stdio-bridge.svg). The stdio bridge now runs using VS Code's bundled Node runtime. Both clients passed with it.

### 3. Loopback HTTP

![Copilot sends HTTP over TCP to the same machine, then the server calls CoR code within the extension](assets/03-loopback-http.png)

[Report](03-loopback-http.md) | [SVG source](assets/03-loopback-http.svg). There is no stdio bridge process. The successful Copilot trial predates the final launch-script cleanup.

Native VS Code language-model tools could avoid this MCP connection, but were not built because the requirement is MCP.

## Evidence boundary

These tests exercised two tools, not the full CoR workflow. Original trials ran September 12, 2026, with follow-up on September 13.

| Tested component | Version |
| --- | --- |
| CoR base commit | `feat/CoR` at `5dacef3a7ddbf090717e71dc94d56112a5e4e5be` |
| MCP package | Locked `@microsoft/vscode-inproc-mcp` 1.0.0 |
| Machine | macOS 26.6.2, arm64 |
| VS Code | 1.137.0 at `645f29cc3176500b4b5762ba887cf2a7f0ffdf2c` |
| Installed Copilot / SDK | `1.0.84-canary.70.gdb75d0d.unsigned` / `1.0.13-preview.4` |
| Node | Extension host 24.18.1; original stdio bridge/test runner 22.18.0 |

The installed Copilot differs from the public source's `1.0.83-2`. Results apply to the tested installation.

The MCP package now lives in [vscode-containers](https://github.com/microsoft/vscode-containers/tree/19fa49a6b8a8d4c2680ca2ce1140c0da252394c5/packages/vscode-inproc-mcp), not the archived Docker Extensibility repository. The reports link local prototype branches, not published GitHub branches.

Baseline sources: [package provider](https://github.com/microsoft/vscode-containers/blob/19fa49a6b8a8d4c2680ca2ce1140c0da252394c5/packages/vscode-inproc-mcp/src/vscode/registerMcpHttpProvider.ts#L15-L37), [host forwarding](https://github.com/microsoft/vscode/blob/645f29cc3176500b4b5762ba887cf2a7f0ffdf2c/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostMcpServerSupport.ts#L224-L328).
