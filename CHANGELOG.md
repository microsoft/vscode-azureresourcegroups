# Change Log

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
