import { callWithTelemetryAndErrorHandling, callWithTelemetryAndErrorHandlingSync } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ResourceGroupsItem } from '../../tree/v2/ResourceGroupsItem';
import { ApplicationResource, ApplicationResourceProvider, BranchDataProvider, ResourceModelBase, ResourcePickOptions, V2AzureResourcesApi, WorkspaceResource, WorkspaceResourceProvider } from './v2AzureResourcesApi';

export class V2AzureResourcesApiWrapper implements V2AzureResourcesApi {
    constructor(
        private readonly api: V2AzureResourcesApi,
        private readonly extensionId: string) {
    }

    pickResource2<TModel extends ResourceModelBase>(callback: (resourcesTreeDataProvider: vscode.TreeDataProvider<ResourceGroupsItem>) => Promise<TModel>): Promise<TModel> {
        return this.callWithTelemetryAndErrorHandling<TModel>('v2.pickResource2', async () => await this.api.pickResource2(callback));
    }

    get apiVersion(): string {
        return this.api.apiVersion;
    }

    pickResource<TModel extends ResourceModelBase>(options: ResourcePickOptions): Promise<TModel> {
        return this.callWithTelemetryAndErrorHandling<TModel>('v2.pickResource', async () => await this.api.pickResource(options));
    }

    revealResource(resourceId: string): Promise<void> {
        return this.callWithTelemetryAndErrorHandling('v2.revealResource', async () => await this.api.revealResource(resourceId));
    }

    registerApplicationResourceProvider(id: string, provider: ApplicationResourceProvider): vscode.Disposable {
        return this.callWithTelemetryAndErrorHandlingSync('v2.registerApplicationResourceProvider', () => this.api.registerApplicationResourceProvider(id, provider));
    }

    registerApplicationResourceBranchDataProvider<T extends ResourceModelBase>(id: string, provider: BranchDataProvider<ApplicationResource, T>): vscode.Disposable {
        return this.callWithTelemetryAndErrorHandlingSync('v2.registerApplicationResourceBranchDataProvider', () => this.api.registerApplicationResourceBranchDataProvider(id, provider));
    }

    registerWorkspaceResourceProvider(id: string, provider: WorkspaceResourceProvider): vscode.Disposable {
        return this.callWithTelemetryAndErrorHandlingSync('v2.registerWorkspaceResourceProvider', () => this.api.registerWorkspaceResourceProvider(id, provider));
    }

    registerWorkspaceResourceBranchDataProvider<T extends ResourceModelBase>(id: string, provider: BranchDataProvider<WorkspaceResource, T>): vscode.Disposable {
        return this.callWithTelemetryAndErrorHandlingSync('v2.registerWorkspaceResourceBranchDataProvider', () => this.api.registerWorkspaceResourceBranchDataProvider<T>(id, provider));
    }

    private async callWithTelemetryAndErrorHandling<T>(callbackId: string, func: () => Promise<T>): Promise<T> {
        const response = await callWithTelemetryAndErrorHandling(
            callbackId,
            async context => {
                context.telemetry.properties.callingExtensionId = this.extensionId;
                context.errorHandling.rethrow = true;
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.suppressReportIssue = true;

                return await func();
            });

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return response!;
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
