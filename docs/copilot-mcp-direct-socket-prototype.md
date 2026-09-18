# Direct socket MCP prototype

This is a throwaway compatibility experiment, not a production migration. It compares the installed
`@microsoft/vscode-inproc-mcp` provider with a provider that publishes a ready private socket. It adds
no TCP listener. Normal extension activation is unchanged unless both development/test mode and
`COR_MCP_DIRECT_SOCKET_PROTOTYPE=baseline|live` select the experiment.

## Run

Use Node 22.18 or newer and the repository's locked dependencies. Run `npm ci` if dependencies are
missing. From this worktree:

```sh
npm run prototype:mcp:direct -- test
npm run prototype:mcp:direct -- baseline
npm run prototype:mcp:direct -- live
```

`test` runs actual MCP HTTP over a private socket with a mocked VS Code API. It does not open VS Code,
contact a model, execute a real extension command, or render a webview.

The other modes build the extension and open a visible Extension Development Host. A generated
development companion under `out/prototype1/bootstrap` activates Azure Resources and opens Chat.
It does not use `--extensionTestsPath`, which suppresses normal dialogs and uses test storage.
Each invocation
uses a new isolated temporary profile, extensions directory and empty fixture unless
`COR_MCP_PROTOTYPE_DATA` specifies an existing isolated data directory. Set that variable to reuse a
test profile after signing in. Never point it at a normal VS Code profile. Choose a short path because
macOS limits Unix socket paths. The script preserves existing profile settings.

`COR_MCP_PROTOTYPE_CODE` can override the Code executable. The macOS default is the installed stable
`/Applications/Visual Studio Code.app/Contents/MacOS/Code`. `COR_MCP_PROTOTYPE_WORKSPACE` can select an
existing disposable fixture. Non-local or multi-root workspaces are refused. The optional
`COR_MCP_PROTOTYPE_CDP_PORT` enables loopback-only browser automation; leave it unset for manual use.
Processes stay attached to the launcher. Close the test window or stop its terminal when finished.

## Manual experiment

1. Trust only the empty disposable fixture in that test window. If prompted, sign in through VS Code's
   normal GitHub flow. The launcher does not copy credentials, change a normal profile, enable
   autopilot, or grant global tool approval.
2. Select **Copilot**, not Local, in Chat. Use the general Agent first, not a bundled CoR agent. Do not
   launch Create New Project with Copilot; its current default-preference writes are outside this test.
3. Enable **Copilot Azure Resources Extension Tools** through Chat's tool configuration if necessary.
   Only `prototype_instance` and `open_scaffold_next_steps_view` may appear in this server. Stop if
   additional tools from this server appear.
4. Send: `Call the MCP tool prototype_instance once with empty input. Do not use the terminal, edit
   files, or call other tools. Return the opaque instance and the exact tool name you used.`
5. Inspect **Output > CoR MCP prototype 1**. A real tool call must produce `identity-command` followed by
   `identity-tool`, with the same instance as the tool response. A plausible model response without
   those events does not count.
6. Only after the canary succeeds, send: `Call open_scaffold_next_steps_view once with empty input.
   Do not run processes, edit files, deploy, or click any next-step buttons.` Confirm a visible
   **Next steps** webview in this same window and `next-steps-open` with `viewCalls: 1`.
   Do not click the local-development or deployment actions.
7. Repeat in a fresh **Local** chat as a control. Keep Local and Copilot results separate.
8. Close this window, switch `baseline` to `live` while reusing the isolated data directory, and
   repeat. Capture exact errors, actual tool namespace and the Agent Host session URI rather than
   inferring them from the server label.

The unchanged baseline helper publishes `http://invalid.invalid` until resolution and publishes it
again on subsequent enumeration. Its live GUI counters are `null` because the public helper does not
expose its callbacks. The Node control captures its provider at the mocked registration boundary and
counts actual `provide` and `resolve` calls. The live provider records these callbacks directly and
starts only one listener per extension lifetime. Its resolver returns the same ready endpoint.

## Evidence and limits

The launcher writes redacted `activation.json` in the isolated data directory. This is an activation
snapshot, not a continuously updated result. Run **Prototype 1: Capture diagnostics** to update it.
Runtime counters are in **Output > CoR MCP prototype 1**;
VS Code logs are under `<data>/u/logs`. Tool events record an opaque extension instance, not an
authenticated Chat identity. The internal test-only commands are
`copilotOnRails.prototype1.instance` and `copilotOnRails.prototype1.diagnostics`. Neither accepts a
command ID, workspace, or arbitrary execution arguments from the model.

The listener is restricted to the original trusted local workspace and extension instance. Both
tools recheck authorization at execution. Inputs must be empty objects. The canary invokes a fixed
VS Code command; the next-steps adapter delegates to the existing CoR tool and checks that its view
controller opened. The controller check is not proof of rendered pixels.

Published headers contain the package's nonce. The prototype never logs them or places them in
workspace configuration, but VS Code may serialize them into its synthetic plugin files. The launcher makes the isolated profile
owner-only because the host may create those files with broader permissions. Treat the
isolated profile as sensitive after sign-in and do not attach it to an issue. Share only reviewed,
redacted logs or screenshots. The package's listener-wide nonce is not a per-chat authorization grant.
Its module-global MCP session map also means multiple independent listeners in one extension host
are not isolation boundaries. This experiment uses one live listener and replaces, rather than
duplicates, the production registrar.

This prototype does not establish standalone CLI, SSH, WSL, container, Windows pipe, multiple-window,
custom-agent allowlist, approval/handoff or deployment compatibility. Test those separately only if
the real Copilot canary succeeds. Existing production webviews and pipeline behavior are unchanged;
no existing guide screenshot needs replacement.

## Main-based copy

Branch `microfish91-mcp-direct-socket-main` ports only the prototype delta from
`b151f53201507bbe603426cf2d92a0cda335969e` onto main at
`d9fbc677d09b7d0c32b2e6e74dabb0787c45bd2f`. The patch applied without conflicts or code adaptations.
The original prototype branch and its `feat/CoR` ancestry are not part of this branch's new history.

In the original GUI trial, the live socket URI reached the tested Copilot, which rejected it for
invalid URL format. That trial did not establish a successful real Copilot canary or webview call.
Checks on this main-based copy are separate evidence, not a rerun or validation of that GUI trial.

Main-copy validation on Node 22.18.0 passed all 12 checks in
`npm run prototype:mcp:direct -- test`, `npm run build` including TypeScript checking, and targeted
`npm run lint --` for all eight changed code files. No GUI trial or Azure operation was run for this copy.
