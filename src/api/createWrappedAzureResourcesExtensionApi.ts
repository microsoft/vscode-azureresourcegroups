/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureResourcesApiInternal } from '../../hostapi.v2.internal';
import { wrapFunctionsInTelemetry } from '../utils/wrapFunctionsInTelemetry';

export function createWrappedAzureResourcesExtensionApi(api: AzureResourcesApiInternal, extensionId: string): AzureResourcesApiInternal {

    function wrap<TFunctions extends Record<string, (...args: unknown[]) => unknown>>(functions: TFunctions): TFunctions {
        return wrapFunctionsInTelemetry(functions, {
            callbackIdPrefix: 'v2.',
            beforeHook: context => context.telemetry.properties.callingExtensionId = extensionId,
        });
    }

    return Object.freeze({
        apiVersion: api.apiVersion,
        activity: wrap({
            registerActivity: api.activity.registerActivity.bind(api) as typeof api.activity.registerActivity,
        }),
        resources: {
            azureResourceTreeDataProvider: api.resources.azureResourceTreeDataProvider,
            workspaceResourceTreeDataProvider: api.resources.workspaceResourceTreeDataProvider,
            ...wrap({
                registerAzureResourceBranchDataProvider: api.resources.registerAzureResourceBranchDataProvider.bind(api) as typeof api.resources.registerAzureResourceBranchDataProvider,
                registerAzureResourceProvider: api.resources.registerAzureResourceProvider.bind(api) as typeof api.resources.registerAzureResourceProvider,
                registerWorkspaceResourceProvider: api.resources.registerWorkspaceResourceProvider.bind(api) as typeof api.resources.registerWorkspaceResourceProvider,
                registerWorkspaceResourceBranchDataProvider: api.resources.registerWorkspaceResourceBranchDataProvider.bind(api) as typeof api.resources.registerWorkspaceResourceBranchDataProvider,
                revealAzureResource: api.resources.revealAzureResource.bind(api) as typeof api.resources.revealAzureResource,
            }),
        }
    });
}
