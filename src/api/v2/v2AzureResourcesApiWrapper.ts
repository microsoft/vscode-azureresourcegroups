import { AzExtResourceType, callWithTelemetryAndErrorHandling, callWithTelemetryAndErrorHandlingSync } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ApplicationResource, ApplicationResourceProvider, BranchDataProvider, ResourceModelBase, V2AzureResourcesApi, WorkspaceResource, WorkspaceResourceProvider } from './v2AzureResourcesApi';

export class V2AzureResourcesApiWrapper implements V2AzureResourcesApi {
    constructor(
        private readonly api: V2AzureResourcesApi,
        private readonly extensionId: string) {
    }

    get apiVersion(): string {
        return this.api.apiVersion;
    }

    revealResource(resourceId: string): Promise<void> {
        return this.callWithTelemetryAndErrorHandling('v2.revealResource', async () => await this.api.revealResource(resourceId));
    }

    registerApplicationResourceProvider(id: string, provider: ApplicationResourceProvider): vscode.Disposable {
        return this.callWithTelemetryAndErrorHandlingSync('v2.registerApplicationResourceProvider', () => this.api.registerApplicationResourceProvider(id, provider));
    }

    registerApplicationResourceBranchDataProvider<T extends ResourceModelBase>(type: AzExtResourceType, provider: BranchDataProvider<ApplicationResource, T>): vscode.Disposable {
        return this.callWithTelemetryAndErrorHandlingSync('v2.registerApplicationResourceBranchDataProvider', () => this.api.registerApplicationResourceBranchDataProvider(type, provider));
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
