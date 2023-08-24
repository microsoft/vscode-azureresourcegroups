/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { azureResourceExperience, IActionContext, openReadOnlyJson } from '@microsoft/vscode-azext-utils';
import { v4 as uuidv4 } from "uuid";
import { ViewPropertiesModel, ViewPropertiesModelAsync } from '../../api/src/index';
import { ext } from '../extensionVariables';
import { ResourceGroupsItem } from '../tree/ResourceGroupsItem';
import { localize } from '../utils/localize';

export async function viewProperties(context: IActionContext, node?: ResourceGroupsItem): Promise<void> {
    if (!node) {
        node = await azureResourceExperience<ResourceGroupsItem>({ ...context, dontUnwrap: true }, ext.v2.api.resources.azureResourceTreeDataProvider);
    }

    if (!hasViewProperties(node)) {
        throw new Error(localize('commands.viewProperties.noProperties', 'The selected resource has no properties to view.'));
    }

    // support both async and sync viewProperties models
    const data = isAsyncViewPropertiesModel(node.viewProperties) ? await node.viewProperties.getData() : node.viewProperties.data;
    await openReadOnlyJson({ fullId: node.id ?? uuidv4(), label: node.viewProperties.label }, data);
}

export function hasViewProperties(node: unknown): node is { viewProperties: ViewPropertiesModel } {
    return !!(node as { viewProperties: ViewPropertiesModel })?.viewProperties;
}

function isAsyncViewPropertiesModel(viewProperties: ViewPropertiesModel): viewProperties is ViewPropertiesModel & ViewPropertiesModelAsync {
    return 'getData' in viewProperties;
}
