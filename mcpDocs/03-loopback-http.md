# 3. Authenticated loopback HTTP

## I. Introduction

The current implementation sends HTTP over a Unix socket. This experiment changes that connection to HTTP over TCP. It gives the server an ordinary HTTP URL whose address starts with `127.0.0.1`, which points back to the same machine. The server still runs inside the VS Code extension host, not as another executable.

## II. Hypothesis

Copilot should connect using this URL and a temporary secret, then call a test command and open the existing Next Steps screen. Requests without the correct secret must be rejected without running tools. Stopping the server must prevent further access through the old connection settings.

## III. Investigation

The extension registers an MCP server definition provider when the experiment is enabled. Unlike the current implementation, this provider does not return a placeholder definition or a callback that VS Code must invoke to start the server. It returns no server definition until the user trusts the folder and approves starting the server in that window.

After approval, the extension starts the loopback server itself. The operating system assigns an available local TCP port. Once the server is listening and authentication is active, the extension notifies VS Code that its definitions changed. The provider then returns the already-running server's complete URL and temporary authentication secret. In other words, the extension starts the server first and publishes its endpoint afterward.

The server checks the requested host and any Origin header, which identifies the website making a browser request. It also limits request sizes and connections. It exposes only a window-identification command and `open_scaffold_next_steps_view`. The implementation adapts the installed package 1.0.0's Hono HTTP server with its MIT license, not the archived project's older Express code.

Fifteen automated checks passed against real HTTP connections, with test substitutes for VS Code's provider API. They covered tool requests, denied access, cancellation, multiple connections and shutdown. In the original real Copilot Chat trial, the model called the command once and received the correct window identifier. After a separate approval, it opened the actual Next Steps screen once. Missing or wrong secrets returned HTTP 401, meaning unauthorized, and ran no tools. The Stop command closed the server. These results supported the hypothesis. We did not click the screen's debugging or deployment buttons.

The September 13 follow-up attempted to test Local after the launch scripts had been cleaned up. The test trusted the folder but did not complete VS Code's confirmation to start the server. No server started, no connection settings were published and no tool ran. Local remains untested, not failed; there was no new Copilot trial either. A separate extension test using an MCP client instead of Chat also stopped at approval. The earlier Copilot result belongs to its earlier build. That trial also showed that VS Code retained the secret in generated configuration after Stop, although it no longer allowed access.

## IV. Diagram of what we built

![After user approval, the extension starts a local TCP server; Copilot sends HTTP requests to its /mcp path](https://raw.githubusercontent.com/microsoft/vscode-azureresourcegroups/c02e2730e18553ad2d5e698be2684d35a0196b26/mcpDocs/assets/03-loopback-http.png)

For example, `POST http://127.0.0.1:54321/mcp` carries a JSON-RPC `tools/call` request. Port 54321 is illustrative; `/mcp` is the real path. The server calls CoR through ordinary JavaScript functions and returns the result over HTTP. There is no second network connection inside the extension.

## V. Conclusion

HTTP worked with Copilot without a stdio bridge process, but Local still needs a completed trial. In [microfish91-mcp-loopback-http-prototype](ghapp://sessions/53f75341-2a00-4057-a1a8-a0ea4ac64317), a local worktree not published to origin, BEFORE `493135aef262a62ebf0079348659da69fcd74930` is the follow-up code; AFTER `f546e0d5190241b2acbfda046132a48f4b240639` adds only `docs/mcp-http-dual-harness-result.md`.
