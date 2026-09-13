# Same stdio provider in Local and Copilot

Verified on 2026-09-13 against baseline
`db498b0e60aa5d306bafcd8b248fe4a8618d23e1`. The worktree was clean before the trial.
This evidence-only follow-up changes no implementation, tests or launcher.

**The same current stdio definition worked with both real chat clients.**
`src/mcp/stdioPrototype/register.ts` publishes one `McpStdioServerDefinition`
through `vscode.lm.registerMcpServerDefinitionProvider`, without a client-specific
registration or alternate HTTP definition. It uses the VS Code extension-host
executable with `ELECTRON_RUN_AS_NODE=1` and `ELECTRON_NO_ASAR=1`.

| Client | Real model invocation | Probe result | Existing Next steps view |
| --- | --- | --- | --- |
| Local, Auto selected Gemini 3.6 Flash | Pass | Correct instance, count 3 | Opened, one additional call |
| Copilot Agent Host, Auto selected GPT-5.6 Terra | Pass | Same instance, count 4 | Opened, one additional call |

The companion's preceding SDK control accounted for probe counts 1 and 2 and one
view call. Local then added exactly one probe effect and one view call. Its view
was closed before the fresh Copilot trial, which added exactly one of each again.
The declaration counter stayed at 1. Backend sessions created increased from 1
for the control to 2 for Local and 3 for Copilot, all on the same listener instance.

Local's footer identified Local. Its Update Tools action discovered both tools,
then the model called `cor_stdio_probe` and `open_scaffold_next_steps_view`.
Copilot connected ready at 08:22:02 and invoked the same tools through its
`Azure-Resources-stdio-prototype-` namespace. Both clients required separate
normal approvals. No workflow buttons, Azure operations or substitute tools ran.

Runtime: macOS arm64, VS Code 1.137.0 commit
`645f29cc3176500b4b5762ba887cf2a7f0ffdf2c`, extension-host Node 24.18.1,
installed Copilot `1.0.84-canary.70.gdb75d0d.unsigned`,
Copilot SDK `1.0.13-preview.4`. This is the installed dependency set, not a claim
about every stock VS Code release.

The existing development companion ran in an authorized isolated profile and new
disposable workspace, without `--extensionTestsPath` or copied credentials.
Only the fixture was trusted. All owned processes stopped afterward; the pairing
file was removed, CDP closed, and the old socket refused connections.

TBD outside this trial: full CoR tools and agent allowlists, simultaneous
conflicting workflow operations, standalone CLI, other runtime versions,
Windows and remote environments. See [the reproduction guide](mcp-stdio-prototype.md).
