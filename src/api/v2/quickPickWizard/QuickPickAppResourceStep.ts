/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, IAzureQuickPickItem, IAzureQuickPickOptions, IWizardOptions } from '@microsoft/vscode-azext-utils';
import { BranchDataProviderManager } from '../../../tree/v2/providers/BranchDataProviderManager';
import { ApplicationResourceProviderManager } from '../providers/ApplicationResourceProviderManager';
import { ApplicationResource, Filter, ResourceModelBase } from '../v2AzureResourcesApi';
import { QuickPickAppResourceWizardContext } from './QuickPickAppResourceWizardContext';
import { RecursiveQuickPickStep } from './RecursiveQuickPickStep';

export interface PickAppResourceOptions2 extends IAzureQuickPickOptions {
    /**
     * Set this to pick a child of the selected app resource
     */
    childFilter?: Filter<ResourceModelBase>;

    /**
     * Whether `AppResourceTreeItem`s should be resolved before displaying them as quick picks, or only once one has been selected
     * If a client extension needs to change label/description/something visible on the quick pick via `resolve`, set to true,
     * otherwise set to false. Default will be false.
     */
    resolveQuickPicksBeforeDisplay?: boolean;
}

export class QuickPickAppResourceStep<TModel extends ResourceModelBase> extends AzureWizardPromptStep<QuickPickAppResourceWizardContext<TModel>> {
    public constructor(
        private readonly resourceProviderManager: ApplicationResourceProviderManager,
        private readonly branchDataProviderManager: BranchDataProviderManager,
        private readonly filter?: Filter<ApplicationResource> | Filter<ApplicationResource>[],
        private readonly options?: PickAppResourceOptions2
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
        if (this.options?.childFilter) {
            if (this.options.childFilter?.matches(wizardContext.currentNode as TModel)) {
                return undefined;
            }

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const bdp = this.branchDataProviderManager.getApplicationResourceBranchDataProvider(wizardContext.applicationResource!);
            return {
                hideStepCount: true,
                promptSteps: [
                    new RecursiveQuickPickStep(bdp, this.options.childFilter),
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
