# 2. Stdio bridge

[Overview](README.md) | [Previous: direct socket](01-direct-socket.md) | [Next: loopback HTTP](03-loopback-http.md) | [Comparison](04-comparison.md)

## I. Introduction

A stdio bridge gives Copilot a standard MCP connection while retaining the package's private HTTP server. Only the bridge needs to interpret the Unix-socket URI. Named tools, commands and webviews stay inside the VS Code extension host.

## II. Hypothesis

A transport-only child can carry genuine initialization, tool calls, errors and cancellation between Copilot and the existing server without adding TCP or copying handlers. Success requires a real model-driven command and a separately approved webview call, with exactly one effect each.

## III. Investigation

The provider starts one private package listener, checks authenticated readiness and publishes a complete stdio definition through VS Code. The bundled bridge has no `vscode` import or tool catalog. It validates the connection lease and backend instance, then relays SDK stdio messages through socket-aware Streamable HTTP. It preserves results, notifications, sessions and errors rather than synthesizing backend responses. Frame validation, protocol-only stdout, redirect refusal and no uncertain-call replay constrain failure behavior. The two tools are `cor_stdio_probe` and the existing `open_scaffold_next_steps_view`; execution checks retain trust and workspace binding.

Sixteen protocol scenarios passed, including two clients, cancellation, malformed frames, revoked credentials and reconnects. Actual Development-host controls exercised command errors, cancellation and the existing view. The first real Copilot attempt exposed `server/discover` auto-negotiation: the bridge now returns standard method-not-found `-32601`, allowing fallback to genuine backend `initialize`. A regression covers that exchange. Copilot then invoked the marker command and, with separate approval, opened Next Steps. Each produced exactly one additional effect beyond the SDK controls. This supports the hypothesis for the original standalone-Node launcher.

User commit `db498b0e60aa5d306bafcd8b248fe4a8618d23e1` subsequently made activation registration unconditional in a trusted local workspace. The bridge uses `process.execPath`, `ELECTRON_RUN_AS_NODE=1` and `ELECTRON_NO_ASAR=1`. All sixteen scenarios passed with standalone Node 22 and actual Code Helper Node 24. A September 13 follow-up then proved this current definition in real Local and fresh Copilot Chat on the same listener. Each added one marker effect and one actual Next Steps call after normal approvals; declaration count stayed at one. This was sequential use, not concurrent workflow testing. Ordinary F5 needs no prototype flag or separate Node path but does not isolate the profile; `npm run prototype:mcp-stdio` does. The catalog remains two tools, with no production fallback.

## IV. Diagram of what we built

![Current stdio definition, Copilot-owned child launch and authenticated private HTTP relay](assets/02-stdio-bridge.png)

[SVG source](assets/02-stdio-bridge.svg)

The diagram shows the current VS Code-owned Node child, now tested with both clients; the original Chat trial used standalone Node. Registry forwarding is metadata; stdio/private HTTP carry MCP. The one-hour lease is not human consent or per-chat identity.

## V. Conclusion

Stdio works with both clients using one definition; production lifecycle and full-CoR policy remain unfinished. In [microfish91-mcp-prototype-2-stdio-bridge](ghapp://sessions/1c4fcccd-383b-44f6-a3ea-534cdce7777a), a local worktree not published to origin, BEFORE/tested code is `db498b0e` and AFTER `e5384aa6ab60fc729d22705d31c99b46d6764531` adds only `docs/mcp-stdio-dual-harness-results.md`, with no implementation changes.
