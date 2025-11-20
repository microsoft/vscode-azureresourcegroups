# Change Log

## 0.11.7 - 2025-11-18

### Changed
* [[1306]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1306) Update Azure AI Foundry branding to Microsoft Foundry
* [[1286]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1286) Rename "Azure Cosmos DB for MongoDB (vCore)" to "Azure DocumentDB"

## 0.11.6 - 2025-11-03
This release improves on Azure Activity Log integration with Copilot, giving users the ability to custom select which activities to provide as context before starting new chat sessions. Users can now select activities through the general entry-point in the activity log header ribbon, right-clicking individual activities directly, or interacting with an activity's inline context menu button. In addition, Copilot buttons have been upgraded to the newer chat icon.

![Activity Log Multi-Select with Copilot](https://github.com/microsoft/vscode-azureresourcegroups/blob/main/resources/changelog/0.11.6/activityLogMultiSelect.png)

### Added
* [[1214](https://github.com/microsoft/vscode-azureresourcegroups/pull/1214)] Enable activity item selection when providing context to Copilot; update Copilot icons

### Changed
* [[1267](https://github.com/microsoft/vscode-azureresourcegroups/pull/1267)] Optimize auth record export

### Fixed
* [[1277](https://github.com/microsoft/vscode-azureresourcegroups/pull/1277)] [[1279](https://github.com/microsoft/vscode-azureresourcegroups/pull/1279)] Update auth package to eliminate event loops in /azure

## 0.11.5 - 2025-10-14
### Added
* [[1256]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1256) Add button to chat stand in to disable `enableChatStandIn` setting

### Changed
* [[1260]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1260) Adopt the finalized auth challenges API
* [[1257]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1257) Convert `@microsoft/vscode-azureresources-api` from CJS to CJS+ESM, and update for finalization of auth challenges API

### Fixed
* [[1261]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1261) Ensure tree item id uniqueness for user-assigned identity source resource items

## 0.11.4 - 2025-09-25
### Added
* [[1247]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1247) Enable `authenticationChallenges` proposed API

## 0.11.3 - 2025-09-25
### Added
* [[1191]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1191) Resources API: Add `DurableTaskHub` resource type

### Changed
* [[1233]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1233) Changes were made to support the upcoming multi-factor authentication requirements for Azure

## 0.11.2 - 2025-09-15
### Added
* [[1229](https://github.com/microsoft/vscode-azureresourcegroups/pull/1229)] Add support for new Azure resource types


## 0.11.1 - 2025-07-31
### Added
* [[1177](https://github.com/microsoft/vscode-azureresourcegroups/pull/1177)] Add Copilot telemetry and log VS Code command IDs for `GetAzureActivityLog` LM tool

### Changed
* [[1187](https://github.com/microsoft/vscode-azureresourcegroups/pull/1187)] Only show the live timer when running `createResourceGroup`
* [[1181](https://github.com/microsoft/vscode-azureresourcegroups/pull/1181)] Change the sparkle icon to the Copilot icon
* [[1180](https://github.com/microsoft/vscode-azureresourcegroups/pull/1180)] Improve error handling when resolving branch resources

## 0.11.0 - 2025-07-02
### Overview
This release brings Copilot integration to the Azure activity log. Users can now leverage Copilot to gain insights from the Azure activity log by clicking the new sparkle icon in the top right corner. Additionally, client extensions can now provide enhanced context to the shared Azure Resources activity log using `ActivityAttributes`, allowing them to incrementally contribute detailed command data and metadata. This enables Copilot to deliver more relevant and informative responses for users.

- Example of Copilot integration in the Azure activity log:
![Activity Log with Sparkle Icon](https://github.com/microsoft/vscode-azureresourcegroups/blob/main/resources/changelog/0.11.0/activityLogWithCopilot.png)

- Example of Copilot chat with Azure activity log context:
![Copilot Chat with Activity Log Context](https://github.com/microsoft/vscode-azureresourcegroups/blob/main/resources/changelog/0.11.0/copilotChatWithActivityContext.png)

### Added
* [[1162](https://github.com/microsoft/vscode-azureresourcegroups/pull/1162)] Incorporate `ActivityAttributes` for use as Copilot context
* [[1160](https://github.com/microsoft/vscode-azureresourcegroups/pull/1160)] Hook up Copilot for the activity log and expose basic commands

### Changed
* [[1163](https://github.com/microsoft/vscode-azureresourcegroups/pull/1163)] Only show timer in the Azure Activity log when deleting a resource group

## 0.10.13 - 2025-06-12
* [[1157](https://github.com/microsoft/vscode-azureresourcegroups/pull/1157)] Remove Preview from stand-in chat participant name

## 0.10.12 - 2025-06-10

### Added
* [[1145](https://github.com/microsoft/vscode-azureresourcegroups/pull/1145)] Add support for exporting the authentication record

## 0.10.11 - 2025-05-13

### Overview
This release improves real-time activity progress and expands support for AI Foundry projects, enabling a new project type within the Azure Resources view.

### Added
* [[1119](https://github.com/microsoft/vscode-azureresourcegroups/pull/1119)] Add **live timer** to activities in the **Activity Log**.
* [[1135](https://github.com/microsoft/vscode-azureresourcegroups/pull/1135)] Support new type of **AI Foundry** projects.

## 0.10.10 - 2025-04-30

### Overview
This release makes it easier to explore your Azure resources as `ActivityItem` nodes now expand automatically to show child activities. Install the AI Foundry extension with one click from the `Azure AI Foundry` node in the Azure Resources view.

### Added
* [[1108](https://github.com/microsoft/vscode-azureresourcegroups/pull/1108)] Add `revealWorkspaceResource` function to expose resources in **Workspaces**.
* [[1114](https://github.com/microsoft/vscode-azureresourcegroups/pull/1114)] Enable installing the **AI Foundry** extension.
* [[1125](https://github.com/microsoft/vscode-azureresourcegroups/pull/1125)] Make initial collapsible state for `ActivityItem` **expanded** to support `ActivityItem` children.

### Removed
* [[1105](https://github.com/microsoft/vscode-azureresourcegroups/pull/1105)] Removed obsolete **`mongoClusters` feature flag**.

### Fixed
* [[1128](https://github.com/microsoft/vscode-azureresourcegroups/pull/1128)] Updated **subscription IDs context** handling.

## 0.10.9 - 2025-03-24

## Fixed
* [[#1084](https://github.com/microsoft/vscode-azureresourcegroups/pull/1084)] Fix duplicate id issue for Install extension tree items
* [[#1092](https://github.com/microsoft/vscode-azureresourcegroups/pull/1092)] Fix icon and publisher for Azure AI Foundry
* [[#1093](https://github.com/microsoft/vscode-azureresourcegroups/pull/1093)] Revert "Updated Disambiguations to improve intent detection for `@azure`"
*  [[#1096](https://github.com/microsoft/vscode-azureresourcegroups/pull/1096)] Fix outdated string in cloud shell logs
* [[#1098](https://github.com/microsoft/vscode-azureresourcegroups/pull/1098)] Fix Managed Identity target service icons not showing up

## 0.10.8 - 2025-03-10

### Changed
* [[1076](https://github.com/microsoft/vscode-azureresourcegroups/pull/1076)] Automatically collect subscription and resource information for telemetry. [How to disable telemetry reporting](https://code.visualstudio.com/docs/supporting/FAQ#_how-to-disable-telemetry-reporting)

## 0.10.7 - 2025-03-05

### Added
* [[1058]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1058) Add Ask azure walkthrough step

### Changed
* [[1061]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1061) Updated Disambiguations to improve intent detection for `@azure`
* [[1036]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1036) Improve managed identity view

### Fixed
*  [[1036]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1036) Fix slow loading time for Azure Resources view

## 0.10.6 - 2025-02-20

### Added
* [[1037]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1037) Add an Ask @azure command to command palette
* [[1052]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1052) Add v2 resources API for getting selected resource and recently used resources

## 0.10.5 - 2025-02-14

### Added
[[1031]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1031) Allow service and target resources to openInPortal and add tooltips to role definitions
[[1034]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1034) Implement stand-in chat provider for `@azure`
[[1035]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1035) Create fake ask azure command

## 0.10.4 - 2025-01-28

### Fixed
[[1026]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1026) Add 10 second delay before checking for GitHub Copilot for Azure to prevent notification from appearing when the extension is installing

## 0.10.3 - 2025-01-22

### Added
[[1015]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1015) Add integration for Azure AI Foundry VS Code extension
[[1014]](https://github.com/microsoft/vscode-azureresourcegroups/pull/1014) Add Durable Task Scheduler resource type

## 0.10.2 - 2025-01-09

### Fixed
* [[1369]](https://github.com/microsoft/vscode-azurestorage/issues/1369) Could not find $web blob container when deploying to static website via Azure Storage

## 0.10.1 - 2024-12-31

### Fixed
* [[4335]](https://github.com/microsoft/vscode-azurefunctions/issues/4355) Fixed issue that impacted Azure Function deployment due to tree items not being found if the account id had a slash in it.


## 0.10.0 - 2024-12-30

### What's new

#### Accounts & Tenants view
This view allows user to manage their accounts and tenants. By checking and unchecking tenants, subscriptions within the Resources view and subscription filter will be filtered out.

<img width = "900" alt = "Accounts & Tenants view" src = "https://github.com/user-attachments/assets/d34c1f79-fb21-46f9-af3a-cbb109ba0414">

### Added
* [[869]](https://github.com/microsoft/vscode-azureresourcegroups/pull/869) Accounts & Tenants view
* [[926]](https://github.com/microsoft/vscode-azureresourcegroups/pull/926) Shortcut to switching to sovereign clouds
* [[979]](https://github.com/microsoft/vscode-azureresourcegroups/pull/979) An "Add account" button

## 0.9.9 - 2024-11-05
# Fixed
* Minor fixes for VS Code for the Web - Azure

## 0.9.8 - 2024-10-29
### Added
* [[944]](https://github.com/microsoft/vscode-azureresourcegroups/pull/944) Add VS Code for the web - Azure walkthrough
* [[942]](https://github.com/microsoft/vscode-azureresourcegroups/pull/942) Add an install toast for the new GitHub Copilot for Azure extension

### Engineering
* [[945]](https://github.com/microsoft/vscode-azureresourcegroups/pull/945) Add cloud shell telemetry

## 0.9.7 - 2024-10-09
### Fixed
* [[934]](https://github.com/microsoft/vscode-azureresourcegroups/pull/934) Add feature to scope select subscriptions prompt by tenant

## 0.9.6 - 2024-09-30
### Fixed
* [[927]](https://github.com/microsoft/vscode-azureresourcegroups/pull/927) Fix Cloud Shell in sovereign clouds
* [[931]](https://github.com/microsoft/vscode-azureresourcegroups/pull/931) Fix Cloud Shell launch error on macOS caused by external bash shell script

### Engineering
* [[918]](https://github.com/microsoft/vscode-azureresourcegroups/pull/918) Improvements to error masking handling

## 0.9.5 - 2024-09-11
### Fixed
* [[905]](https://github.com/microsoft/vscode-azureresourcegroups/issues/905) [[917]](https://github.com/microsoft/vscode-azureresourcegroups/issues/917) [[915]](https://github.com/microsoft/vscode-azureresourcegroups/pull/915) Fixes a `subscription could not be found` issue that sometimes appears when loading resources

### Engineering
* [[919]](https://github.com/microsoft/vscode-azureresourcegroups/pull/919) Update release pipeline to support signing
* [[913]](https://github.com/microsoft/vscode-azureresourcegroups/pull/913) Upgrade packages for additional telemetry updates

## 0.9.4 - 2024-08-28
### Added
* [[894]](https://github.com/microsoft/vscode-azureresourcegroups/pull/894) Add staged support for MongoClusters

## 0.9.3 - 2024-08-20

Skipped due to failed marketplace release

## 0.9.2 - 2024-08-08

### Added
* [[891]](https://github.com/microsoft/vscode-azureresourcegroups/pull/891) Add `createCredentialsForScopes` to `ISubscriptionContext` for creating tokens with a specified set of scopes

### Fixed
* [[890]](https://github.com/microsoft/vscode-azureresourcegroups/pull/890) Fix tree item descriptions that used temporary descriptions
* [[883]](https://github.com/microsoft/vscode-azureresourcegroups/pull/883) Resolve resources with a `promise.allSettle` instead of async for loop to improve performance
* [[876]](https://github.com/microsoft/vscode-azureresourcegroups/pull/876) Fixed Azure view keybind for Windows OS

## 0.9.1 - 2024-05-28

### Added

* [[864]](https://github.com/microsoft/vscode-azureresourcegroups/pull/864) Enable long running tests through Azure federated credentials.
Learn how to configure the credentials [here](https://github.com/microsoft/vscode-azuretools/blob/main/auth/AzureFederatedCredentialsGuide.md).

## 0.9.0 - 2024-05-14

In [preparation of the Azure Account extension being deprecated at the end of the year](https://github.com/microsoft/vscode-azure-account/issues/964), we've moved the Azure Cloud Shell feature to the Azure Resources extension. Apart from moving codebases, the feature is the same from a users perspective. Authentication for the Cloud Shell feature is now handled by the VS Code built-in Microsoft authentication provider, which means you may have to login upon first use of the migrated feature.

Additionally, we've fixed two longstanding Azure Cloud Shell bugs that caused issues launching the feature on Linux and macOS: [#719](https://github.com/microsoft/vscode-azure-account/issues/719) and [#959](https://github.com/microsoft/vscode-azure-account/issues/959).

### Added

* [[848]](https://github.com/microsoft/vscode-azureresourcegroups/pull/848) Migrate Azure Cloud Shell feature from the Azure Account extension

### Fixed

* [[855]](https://github.com/microsoft/vscode-azureresourcegroups/pull/855) Stop using `--ms-enable-electron-run-as-node` flag to fix launching Cloud Shell on macOS
* [[854]](https://github.com/microsoft/vscode-azureresourcegroups/pull/854) Use `process.execPath` instead of `process.argv0` to fix launching Cloud Shell on Linux

## 0.8.6 - 2024-04-25

### Added
* [[777]](https://github.com/microsoft/vscode-azureresourcegroups/pull/777) Add Azure Web Pub Sub service to the resources view.

## 0.8.5 - 2024-04-17

### Fixed
* [[820]](https://github.com/microsoft/vscode-azureresourcegroups/pull/820) Fix bug that prevents resource groups from loading when there's a ghost resource
* [[825]](https://github.com/microsoft/vscode-azureresourcegroups/pull/825) Throw a better error for any item that resolves as undefined

### Engineering

* [[829]](https://github.com/microsoft/vscode-azureresourcegroups/pull/829) Add `listSubscriptions` method to v1 Resource Groups API to support [4402](https://github.com/microsoft/vscode-azurefunctions/pull/4042)
* [[836]](https://github.com/microsoft/vscode-azureresourcegroups/pull/836) Add maintainCloudShellConnection command

## 0.8.4 - 2024-02-07

### Added
* [[747]](https://github.com/microsoft/vscode-azureresourcegroups/pull/747) Add Azure Arc-enabled machines to the resources view. See the new [Azure Arc-enabled machines extension](https://github.com/microsoft/vscode-azurearcenabledmachines) for more details.

### Fixed
* [[811]](https://github.com/microsoft/vscode-azureresourcegroups/pull/811) Update walkthrough sign in command to use the new built-in authentication provider

## 0.8.3 - 2023-12-14

### Fixed
* Fix zip deploy failing with a "Number of entries expected in End Of Central Directory" error
* Fix soverign cloud support

## 0.8.2 - 2023-12-13

### Fixed
* Fix zip deploy on sovereign clouds (Azure Functions and Azure App Service)

## 0.8.1 - 2023-12-13

### Fixed
* Fix support for sovereign clouds

Note: Make sure to set `microsoft-sovereign-cloud.environment` to the correct environment when using a sovereign cloud.

## 0.8.0 - 2023-11-16

### Move to built-in VS Code authentication

The Azure Resources extension now uses the [built-in VS Code Microsoft authentication provider](https://github.com/microsoft/vscode/tree/main/extensions/microsoft-authentication) to authenticate with Azure, and no longer depends on the [Azure Account extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.azure-account). This move increases the reliability of Azure authentication, especially when using a proxy.

### What's new?

##### How to Sign In

Sign in by selecting the "Sign in to Azure..." item in the Azure Resources view.

> Note: Sessions won't be migrated from Azure Account to the new built-in authentication. This means you will have to sign in once Azure Resources updates to v0.8.0.

<img width="379" alt="Sign in" src="https://github.com/microsoft/vscode-azureresourcegroups/assets/12476526/cd86687c-9a9f-4d0b-b8dc-7eef071d657a">

You can also sign in using the new "Azure: Sign In" command contributed by the Azure Resources extension. Note: make sure you don't mistake it for the old Azure Account "Azure: Sign In" command.

<img width="471" alt="Sign in using command palette" src="https://github.com/microsoft/vscode-azureresourcegroups/assets/12476526/4e9dbd3b-86aa-4d83-80f0-055286e9f460">

##### How to Sign Out

Sign out in the Accounts menu located in the bottom left of your VS Code window.

<img width="568" alt="Sign out with Accounts menu" src="https://github.com/microsoft/vscode-azureresourcegroups/assets/12476526/9a83119a-bf4b-45dd-9ddd-02ba3bf61746">

##### Filter Subscriptions

You can filter the displayed subscriptions just as before, by selecting the Filter icon on any subscription. Previously filtered subscriptions will not be migrated automatically.

<img width="546" alt="Filter subscriptions" src="https://github.com/microsoft/vscode-azureresourcegroups/assets/12476526/d57712cf-276f-41c1-8264-3974543d1ae6">

The filtered subscriptions are stored in the new `azureResourceGroups.selectedSubscriptions` setting.

##### Sign In to a Specific Directory/Tenant

Use the new "Sign in to Directory" command to sign in to directories that cannot be automatically authenticated to on initial sign in. This is useful for directories/tenants that require MFA. Executing this command will show a menu with a list of unauthenticated directories. If the list is empty, then sessions exist for each directory already.

#### Azure Account extension

The Azure Account extension will be deprecated in the future. Azure Account is used by many partner extensions still, so this will be a slow process. Our team will develop a deprecation plan and a reasonable date.

Until the Azure Account extension is removed as a dependency on all the Azure extensions, it will still be installed. However, it's no longer used by the extensions so signing in using the old commands will not work with the Azure Resources extension. For example, the "Azure: Sign in with Device Code", "Azure: Sign In", and "Azure: Sign Out" commands are all Azure Account specific commands, and are no longer integrated with Azure Resources.

<img width="603" alt="Azure Account commands" src="https://github.com/microsoft/vscode-azureresourcegroups/assets/12476526/7b795a82-689d-43ab-a925-e19ceef30a29">

Also, the Azure Account status bar may appear if another extension still uses Azure Account for authentication. Just know that this status bar item is no longer connected to Azure Resources, and won't reflect the authentication state of our extensions.

<img width="374" alt="Azure Account status bar item" src="https://github.com/microsoft/vscode-azureresourcegroups/assets/12476526/b2633aec-d66a-4f52-879d-66be6ca9066a">

### Engineering
* [[#718]](https://github.com/microsoft/vscode-azureresourcegroups/pull/718) Migrate to Track 2 SDK
* [[#721]](https://github.com/microsoft/vscode-azureresourcegroups/pull/721) Refactor Azure grouping
* [[#707]](https://github.com/microsoft/vscode-azureresourcegroups/pull/707) Use the new shared authentication provider package
* [[#742]](https://github.com/microsoft/vscode-azureresourcegroups/pull/742) Add `ArcEnabledServers` resource to `AzExtResourceType` enum
* [[#735]](https://github.com/microsoft/vscode-azureresourcegroups/pull/735) Support icons next to create commands in quick pick

## 0.7.5 - 2023-05-18

### Fixed
* Do not depend on the Azure Account extension on VS Code for web.

## 0.7.4 - 2023-05-18

### Added
* Focus feature v2 by @alexweininger in https://github.com/microsoft/vscode-azureresourcegroups/pull/679

### Fixed
* Fix compatibility issue in `BranchDataItemCache` by @alexweininger in https://github.com/microsoft/vscode-azureresourcegroups/pull/678

## 0.7.3 - 2023-05-16

### Added
* Support for Logic Apps by @ccastrotrejo in https://github.com/microsoft/vscode-azureresourcegroups/pull/670

### Fixed
* Fail to deploy the project by clicking "Deploy" button from the notification by @alexweininger in https://github.com/microsoft/vscode-azureresourcegroups/pull/664

### Removed
* Disable resource group walkthrough by @esweet431 in https://github.com/microsoft/vscode-azureresourcegroups/pull/672

## 0.7.2 - SKIPPED

## 0.7.1 - 2023-04-05

### Fixed
* Fix missing resource icons on Windows by @nturinski in [#658](https://github.com/microsoft/vscode-azureresourcegroups/pull/658)

### Engineering
* Enable strict mode and update typings by @alexweininger in [#656](https://github.com/microsoft/vscode-azureresourcegroups/pull/656)

## 0.7.0 - 2023-04-03

### Added
* VS Code for the Web support. Manage all of your Azure resources in your browser! @nturinski in https://github.com/microsoft/vscode-azureresourcegroups/pull/611

### Fixed
* Refresh subscription instead of group by @alexweininger in https://github.com/microsoft/vscode-azureresourcegroups/pull/618
* Don't throw if resource group isn't found by @alexweininger in https://github.com/microsoft/vscode-azureresourcegroups/pull/622
* Throw a no resource found error if there are no resource groups by @nturinski in https://github.com/microsoft/vscode-azureresourcegroups/pull/638
* Fix createClient issue by @alexweininger in https://github.com/microsoft/vscode-azureresourcegroups/pull/642

### Changed
* Change message of create resource group by @nturinski in https://github.com/microsoft/vscode-azureresourcegroups/pull/637

### Dependencies
* Update azuretools packages for various fixes by @nturinski in https://github.com/microsoft/vscode-azureresourcegroups/pull/632

### Engineering
* Make Azure resource provider mockable by @alexweininger in https://github.com/microsoft/vscode-azureresourcegroups/pull/650
* Add API tests by @alexweininger in https://github.com/microsoft/vscode-azureresourcegroups/pull/563


**Full Changelog**: https://github.com/microsoft/vscode-azureresourcegroups/compare/v0.6.2...v0.7.0

## 0.6.2 - 2023-03-22

### Changed
* Prepare for [Azure Spring Apps VS Code extension](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-azurespringcloud) integration by @wangmingliang-ms in [#605](https://github.com/microsoft/vscode-azureresourcegroups/pull/605)

## 0.6.1 - 2023-02-29

### Fixed
* Support Azure Account extension versions < 0.10.0 [#596](https://github.com/microsoft/vscode-azureresourcegroups/issues/596) fixed by @alexweininger in [#597](https://github.com/microsoft/vscode-azureresourcegroups/pull/597)
* Infinite prompts when running commands [#598](https://github.com/microsoft/vscode-azureresourcegroups/issues/598) fixed by @alexweininger in [#599](https://github.com/microsoft/vscode-azureresourcegroups/pull/599)

### Engineering
* Update dependencies with `npm audit fix` by @alexweininger in [#593](https://github.com/microsoft/vscode-azureresourcegroups/pull/593)

## 0.6.0 - 2023-02-22

### Azure Resources API v2

We've made significant improvements and changes to the Azure Resources API, which is now on version 2.0.0. Find out more about the Azure Resources API v2 [here](https://github.com/microsoft/vscode-azureresourcegroups/tree/main/api#readme).

### Added
- Azure Resources API v2 by @alexweininger, @bwateratmsft, and @philliphoff in [#535](https://github.com/microsoft/vscode-azureresourcegroups/pull/535)
- Create package for consuming extension API by @alexweininger in [#530](https://github.com/microsoft/vscode-azureresourcegroups/pull/530)
- Add Spring Apps icon by @alexweininger in [#484](https://github.com/microsoft/vscode-azureresourcegroups/pull/484)

### Changed
- Use Azure codicon by @alexweininger in [#476](https://github.com/microsoft/vscode-azureresourcegroups/pull/476)
- Update minimum required version of VS Code to 1.66 by @alexweininger in [#523](https://github.com/microsoft/vscode-azureresourcegroups/pull/523)
- Dedupe Azure resources by @alexweininger in [#527](https://github.com/microsoft/vscode-azureresourcegroups/pull/527)

### Removed
- Focus a group feature.

### Fixed
- Fix default app to deploy by @alexweininger in [#586](https://github.com/microsoft/vscode-azureresourcegroups/pull/586)

### Dependencies
- Bump json-schema from 0.2.3 to 0.4.0 by @dependabot in [#384](https://github.com/microsoft/vscode-azureresourcegroups/pull/384)
- Bump markdown-it and vsce by @dependabot in [#385](https://github.com/microsoft/vscode-azureresourcegroups/pull/385)
- Remove dependency on fs-extra. by @philliphoff in [#410](https://github.com/microsoft/vscode-azureresourcegroups/pull/410)
- Bump loader-utils from 1.4.0 to 1.4.1 by @dependabot in [#424](https://github.com/microsoft/vscode-azureresourcegroups/pull/424)
- Bump ansi-regex by @dependabot in [#428](https://github.com/microsoft/vscode-azureresourcegroups/pull/428)
- Bump minimatch and mocha by @dependabot in [#429](https://github.com/microsoft/vscode-azureresourcegroups/pull/429)
- Bump loader-utils from 1.4.1 to 1.4.2 by @dependabot in [#433](https://github.com/microsoft/vscode-azureresourcegroups/pull/433)
- Bump decode-uri-component from 0.2.0 to 0.2.2 by @dependabot in [#443](https://github.com/microsoft/vscode-azureresourcegroups/pull/443)
- Bump qs from 6.5.2 to 6.5.3 by @dependabot in [#450](https://github.com/microsoft/vscode-azureresourcegroups/pull/450)
- Bump json5 from 1.0.1 to 1.0.2 by @dependabot in [#480](https://github.com/microsoft/vscode-azureresourcegroups/pull/480)
- Use `@vscode/vsce` instead of `vsce` by @alexweininger in [#548](https://github.com/microsoft/vscode-azureresourcegroups/pull/548)

## 0.5.6 - 2022-09-08

### Added
- Azure Container Apps extension view to the Resources explorer

### Fixed
- Fix Workspace view loadMore [#357](https://github.com/microsoft/vscode-azureresourcegroups/pull/357)
- Throw NoResourceFoundError [#354](https://github.com/microsoft/vscode-azureresourcegroups/pull/354)

## 0.5.5 - 2022-07-27

### Changed
- Minimum version of VS Code is now 1.65.0 [#346](https://github.com/microsoft/vscode-azureresourcegroups/pull/346)

### Fixed
- When subscription or group is refreshed, refresh the children as well [#339](https://github.com/microsoft/vscode-azureresourcegroups/pull/339)
- Resources are not re-resolved after installing extensions [#280](https://github.com/microsoft/vscode-azureresourcegroups/issues/280)
- Fix displaying Logic Apps as Function Apps [#332](https://github.com/microsoft/vscode-azureresourcegroups/pull/332)
- Unable to load resources when using Azure Stack [#296](https://github.com/microsoft/vscode-azureresourcegroups/issues/296)

[All closed issues](https://github.com/microsoft/vscode-azureresourcegroups/milestone/15?closed=1)

## 0.5.4 - 2022-07-06

### Added
- Open walkthrough tree item to help view [#321](https://github.com/microsoft/vscode-azureresourcegroups/pull/321)

### Changed
- Make Resources and Workspace view visible by default [#310](https://github.com/microsoft/vscode-azureresourcegroups/pull/310)
- Make location of "Edit Tags..." context menu item consistent [#313](https://github.com/microsoft/vscode-azureresourcegroups/pull/313)
- Update @vscode/extension-telemetry to 0.6.2 [#317](https://github.com/microsoft/vscode-azureresourcegroups/pull/317)

### Fixed
- Resources are not sorted alphabetically in the list when executing commands from command palette [#299](https://github.com/microsoft/vscode-azureresourcegroups/issues/299)
- The confirmation message is inconsistent when deleting a resource group from context menu and command palette [#308](https://github.com/microsoft/vscode-azureresourcegroups/issues/308)
- Cannot select multiple files and folders at once for an attached storage account [#300](https://github.com/microsoft/vscode-azureresourcegroups/issues/300)
- Extra "select subscription" step when creating a resource group by right clicking a subscription [#304](https://github.com/microsoft/vscode-azureresourcegroups/issues/304)

## 0.5.3 - 2022-06-09

### Fixed
- Element is already registered error when expanding group tree items [#264](https://github.com/microsoft/vscode-azureresourcegroups/issues/264)

## 0.5.2 - 2022-06-01

### Changed
- Update @vscode/extension-telemetry to 0.5.2 [#290](https://github.com/microsoft/vscode-azureresourcegroups/pull/290)

## 0.5.1 - 2022-05-26

### Fixed
- Error: Element is already registered when focusing/unfocusing groups [#284](https://github.com/microsoft/vscode-azureresourcegroups/issues/284)

## 0.5.0 - 2022-05-24

### Added
- Resources explorer to create and manage Azure resources.
- Workspace explorer to create and manage your local project files and deploy.
- View all of your recent activities and quickly access resources you've recently created in the new Activity Log panel
- Focus on a specific group in the Resources explorer
- Group resources by Type, Resource Group, ARM Tag, and Location in the Resources explorer
- "Get started with Azure in VS Code" walkthrough

### Changed
- Minimum version of VS Code is now 1.57.0

## 0.4.0 - 2021-05-13

### Changed
- Azure view icon to match new Azure Portal
- Icons updated to match VS Code's theme. Install new product icon themes [here](https://marketplace.visualstudio.com/search?term=tag%3Aproduct-icon-theme&target=VSCode)
- Delete resource group confirmation includes number of resources that will be deleted

### Fixed
- [Bugs fixed](https://github.com/microsoft/vscode-azureresourcegroups/milestone/8?closed=1)


## 0.3.0 - 2021-02-22

### Added
- "Help and Feedback" view

### Changed
This extension will be depended on by other Azure extensions, so the following changes were made:
- "Resource Groups" view is now collapsed by default to reduce clutter
- Changed some naming from "Resource Groups" to "Resources" to be more generic

### Fixed
- [Bugs fixed](https://github.com/Microsoft/vscode-azureresourcegroups/issues?q=is%3Aissue+milestone%3A%220.3.0%22+is%3Aclosed)

## 0.2.0 - 2020-06-16

### Added
- Edit tags

### Fixed
- [Bugs fixed](https://github.com/Microsoft/vscode-azureresourcegroups/issues?q=is%3Aissue+milestone%3A%220.2.0%22+is%3Aclosed)

## 0.1.0 - 2020-03-17

### Added
- View, create, and delete Azure Resource Groups
