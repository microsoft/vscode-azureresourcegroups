import { AzureWizard, callWithTelemetryAndErrorHandling, IActionContext, nonNullValue } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { BranchDataProviderManager } from '../../tree/v2/providers/BranchDataProviderManager';
import { ApplicationResourceProviderManager } from './providers/ApplicationResourceProviderManager';
import { QuickPickAppResourceStep } from './quickPickWizard/QuickPickAppResourceStep';
import { QuickPickAppResourceWizardContext } from './quickPickWizard/QuickPickAppResourceWizardContext';
import { QuickPickSubscriptionStep } from './quickPickWizard/QuickPickSubscriptionStep';
import { getLastNode } from './quickPickWizard/QuickPickWizardContext';
import { ApplicationResource, ApplicationResourceProvider, BranchDataProvider, ResourcePickOptions, V2AzureResourcesApi, WorkspaceResource, WorkspaceResourceProvider } from './v2AzureResourcesApi';

export class V2AzureResourcesApiImplementation implements V2AzureResourcesApi {
    constructor(
        private readonly branchDataProviderManager: BranchDataProviderManager,
        private readonly resourceProviderManager: ApplicationResourceProviderManager) {
    }

    get apiVersion(): string {
        return '2.0.0';
    }

    async pickResource<TModel>(options: ResourcePickOptions): Promise<TModel> {
        return await callWithTelemetryAndErrorHandling<TModel>('pickResource', async (actionContext: IActionContext) => {
            const promptSteps = [
                new QuickPickSubscriptionStep(),
                new QuickPickAppResourceStep(this.resourceProviderManager, this.branchDataProviderManager, options),
            ];

            const wizardContext: QuickPickAppResourceWizardContext<TModel> = {
                ...actionContext,
                pickedNodes: [],
                applicationSubscription: undefined,
                applicationResource: undefined,
            };

            const wizard = new AzureWizard(wizardContext, { hideStepCount: true, promptSteps, title: 'TODO' /* TODO: title */ });
            await wizard.execute();

            return nonNullValue(getLastNode<TModel>(wizardContext), 'lastNode');
        }) as TModel;
    }

    revealResource(_resourceId: string): Promise<void> {
        throw new Error("Method not implemented.");
    }

    registerApplicationResourceProvider(_id: string, provider: ApplicationResourceProvider): vscode.Disposable {
        this.resourceProviderManager.addResourceProvider(provider);

        return new vscode.Disposable(() => this.resourceProviderManager.removeResourceProvider(provider));
    }

    registerApplicationResourceBranchDataProvider<T>(id: string, provider: BranchDataProvider<ApplicationResource, T>): vscode.Disposable {
        this.branchDataProviderManager.addApplicationResourceBranchDataProvider(id, provider);

        return new vscode.Disposable(() => this.branchDataProviderManager.removeApplicationResourceBranchDataProvider(id));
    }

    registerWorkspaceResourceProvider(_id: string, _provider: WorkspaceResourceProvider): vscode.Disposable {
        throw new Error("Method not implemented.");
    }

    registerWorkspaceResourceBranchDataProvider<T>(_id: string, _provider: BranchDataProvider<WorkspaceResource, T>): vscode.Disposable {
        throw new Error("Method not implemented.");
    }
}
