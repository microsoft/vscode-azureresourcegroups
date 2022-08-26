import { callWithTelemetryAndErrorHandling, IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { BranchDataProviderManager } from '../../../tree/v2/providers/BranchDataProviderManager';
import { ApplicationResourceProviderManager } from '../providers/ApplicationResourceProviderManager';
import { ApplicationSubscription, ResourceModelBase } from "../v2AzureResourcesApi";
import { QuickPickAppResourceStep } from './QuickPickAppResourceStep';
import { QuickPickSubscriptionStep } from './QuickPickSubscriptionStep';

type GetChildren<TModel extends ResourceModelBase> = (element: TModel) => vscode.ProviderResult<TModel[]>;
type GetResourceItem<TResource, TModel extends ResourceModelBase> = (element: TResource) => TModel | Thenable<TModel>;
type GetTreeItem<TModel extends ResourceModelBase> = (element: TModel) => vscode.ProviderResult<vscode.TreeItem>;

class TreeItemPickerDataProvider<TResource, TModel extends ResourceModelBase> {
    constructor(branchDataProviderManager: BranchDataProviderManager)
}


type TreeItemPickerDataProvider<TModel> = Pick<vscode.TreeDataProvider<TModel>, 'getChildren' | 'getTreeItem'>;

export class TreeItemPicker {
    constructor(
        private readonly dataProvider: TreeItemPickerDataProvider<ResourceModelBase>,
        private readonly getSubscriptions: () => Promise<ApplicationSubscription[]>,
        private readonly getResources: ApplicationResourceProviderManager['getResources']
    ) { }

    public async pickResource<TModel extends ResourceModelBase>(): Promise<TModel> {
        return await callWithTelemetryAndErrorHandling<TModel>('pickResource', async (actionContext: IActionContext) => {

            const promptSteps = [
                new QuickPickSubscriptionStep(),
                new QuickPickAppResourceStep(this.getResources, this.branchDataProviderManager, options.filter, options),
            ];

            const wizardContext: QuickPickAppResourceWizardContext<TModel> = {
                ...actionContext,
                pickedNodes: [],
                applicationSubscription: undefined,
                applicationResource: undefined,
            };

            const wizard = new AzureWizard(wizardContext, { hideStepCount: true, promptSteps, title: 'TODO' /* TODO: title */ });
            await wizard.prompt();
            await wizard.execute();

            return nonNullValue(getLastNode<TModel>(wizardContext), 'lastNode');
        }) as TModel;
    }

}
