/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandlingSync, IActionContext } from '@microsoft/vscode-azext-utils';
import { AzureResourcesApiInternal } from '../../../hostapi.v2.internal';

export function createWrappedAzureResourcesApi(api: AzureResourcesApiInternal, extensionId: string): AzureResourcesApiInternal {

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
            azureResourcesTreeDataProvider: api.resources.azureResourcesTreeDataProvider,
            workspaceResourcesTreeDataProvider: api.resources.workspaceResourcesTreeDataProvider,
            ...wrap({
                registerAzureResourceBranchDataProvider: api.resources.registerAzureResourceBranchDataProvider.bind(api) as typeof api.resources.registerAzureResourceBranchDataProvider,
                registerAzureResourceProvider: api.resources.registerAzureResourceProvider.bind(api) as typeof api.resources.registerAzureResourceProvider,
                registerWorkspaceResourceProvider: api.resources.registerWorkspaceResourceProvider.bind(api) as typeof api.resources.registerWorkspaceResourceProvider,
                registerWorkspaceResourceBranchDataProvider: api.resources.registerWorkspaceResourceBranchDataProvider.bind(api) as typeof api.resources.registerWorkspaceResourceBranchDataProvider,
            }),
        }
    });
}

interface WrapFunctionsInTelemetryOptions {
    /**
     * Called before each function is executed. Intended for adding telemetry properties.
     */
    beforeHook?(context: IActionContext): void;
    /**
     * Optionally add a prefix to all function callbackIds.
     */
    callbackIdPrefix?: string;
}

function wrapFunctionsInTelemetry<TFunctions extends Record<string, (...args: unknown[]) => unknown>>(functions: TFunctions, options?: WrapFunctionsInTelemetryOptions): TFunctions {
    const wrappedFunctions = {};

    Object.entries(functions).forEach(([functionName, func]) => {
        wrappedFunctions[functionName] = (...args: Parameters<typeof func>): ReturnType<typeof func> => {
            return callWithTelemetryAndErrorHandlingSync((options?.callbackIdPrefix ?? '') + functionName, context => {
                context.errorHandling.rethrow = true;
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.suppressReportIssue = true;
                options?.beforeHook?.(context);
                return func(args);
            });
        }
    });

    return wrappedFunctions as TFunctions;
}
