/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from "vscode";

export const resourcesExtensionId: string = 'ms-azuretools.vscode-azureresourcegroups';
export const azureResourceProviderId: string = 'vscode-azureresourcegroups.azureResourceProvider';
export const contributesKey = 'x-azResources';
// every group id has a groupBySetting/value format, so just following it
export const ungroupedId = 'group/ungrouped';
export const showHiddenTypesSettingKey = 'showHiddenTypes';
export const hasFocusedGroupContextKey = 'ms-azuretools.vscode-azureresourcegroups.hasFocusedGroup';
export const canFocusContextValue = 'canFocus';

export const mcpServerId = 'vscode-azureresourcegroups.mcp';
export const mcpServerLabel = l10n.t('Copilot Azure Resources Extension Tools');
