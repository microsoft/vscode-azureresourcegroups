# Comparisons

## Core operations: DiagnosticLogs vs Telemetry

| Core operation | DiagnosticLogs | Telemetry |
| --- | --- | --- |
| createProjectWithCopilot | ✅ ext cmd | ✅ ext cmd |
| requirements view | ✅ ext + mcp | ✅ mcp |
| plan view | ✅ ext + mcp | ✅ mcp |
| project integrate | ✅ ext + mcp | ✅ mcp |
| local development | ✅ ext + mcp | ✅ mcp |
| azure debug generate | ✅ mcp | ✅ mcp |
| local next steps view | ✅ mcp | ✅ mcp |
| deployment | ✅ ext cmd | ✅ ext cmd |
| deploy plan view | ✅ mcp | ✅ mcp |

### Legend

- **ext** — an **extension command**: the `azureResourceGroups.*` VS Code command (`type: "extensionCommand"`).
- **mcp** — an **MCP tool**: the tool exposed to Copilot through the extension's MCP server (`type: "mcpTool"`).
- **ext + mcp** — the operation was recorded via **both** paths in the diagnostic logs (an `extensionCommand` entry *and* an `mcpTool` entry for the same underlying action).

Note: for the four `ext + mcp` operations (requirements view, plan view, project integrate, local development), both paths were invoked, but only the **MCP-tool** path emitted a telemetry event — the extension-command path was silent. That is why the Telemetry column shows just `mcp`.
