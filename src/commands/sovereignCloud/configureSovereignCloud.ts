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

    const wizard: AzureWizard<ConfigureSovereignCloudContext> = new AzureWizard(wizardContext, {
        title,
        promptSteps: [new SovereignCloudListStep()],
        executeSteps: [new SovereignCloudSetStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    // refresh resources and tenant view to accurrately reflect information for the selected sovereign cloud
    ext.actions.refreshAzureTree();
    ext.actions.refreshTenantTree();
}
