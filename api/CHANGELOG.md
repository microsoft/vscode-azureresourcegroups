
# Change Log
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/).

## Unreleased

## [3.1.0] - 2025-11-10

* Add optional receiver method to the type definition for `AzureExtensionApi`.

## [3.0.0] - 2025-10-06

* Package is now a combined CJS+ESM package.
* VSCode engine version of ^1.105.0 has been added. Adopts finalized authentication challenge typings.

## [2.6.3] - 2025-09-22

* Upgrade vscode typings to 1.104.0 for authentication challenge typings in VS Code.

## [2.6.2] - 2025-09-10

* Adjust to changes in the authentication challenges typings in VS Code.

## [2.6.1] - 2025-08-27

* Adjust to changes in the authentication challenges typings in VS Code.

## [2.6.0] - 2025-08-19

* Support challenges in `AzureAuthentication.getSessionWithScopes`. This relies on the proposed authenticationChallenges VS Code API. https://github.com/microsoft/vscode-azureresourcegroups/issues/1200

## [2.5.1] - 2025-08-06

* Add `DurableTaskHub` resource type

## [2.5.0] - 2025-04-15

* Add `revealWorkspaceResource` function to the resources API.

## [2.4.0] - 2025-02-19

* Add `getRecentlyUsedAzureNodes` to the resources API. You can use this API to get a list of node IDs for nodes recently used/interacted with in the Azure tree view.
* Add `getSelectedAzureNode` to the resources API. You can use this API to get the node ID of the currently selected Azure node in the Azure tree view.

## [2.3.2] - 2024-08-19

* Add "MongoClusters" resource type

## [2.3.1] - 2024-08-06

* Change `getSessionForScopes` to `getSessionWithScopes`

## [2.3.0] - 2024-08-06

* Add `getSessionForScopes` to `AzureAuthentication`

## [2.2.1] - 2024-04-25

* Add "Web PubSub" resource type

## [2.2.0] - 2024-01-30

* Add `getAzExtResourceType` function
* Add "Arc-enabled Machines" resource type

## [2.1.0] - 2023-06-13

* Extend `ViewPropertiesModel` to allow async loading of properties

## [2.0.4] - 2023-02-22

* Polish README

## [2.0.3] - 2023-02-01

* Add README containing API documentation

## [2.0.2] - 2023-01-30

Initial release.
