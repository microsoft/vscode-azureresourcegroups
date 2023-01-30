/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { azureResourceExperience, IActionContext } from "@microsoft/vscode-azext-utils";
import { AzureResource } from "../../../api/src/index";
import { ext } from "../../extensionVariables";
import { AzureResourceItem } from "../../tree/azure/AzureResourceItem";

export async function editTags(context: IActionContext, item?: AzureResourceItem<AzureResource>): Promise<void> {
    if (!item) {
        item = await azureResourceExperience<AzureResourceItem<AzureResource>>({ ...context, dontUnwrap: true }, ext.v2.api.resources.azureResourceTreeDataProvider);
    }

    if (!item.tagsModel) {
        throw new Error("Editing tags is not supported for this resource.");
    }

    await ext.tagFS.showTextDocument(item.tagsModel);
}
