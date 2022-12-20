/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { AzureResource } from "@microsoft/vscode-azext-utils/hostapi.v2";
import { ext } from "../../extensionVariables";
import { AzureResourceItem } from "../../tree/v2/azure/AzureResourceItem";

export async function editTags(_context: IActionContext, item?: AzureResourceItem<AzureResource>): Promise<void> {
    if (!item) {
        // todo
        // node = await pickAppResource<AppResourceTreeItem>(context);
        throw new Error("A resource must be selected.");
    }

    if (!item.tagsModel) {
        throw new Error("Editing tags is not supported for this resource.");
    }

    await ext.tagFS.showTextDocument(item.tagsModel);
}
