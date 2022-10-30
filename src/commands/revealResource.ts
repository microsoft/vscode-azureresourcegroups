/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAzureResourceId } from '@microsoft/vscode-azext-azureutils';
import { IActionContext, parseError } from '@microsoft/vscode-azext-utils';
import { AppResource } from '@microsoft/vscode-azext-utils/hostapi';
import { ext } from '../extensionVariables';

export async function revealResource(context: IActionContext, resourceId: string): Promise<void>;
export async function revealResource(context: IActionContext, resource: AppResource): Promise<void>;
export async function revealResource(context: IActionContext, arg: AppResource | string): Promise<void> {
    const resourceId = typeof arg === 'string' ? arg : arg.id;

    context.telemetry.properties.resourceType = parseAzureResourceId(resourceId).provider.replace(/\//g, '|');

    try {
        const node = await ext.v2.appResourceTree.findItem(resourceId, true);
        if (node) {
            // await ext.appResourceTree.refresh(context);
            await ext.appResourceTreeView.reveal(node);

            // await ext.appResourceTreeView.reveal(node);
        }
    } catch (error) {
        context.telemetry.properties.revealError = parseError(error).message;
    }
}
