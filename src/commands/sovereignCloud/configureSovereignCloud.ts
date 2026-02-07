/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzureWizard } from "@microsoft/vscode-azext-utils";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { ConfigureSovereignCloudContext } from "./ConfigureSovereignCloudContext";
import { SovereignCloudListStep } from "./SovereignCloudListStep";
import { SovereignCloudSetStep } from "./SovereignCloudSetStep";

export async function configureSovereignCloud(context: ConfigureSovereignCloudContext): Promise<void> {
    const wizardContext: ConfigureSovereignCloudContext = {
        ...context,
    };

    const title: string = localize('selectSovereignCloud', 'Select Sovereign Cloud');

    const wizard = new AzureWizard<ConfigureSovereignCloudContext>(wizardContext, {
        title,
        promptSteps: [new SovereignCloudListStep()],
        executeSteps: [new SovereignCloudSetStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    // Clear cache and refresh views to reflect the selected sovereign cloud
    // This ensures accounts from the previous environment are not shown
    ext.setClearCacheOnNextLoad();
    ext.actions.refreshAzureTree();
    ext.actions.refreshTenantTree();
}
