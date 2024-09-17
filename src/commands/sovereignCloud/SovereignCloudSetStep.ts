/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from "@microsoft/vscode-azext-utils";
import { settingUtils } from "../../utils/settingUtils";
import { ConfigureSovereignCloudContext } from "./ConfigureSovereignCloudContext";

export class SovereignCloudSetStep extends AzureWizardExecuteStep<ConfigureSovereignCloudContext> {
    public priority: number = 10;

    public async execute(context: ConfigureSovereignCloudContext): Promise<void> {
        await settingUtils.updateGlobalSetting('environment', context.sovereignCloud, 'microsoft-sovereign-cloud');
    }

    public shouldExecute(): boolean {
        return true;
    }
}
