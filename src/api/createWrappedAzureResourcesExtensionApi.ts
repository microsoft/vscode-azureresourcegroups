/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import { AzureResourcesApiInternal } from '../hostapi.v2.internal';
import { wrapFunctionsInTelemetry, wrapFunctionsInTelemetrySync } from '../utils/wrapFunctionsInTelemetry';

export function createWrappedAzureResourcesExtensionApi(api: AzureResourcesApiInternal, extensionId: string): AzureResourcesApiInternal {
    const wrapOptions = {
        callbackIdPrefix: 'api.',
        beforeHook: (context: IActionContext) => {
            context.telemetry.properties.callingExtensionId = extensionId;
            context.telemetry.properties.apiVersion = api.apiVersion;
        }
    };

    return Object.freeze({
        apiVersion: api.apiVersion,
        activity: wrapFunctionsInTelemetry({
            registerActivity: api.activity.registerActivity.bind(api) as typeof api.activity.registerActivity,
        }, wrapOptions),
        resources: {
            azureResourceTreeDataProvider: api.resources.azureResourceTreeDataProvider,
            workspaceResourceTreeDataProvider: api.resources.workspaceResourceTreeDataProvider,
            ...wrapFunctionsInTelemetry({
                revealAzureResource: api.resources.revealAzureResource.bind(api) as typeof api.resources.revealAzureResource,
            }, wrapOptions),
            ...wrapFunctionsInTelemetrySync({
                registerAzureResourceBranchDataProvider: api.resources.registerAzureResourceBranchDataProvider.bind(api) as typeof api.resources.registerAzureResourceBranchDataProvider,
                registerAzureResourceProvider: api.resources.registerAzureResourceProvider.bind(api) as typeof api.resources.registerAzureResourceProvider,
                registerWorkspaceResourceProvider: api.resources.registerWorkspaceResourceProvider.bind(api) as typeof api.resources.registerWorkspaceResourceProvider,
                registerWorkspaceResourceBranchDataProvider: api.resources.registerWorkspaceResourceBranchDataProvider.bind(api) as typeof api.resources.registerWorkspaceResourceBranchDataProvider,
            }, wrapOptions),
        }
    });
}
