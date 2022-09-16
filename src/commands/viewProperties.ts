/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { appResourceExperience, ContextValueFilterableTreeNode, IActionContext, openReadOnlyJson } from '@microsoft/vscode-azext-utils';
import { ext } from '../extensionVariables';
import { BuiltInApplicationResourceItem } from '../tree/v2/providers/BuiltInApplicationResourceItem';

export interface ViewPropertiesModel {
    /**
     * Used to uniquely identify the opened file
     */
    id: string;
    /**
     * The content to display
     */
    data: {};
    /**
     * Used for the file name displayed in VS Code
     */
    label: string;
}

export interface CanViewProperties {
    viewProperties: ViewPropertiesModel;
}

export function canViewProperties(maybeCanViewProperties: unknown): maybeCanViewProperties is CanViewProperties {
    return typeof maybeCanViewProperties === 'object' && !!(maybeCanViewProperties as CanViewProperties).viewProperties;
}

export async function viewProperties(context: IActionContext, node?: CanViewProperties & ContextValueFilterableTreeNode): Promise<void> {
    if (!node) {
        node = await appResourceExperience<BuiltInApplicationResourceItem>(context, ext.v2.resourceGroupsTreeDataProvider);
    }

    const { id, data, label } = node.viewProperties;
    await openReadOnlyJson({ fullId: id, label }, data);
}
