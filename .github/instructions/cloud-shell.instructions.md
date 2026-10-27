---
description: 'Preserve Cloud Shell security, child-process isolation, IPC lifecycle, and cross-platform behavior.'
applyTo: "src/cloudConsole/**,src/commands/registerCommands.ts,src/utils/logging/**,test/cloudConsole.test.ts,test/ipc.test.ts,test/nodeFetch.test.ts"
---

# Cloud Shell instructions

## Process and IPC boundaries

- `src/cloudConsole/cloudConsole.ts` runs in the extension host and owns sign-in, tenant/subscription
  selection, Cloud Shell provisioning, terminal profiles, upload, status, and cleanup.
- `src/cloudConsole/cloudShellChildProcess/cloudConsoleLauncher.ts` runs as a Node child process and owns
  terminal stdin/stdout, websocket traffic, resize, keepalive, and IPC polling.
- `cloudShellChildProcess/readJSON.ts` is shared with the child process. Do not add VS Code imports or
  extension-host-only dependencies to either child-process file.
- `src/cloudConsole/ipc.ts` owns random IPC handles, Windows named pipes, Unix sockets, socket path limits,
  request queues, and server disposal.

Keep IPC messages minimal and validate their shape before use. Preserve random handle names, platform
path limits, proxy support, keepalive, terminal close/cancellation cleanup, and
`Connecting -> Connected -> Disconnected` state transitions.

## Credentials, network traffic, and logging

- Access tokens and service-provided console/terminal/socket URIs are sensitive. Never write tokens,
  authorization headers, credentials, websocket payloads, terminal output, uploaded file contents, or
  unredacted service responses to the output channel, telemetry, errors, or tests.
- Keep authorization headers masked in upload, resize, console provisioning, and websocket-related
  diagnostics.
- Use the existing proxy-agent behavior for websocket connections and `fetchWithLogging` for supported
  HTTP calls. Any new normalizer must redact credentials, query secrets, and response bodies before trace
  logging can expose them.
- Treat service responses and IPC JSON as `unknown` and narrow required fields; do not rely on unchecked
  assertions for messages that control connection or process behavior.

## Terminal and upload behavior

- Cloud Shell requires a trusted workspace before starting the child process or uploading a local file.
- Pass child executable and arguments separately. Do not interpolate user-controlled paths, file names,
  tokens, URLs, or commands into shell text.
- Preserve cancellation for terminal profile creation, network requests, and uploads. Dispose listeners,
  streams, requests, servers, and shell entries on every disconnect path.
- Keep Linux/Bash and Windows/PowerShell behavior aligned, including Windows Node discovery and
  macOS/Linux socket handling.

Add focused tests for malformed IPC, proxy/cancellation/disconnect behavior, signed-out accounts,
workspace trust, redaction, and platform-specific path limits.
