/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzureAccountTreeItemBase, SubscriptionTreeItemBase } from "@microsoft/vscode-azext-azureutils";
import { AzureWizardPromptStep, ISubscriptionActionContext, PickTreeItemWithCompatibility } from "@microsoft/vscode-azext-utils";
import { ext } from "../../extensionVariables";

export class CompatibleAzureAccountTreeItem extends AzureAccountTreeItemBase {
    public constructor(testAccount?: {}) {
        super(undefined, testAccount);
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    public override get fullId(): string {
        return '';
    }

    public override readonly valuesToMask: string[] = [];

    /**
     * Override the subscription prompt step to use for compatibility with v2.
     */
    public override async getSubscriptionPromptStep(): Promise<AzureWizardPromptStep<ISubscriptionActionContext> | undefined> {
        return new CompatibilitySubscriptionPromptStep();
    }

    public createSubscriptionTreeItem(): SubscriptionTreeItemBase {
        throw new Error('createSubscriptionTreeItem should not be called');
    }
}

class CompatibilitySubscriptionPromptStep extends AzureWizardPromptStep<ISubscriptionActionContext> {
    async prompt(context: ISubscriptionActionContext): Promise<void> {
        const subscription = await PickTreeItemWithCompatibility.subscription(context, ext.v2.api.resources.azureResourceTreeDataProvider);
        Object.assign(context, subscription);
    }

    shouldPrompt(context: ISubscriptionActionContext): boolean {
        return !context.subscriptionId;
    }
}
