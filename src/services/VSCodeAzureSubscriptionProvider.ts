/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { getSelectedTenantAndSubscriptionIds } from '../commands/accounts/selectSubscriptions';
import { VSCodeAzureSubscriptionProvider } from '../commands/accounts/VSCodeAzureSubscriptionProvider'; //changes to auth package

let vscodeAzureSubscriptionProvider: VSCodeAzureSubscriptionProvider | undefined;

export function createVSCodeAzureSubscriptionProviderFactory(): () => Promise<VSCodeAzureSubscriptionProvider> {
    return async (): Promise<VSCodeAzureSubscriptionProvider> => {
        vscodeAzureSubscriptionProvider ??= await createVSCodeAzureSubscriptionProvider();
        return vscodeAzureSubscriptionProvider;
    }
}

async function createVSCodeAzureSubscriptionProvider(): Promise<VSCodeAzureSubscriptionProvider> {
    // This will update the selected subscription IDs to ensure the filters are in the form of `${tenantId}/${subscriptionId}`
    await getSelectedTenantAndSubscriptionIds();

    return new VSCodeAzureSubscriptionProvider();
}
