/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, IAzureQuickPickItem } from "@microsoft/vscode-azext-utils";
import { ConfigureSovereignCloudContext } from "./ConfigureSovereignCloudContext";

export class SovereignCloudListStep extends AzureWizardPromptStep<ConfigureSovereignCloudContext> {
    public async prompt(context: ConfigureSovereignCloudContext): Promise<void> {
        const picks: IAzureQuickPickItem<string>[] = [
            { label: 'Azure (Default)', data: '' },
            { label: 'Azure China', data: 'ChinaCloud' },
            { label: 'Azure US Government', data: 'USGovernment' },
            { label: 'A custom Microsoft Sovereign Cloud', data: 'custom' }
        ]

        context.sovereignCloud = (await context.ui.showQuickPick(picks, { placeHolder: 'Select a sovereign cloud' })).data;
    }

    public shouldPrompt(context: ConfigureSovereignCloudContext): boolean {
        return !context.sovereignCloud;
    }
}
