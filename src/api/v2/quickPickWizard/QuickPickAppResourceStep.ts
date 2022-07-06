/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, IAzureQuickPickItem, IWizardOptions } from '@microsoft/vscode-azext-utils';
import { PickAppResourceOptions } from '@microsoft/vscode-azext-utils/hostapi';
import { BranchDataProviderManager } from '../../../tree/v2/providers/BranchDataProviderManager';
import { ApplicationResourceProviderManager } from '../providers/ApplicationResourceProviderManager';
import { ApplicationResource, ResourceModelBase } from '../v2AzureResourcesApi';
import { QuickPickAppResourceWizardContext } from './QuickPickAppResourceWizardContext';
import { RecursiveQuickPickStep } from './RecursiveQuickPickStep';

export class QuickPickAppResourceStep<TModel extends ResourceModelBase> extends AzureWizardPromptStep<QuickPickAppResourceWizardContext<TModel>> {
    public constructor(
        private readonly resourceProviderManager: ApplicationResourceProviderManager,
        private readonly branchDataProviderManager: BranchDataProviderManager,
        private readonly options: PickAppResourceOptions
    ) {
        super();
    }

    public async prompt(wizardContext: QuickPickAppResourceWizardContext<TModel>): Promise<void> {
        const allResources = (await this.resourceProviderManager.getResources( /* TODO: subscription */)) || [];

        const matchingResources = allResources.filter(this.matchesAppResource);
        const picks = matchingResources.map(r => this.getQuickPickItem(r));

        const selected = await wizardContext.ui.showQuickPick(picks, { /* TODO: options */ });
        wizardContext.applicationResource = selected.data;
    }

    public shouldPrompt(_wizardContext: QuickPickAppResourceWizardContext<TModel>): boolean {
        return true;
    }

    public async getSubWizard(wizardContext: QuickPickAppResourceWizardContext<TModel>): Promise<IWizardOptions<QuickPickAppResourceWizardContext<TModel>> | undefined> {
        if (this.options.expectedChildContextValue) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const bdp = this.branchDataProviderManager.getApplicationResourceBranchDataProvider(wizardContext.applicationResource!);
            return {
                hideStepCount: true,
                promptSteps: [
                    new RecursiveQuickPickStep(bdp, this.options.expectedChildContextValue),
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
        if (!this.options.filter) {
            return true;
        }

        const filterArray = Array.isArray(this.options.filter) ? this.options.filter : [this.options.filter];

        return filterArray.some(filter => {
            if (filter.type.toLowerCase() !== resource.type.toLowerCase()) {
                return false;
            }

            if (filter.kind && filter.kind.toLowerCase() !== resource.kind?.toLowerCase()) {
                return false;
            }

            if (filter.tags) {
                for (const tag of Object.keys(filter.tags)) {
                    if (filter.tags[tag] !== resource.tags?.[tag]) {
                        return false;
                    }
                }
            }

            return true;
        })
    }
}
