/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, IAzureQuickPickItem, IWizardOptions, nonNullProp, nonNullValue, parseError } from '@microsoft/vscode-azext-utils';
import { PickAppResourceOptions } from '@microsoft/vscode-azext-utils/hostapi';
import { BranchDataProviderManager } from '../../../tree/v2/providers/BranchDataProviderManager';
import { ApplicationResourceProviderManager } from '../providers/ApplicationResourceProviderManager';
import { ApplicationResource, ResourceModelBase } from '../v2AzureResourcesApi';
import { matchesContextValueFilter } from './ContextValueFilter';
import { QuickPickAppResourceWizardContext } from './QuickPickAppResourceWizardContext';
import { getLastNode } from './QuickPickWizardContext';
import { RecursiveQuickPickStep } from './RecursiveQuickPickStep';

export class QuickPickAppResourceStep<TModel extends ResourceModelBase> extends AzureWizardPromptStep<QuickPickAppResourceWizardContext<TModel>> {
    public constructor(
        private readonly resourceProviderManager: ApplicationResourceProviderManager,
        private readonly branchDataProviderManager: BranchDataProviderManager,
        private readonly options: PickAppResourceOptions
    ) {
        super();
    }

    public override async prompt(wizardContext: QuickPickAppResourceWizardContext<TModel>): Promise<void> {
        try {
            const allResources = (await this.resourceProviderManager.getResources(nonNullProp(wizardContext, 'applicationSubscription'))) || [];

            const matchingResources = allResources.filter(this.matchesAppResource);
            const picks = matchingResources.map(r => this.getQuickPickItem(r));

            const selected = await wizardContext.ui.showQuickPick(picks, { /* TODO: options */ });
            wizardContext.applicationResource = selected.data;

            const bdp = this.branchDataProviderManager.getApplicationResourceBranchDataProvider(wizardContext.applicationResource);
            wizardContext.pickedNodes.push(
                await Promise.resolve(bdp.getResourceItem(wizardContext.applicationResource) as TModel)
            );
        } catch (err) {
            // TODO: this is duplicated from `GenericQuickPickStep` which isn't ideal
            const error = parseError(err);
            if (error.errorType === 'GoBackError') {
                // Instead of wiping out a property value, which is the default wizard behavior for `GoBackError`, pop the most recent
                // value off from the provenance of the picks
                wizardContext.pickedNodes.pop();
            }

            // And rethrow
            throw err;
        }
    }

    public shouldPrompt(_wizardContext: QuickPickAppResourceWizardContext<TModel>): boolean {
        return true;
    }

    public async getSubWizard(wizardContext: QuickPickAppResourceWizardContext<TModel>): Promise<IWizardOptions<QuickPickAppResourceWizardContext<TModel>> | undefined> {
        if (this.options.expectedChildContextValue) {
            if (matchesContextValueFilter(nonNullValue(getLastNode<TModel>(wizardContext), 'lastNode'), this.options.expectedChildContextValue)) {
                return undefined;
            }

            const bdp = this.branchDataProviderManager.getApplicationResourceBranchDataProvider(nonNullProp(wizardContext, 'applicationResource'));
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

        // TODO: this filtering needs to be fixed
        return filterArray.some(filter => {
            if (filter.type !== resource.type) {
                return false;
            }

            if (filter.kind && filter.kind !== resource.kind) {
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
