/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { OpenInPortalOptions } from "@microsoft/vscode-azext-azureutils";
import { AzureSubscription } from "@microsoft/vscode-azext-utils/hostapi.v2";
import * as vscode from 'vscode';

// TODO move to shared package
export function createPortalUrl(subscription: AzureSubscription, id: string, options?: OpenInPortalOptions): vscode.Uri {
    const queryPrefix: string = (options && options.queryPrefix) ? `?${options.queryPrefix}` : '';
    const url: string = `${subscription.environment.portalUrl}/${queryPrefix}#@${subscription.tenantId}/resource${id}`;

    return vscode.Uri.parse(url);
}
