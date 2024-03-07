# Azure Resources for Visual Studio Code (Preview)



View and manage Azure resources directly from VS Code.

![Resources explorer](resources/readme/resourcesExplorer.png)

> Sign up today for your free Azure account and receive 12 months of free popular services, $200 free credit and 25+ always free services 👉 [Start Free](https://azure.microsoft.com/free/open-source).

### Move to built-in VS Code authentication

The Azure Resources extension now uses the [built-in VS Code Microsoft authentication provider](https://github.com/microsoft/vscode/tree/main/extensions/microsoft-authentication) to authenticate with Azure, and no longer depends on the [Azure Account extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.azure-account). This move increases the reliability of Azure authentication, especially when using a proxy.

#### How to Sign In

Sign in by selecting the "Sign in to Azure..." item in the Azure Resources view.

> Note: Sessions won't be migrated from Azure Account to the new built-in authentication. This means you will have to sign in once Azure Resources updates to v0.8.0.

<img width="379" alt="Sign in" src="https://github.com/microsoft/vscode-azureresourcegroups/assets/12476526/cd86687c-9a9f-4d0b-b8dc-7eef071d657a">

You can also sign in using the new "Azure: Sign In" command contributed by the Azure Resources extension. Note: make sure you don't mistake it for the old Azure Account "Azure: Sign In" command.

<img width="471" alt="Sign in using command palette" src="https://github.com/microsoft/vscode-azureresourcegroups/assets/12476526/4e9dbd3b-86aa-4d83-80f0-055286e9f460">

#### How to Sign Out

Sign out in the Accounts menu located in the bottom left of your VS Code window.

<img width="568" alt="Sign out with Accounts menu" src="https://github.com/microsoft/vscode-azureresourcegroups/assets/12476526/9a83119a-bf4b-45dd-9ddd-02ba3bf61746">

#### Filter Subscriptions

You can filter the displayed subscriptions just as before, by selecting the Filter icon on any subscription. Previously filtered subscriptions will not be migrated automatically.

<img width="546" alt="Filter subscriptions" src="https://github.com/microsoft/vscode-azureresourcegroups/assets/12476526/d57712cf-276f-41c1-8264-3974543d1ae6">

The filtered subscriptions are stored in the new `azureResourceGroups.selectedSubscriptions` setting.

#### Sign In to a Specific Directory/Tenant

Use the new "Sign in to Directory" command to sign in to directories that cannot be automatically authenticated to on initial sign in. This is useful for directories/tenants that require MFA. Executing this command will show a menu with a list of unauthenticated directories. If the list is empty, then sessions exist for each directory already.

#### Using Sovereign Clouds

To connect to a sovereign cloud, set the `microsoft-sovereign-cloud.environment` setting.

## Support for [vscode.dev](https://vscode.dev/)

The Azure Resources extension fully supports running on [vscode.dev](https://vscode.dev/) and [github.dev](http://github.dev/). This means you can use the Azure Resources extension to manage your Azure resources directly from your browser! Note that this does not require the Azure Accounts extension and uses VS Code's built-in authentication provider.

## Features

### Resource and Workspace views

Use the Resources explorer to create and manage Azure resources. Use the Workspace explorer to create files and deploy.

![Azure explorer](resources/readme/explorerGraphic.png)

### Grouping

Change the way resources are grouped to fit your workflow.

![Grouping](resources/readme/groupingGraphic.png)

### Activity Log

View all of your recent activities and quickly access resources you've recently created in the Activity Log.

![Activity Log](resources/readme/activityLogGraphic.png)

### Create Resources

Create an Azure resource from your installed extensions directly in VS Code.

![Create Resource](resources/readme/createResourceGraphic.png)

## Azure Extensions

Install these extensions to enable additional resource-specific features.

* [Azure Functions](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azurefunctions)
* [Azure App Service](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azureappservice)
* [Azure Static Web Apps](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azurestaticwebapps)
* [Azure Databases](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb)
* [Azure Storage](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azurestorage)
* [Azure Virtual Machines](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azurevirtualmachines)
* [Azure Spring Apps](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-azurespringcloud)
* [Azure Logic Apps](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azurelogicapps)



## Telemetry

VS Code collects usage data and sends it to Microsoft to help improve our products and services. Read our [privacy statement](https://go.microsoft.com/fwlink/?LinkID=528096&clcid=0x409) to learn more. If you don’t wish to send usage data to Microsoft, you can set the `telemetry.enableTelemetry` setting to `false`. Learn more in our [FAQ](https://code.visualstudio.com/docs/supporting/faq#_how-to-disable-telemetry-reporting).

## License

[MIT](LICENSE.md)
