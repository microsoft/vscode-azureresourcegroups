/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from '@microsoft/vscode-azext-utils';
import { ResourceModelBase } from '../v2AzureResourcesApi';

export interface QuickPickWizardContext<TModel extends ResourceModelBase> extends IActionContext {
    pickedNodes: TModel[];
}

export function getLastNode<TModel extends ResourceModelBase>(context: QuickPickWizardContext<TModel>): TModel | undefined {
    if (context.pickedNodes.length) {
        return context.pickedNodes[context.pickedNodes.length - 1];
    }

    return undefined;
}
