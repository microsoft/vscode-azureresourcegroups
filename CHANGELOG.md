# Change Log

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
