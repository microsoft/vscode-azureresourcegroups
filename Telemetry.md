# Telemetry

| Name | Properties | Measures |
| --- | --- | --- |
| vscode-azureresourcegroups/azureResourceGroups.createProjectWithCopilot | `{"isActivationEvent":"false","result":"Succeeded","isCopilotEvent":"true","corProjectId":"d04d8952-6859-4673-8386-d3aa3e93a9f5","abexp.assignmentcontext":"..."}` | `{"duration":0.025}` |
| vscode-azureresourcegroups/mcpTool/open_requirements_view/execute | `{"isActivationEvent":"false","result":"Succeeded","isCopilotEvent":"true","corProjectId":"d04d8952-6859-4673-8386-d3aa3e93a9f5","copilotSessionId":"8af89484-fa10-4d2a-8b8d-c1e4b86723b2","copilotRequestId":"3","requirementsSelected":"true","abexp.assignmentcontext":"..."}` | `{"duration":0.016}` |
| vscode-azureresourcegroups/mcpTool/open_requirements_view | `{"isActivationEvent":"false","result":"Succeeded","abexp.assignmentcontext":"..."}` | `{"duration":0.017}` |
| vscode-azureresourcegroups/mcpTool/open_plan_view/execute | `{"isActivationEvent":"false","result":"Succeeded","isCopilotEvent":"true","corProjectId":"d04d8952-6859-4673-8386-d3aa3e93a9f5","copilotSessionId":"8af89484-fa10-4d2a-8b8d-c1e4b86723b2","copilotRequestId":"4","abexp.assignmentcontext":"..."}` | `{"duration":0.027}` |
| vscode-azureresourcegroups/mcpTool/open_plan_view | `{"isActivationEvent":"false","result":"Succeeded","abexp.assignmentcontext":"..."}` | `{"duration":0.028}` |
| vscode-azureresourcegroups/azureResourceGroups.autopilot.confirm | `{"isActivationEvent":"false","lastStep":"warningMessage|Approvethisplanandru","result":"Succeeded","abexp.assignmentcontext":"..."}` | `{"duration":1.634}` |
| vscode-azureresourcegroups/mcpTool/start_project_integrate/execute | `{"isActivationEvent":"false","result":"Succeeded","isCopilotEvent":"true","corProjectId":"d04d8952-6859-4673-8386-d3aa3e93a9f5","copilotSessionId":"8af89484-fa10-4d2a-8b8d-c1e4b86723b2","copilotRequestId":"5","abexp.assignmentcontext":"..."}` | `{"duration":0.183}` |
| vscode-azureresourcegroups/mcpTool/start_project_integrate | `{"isActivationEvent":"false","result":"Succeeded","abexp.assignmentcontext":"..."}` | `{"duration":0.183}` |
| vscode-azureresourcegroups/mcpTool/start_local_development/execute | `{"isActivationEvent":"false","result":"Succeeded","isCopilotEvent":"true","corProjectId":"d04d8952-6859-4673-8386-d3aa3e93a9f5","copilotSessionId":"8af89484-fa10-4d2a-8b8d-c1e4b86723b2","copilotRequestId":"6","abexp.assignmentcontext":"..."}` | `{"duration":0.155}` |
| vscode-azureresourcegroups/mcpTool/start_local_development | `{"isActivationEvent":"false","result":"Succeeded","abexp.assignmentcontext":"..."}` | `{"duration":0.155}` |
| vscode-azureresourcegroups/mcpTool/start_azure_debug_generate/execute | `{"isActivationEvent":"false","result":"Succeeded","isCopilotEvent":"true","corProjectId":"d04d8952-6859-4673-8386-d3aa3e93a9f5","copilotSessionId":"8af89484-fa10-4d2a-8b8d-c1e4b86723b2","copilotRequestId":"7","abexp.assignmentcontext":"..."}` | `{"duration":0.159}` |
| vscode-azureresourcegroups/mcpTool/start_azure_debug_generate | `{"isActivationEvent":"false","result":"Succeeded","abexp.assignmentcontext":"..."}` | `{"duration":0.16}` |
| vscode-azureresourcegroups/mcpTool/open_local_next_steps_view/execute | `{"isActivationEvent":"false","result":"Succeeded","isCopilotEvent":"true","corProjectId":"d04d8952-6859-4673-8386-d3aa3e93a9f5","copilotSessionId":"8af89484-fa10-4d2a-8b8d-c1e4b86723b2","copilotRequestId":"8","hasApiTests":"true","abexp.assignmentcontext":"..."}` | `{"duration":0.001}` |
| vscode-azureresourcegroups/mcpTool/open_local_next_steps_view | `{"isActivationEvent":"false","result":"Succeeded","abexp.assignmentcontext":"..."}` | `{"duration":0.003}` |
| vscode-azureresourcegroups/azureResourceGroups.startDeployment | `{"isActivationEvent":"false","result":"Succeeded","isCopilotEvent":"true","corProjectId":"d04d8952-6859-4673-8386-d3aa3e93a9f5","abexp.assignmentcontext":"..."}` | `{"duration":0.203}` |
| vscode-azureresourcegroups/mcpTool/open_deploy_plan_view | `{"isActivationEvent":"false","result":"Succeeded","abexp.assignmentcontext":"..."}` | `{"duration":0.029}` |

## Telemetry and diagnostics:

- Whenever we submit, we should wrap with a command that registers a telemetry event and parse any non-PII work (requirements, scaffold-plan, local-debug-plan)
- Add timestamps to telemetry as well?
- autopilot boolean, make sure we record that it gets inherited with each command
- record refreshing prerequisites (scaffold and local debug)
- record requesting feedback
- which button clicks in next step views, these may need to be separate commands that get invoked for telemetry
- openLocalDevelopmentPlanView

### Good to haves in the future:

- Hooks for knowing the outcomes of Chat things like API testing

## Diagnostics:

- We should cache the prompt for diagnostics
- We should cache the original project creation date for diagnostics

