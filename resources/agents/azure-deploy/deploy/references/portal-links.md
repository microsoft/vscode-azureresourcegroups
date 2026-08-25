# Portal Links — Not Shown in Chat

⛔ **The agent never prints an Azure portal URL in chat.** Do NOT generate, auto-open, or print any portal link — not a deployment-status link (`DeploymentDetailsBlade` / `DeploymentDetails.MenuView`) during deploy, and not a resource-group overview link at handoff.

- Do NOT run `Start-Process` on a portal URL.
- Do NOT print a portal URL (deploy status OR resource-group overview) in chat.
- Do NOT re-emit a link when healing changes the deployment name.

The **deploy result view** surfaces the Azure portal URL (resource-group overview) at the end, rendered from the session artifacts (`deploy-result.json` / `context.json.azure`). The agent's job is to write those artifacts correctly — the view handles the portal URL.
