# 0. Current implementation

This describes the existing `feat/CoR` implementation. Copilot on Rails tools run inside the Azure Resource Groups extension. VS Code's **Local** chat client reaches them by sending MCP requests as HTTP over a private Unix socket.

## How the server is registered

During extension activation, the extension registers an MCP server definition provider. The provider initially returns a definition with a placeholder HTTP address. It also registers a resolution callback that describes how to start the server.

When Local resolves that definition, the callback starts the in-process server on a private Unix socket. It then replaces the placeholder with the real socket address and temporary authentication secret. In other words, the extension registers how to start the server before the server is running.

## How Local starts the server and calls a tool

![Local starts the extension's server through a callback, then sends HTTP requests over a Unix socket](https://raw.githubusercontent.com/microsoft/vscode-azureresourcegroups/c02e2730e18553ad2d5e698be2684d35a0196b26/mcpDocs/assets/00-current-local-flow.png)

For example, these settings describe HTTP over a socket:

```text
Server address: unix:/.../mcp.sock#/mcp
Socket path:    /.../mcp.sock
HTTP request:   POST http://localhost/mcp
Authorization: Nonce <secret>
```

## What happens with the same code under Copilot harness

Copilot uses its own MCP client rather than borrowing Local's connection. VS Code forwards the registered settings.

The inspected forwarding code does **not** call the provider's startup callback. That leaves Copilot with the placeholder address instead of the running server's socket address and secret.

![With Copilot selected, the inspected code forwards the placeholder without starting the private server](https://raw.githubusercontent.com/microsoft/vscode-azureresourcegroups/c02e2730e18553ad2d5e698be2684d35a0196b26/mcpDocs/assets/00-current-copilot-flow.png)
