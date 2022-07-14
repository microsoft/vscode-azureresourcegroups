/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, IAzureQuickPickItem, IWizardOptions } from '@microsoft/vscode-azext-utils';
import { AppResource, PickAppResourceOptions } from '@microsoft/vscode-azext-utils/hostapi';
import { BranchDataProviderManager } from '../../../tree/v2/providers/BranchDataProviderManager';
import { ApplicationResourceProviderManager } from '../providers/ApplicationResourceProviderManager';
import { ApplicationResource, Filter, ResourceModelBase } from '../v2AzureResourcesApi';
import { ContextValueFilter } from './ContextValueFilter';
import { QuickPickAppResourceWizardContext } from './QuickPickAppResourceWizardContext';
import { RecursiveQuickPickStep } from './RecursiveQuickPickStep';

export class QuickPickAppResourceStep<TModel extends ResourceModelBase> extends AzureWizardPromptStep<QuickPickAppResourceWizardContext<TModel>> {
    public constructor(
        private readonly resourceProviderManager: ApplicationResourceProviderManager,
        private readonly branchDataProviderManager: BranchDataProviderManager,
        private readonly filter?: Filter<AppResource> | Filter<AppResource>[],
        private readonly options?: PickAppResourceOptions
    ) {
        super();
    }

    public override async prompt(wizardContext: QuickPickAppResourceWizardContext<TModel>): Promise<void> {
        const allResources = (await this.resourceProviderManager.getResources( /* TODO: subscription */)) || [];

        const matchingResources = allResources.filter(this.matchesAppResource);
        const picks = matchingResources.map(r => this.getQuickPickItem(r));

        const selected = await wizardContext.ui.showQuickPick(picks, { /* TODO: options */ });
        wizardContext.applicationResource = selected.data;

        const bdp = this.branchDataProviderManager.getApplicationResourceBranchDataProvider(wizardContext.applicationResource);
        wizardContext.currentNode = await Promise.resolve(bdp.getResourceItem(wizardContext.applicationResource)) as TModel;
    }

    public shouldPrompt(_wizardContext: QuickPickAppResourceWizardContext<TModel>): boolean {
        return true;
    }

    public async getSubWizard(wizardContext: QuickPickAppResourceWizardContext<TModel>): Promise<IWizardOptions<QuickPickAppResourceWizardContext<TModel>> | undefined> {
        if (this.options?.expectedChildContextValue) {
            if (new ContextValueFilter(this.options.expectedChildContextValue).matches(wizardContext.currentNode as TModel)) {
                return undefined;
            }

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const bdp = this.branchDataProviderManager.getApplicationResourceBranchDataProvider(wizardContext.applicationResource!);
            return {
                hideStepCount: true,
                promptSteps: [
                    new RecursiveQuickPickStep(bdp, new ContextValueFilter(this.options.expectedChildContextValue)),
                ],
            };
        }

        return undefined;
    }

    private getQuickPickItem(resource: ApplicationResource): IAzureQuickPickItem<ApplicationResource> {
        return {
            label: resource.name,
            data: resource,
        };
    }

    private matchesAppResource(resource: ApplicationResource): boolean {
        if (!this.filter) {
            return true;
        }

        const filterArray = Array.isArray(this.filter) ? this.filter : [this.filter];
        return filterArray.some((filter) => filter.matches(resource));
    }
}
