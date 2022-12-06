/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType, callWithTelemetryAndErrorHandlingSync } from '@microsoft/vscode-azext-utils';
import { Activity } from '@microsoft/vscode-azext-utils/hostapi';
import { AzureResource, AzureResourceProvider, BranchDataProvider, ResourceGroupsTreeDataProvider, ResourceModelBase, v2AzureResourcesApi, WorkspaceResource, WorkspaceResourceProvider } from '@microsoft/vscode-azext-utils/hostapi.v2';
import * as vscode from 'vscode';

export class V2AzureResourcesApiWrapper implements v2AzureResourcesApi {
    constructor(
        private readonly api: v2AzureResourcesApi,
        private readonly extensionId: string) {
    }

    get apiVersion(): string {
        return this.api.apiVersion;
    }

    get azureResourceTreeDataProvider(): ResourceGroupsTreeDataProvider {
        return this.api.azureResourceTreeDataProvider;
    }

    get workspaceResourceTreeDataProvider(): ResourceGroupsTreeDataProvider {
        return this.api.workspaceResourceTreeDataProvider;
    }

    registerActivity(activity: Activity): Promise<void> {
        return this.callWithTelemetryAndErrorHandlingSync('v2.registerActivity', () => this.api.registerActivity(activity));
    }

    registerAzureResourceProvider(provider: AzureResourceProvider): vscode.Disposable {
        return this.callWithTelemetryAndErrorHandlingSync('v2.registerAzureResourceProvider', () => this.api.registerAzureResourceProvider(provider));
    }

    registerAzureResourceBranchDataProvider<T extends ResourceModelBase>(type: AzExtResourceType, provider: BranchDataProvider<AzureResource, T>): vscode.Disposable {
        return this.callWithTelemetryAndErrorHandlingSync('v2.registerAzureResourceBranchDataProvider', () => this.api.registerAzureResourceBranchDataProvider(type, provider));
    }

    registerWorkspaceResourceProvider(provider: WorkspaceResourceProvider): vscode.Disposable {
        return this.callWithTelemetryAndErrorHandlingSync('v2.registerWorkspaceResourceProvider', () => this.api.registerWorkspaceResourceProvider(provider));
    }

    registerWorkspaceResourceBranchDataProvider<T extends ResourceModelBase>(id: string, provider: BranchDataProvider<WorkspaceResource, T>): vscode.Disposable {
        return this.callWithTelemetryAndErrorHandlingSync('v2.registerWorkspaceResourceBranchDataProvider', () => this.api.registerWorkspaceResourceBranchDataProvider<T>(id, provider));
    }

    private callWithTelemetryAndErrorHandlingSync<T>(callbackId: string, func: () => T): T {
        const response = callWithTelemetryAndErrorHandlingSync(
            callbackId,
            context => {
                context.telemetry.properties.callingExtensionId = this.extensionId;
                context.errorHandling.rethrow = true;
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.suppressReportIssue = true;

                return func();
            });

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return response!;
    }
}
