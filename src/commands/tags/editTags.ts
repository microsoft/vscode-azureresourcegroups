/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { pickAppResource } from "../../api/pickAppResource";
import { ext } from "../../extensionVariables";
import { AppResourceTreeItem } from "../../tree/AppResourceTreeItem";

export async function editTags(context: IActionContext, node?: AppResourceTreeItem): Promise<void> {
    if (!node) {
        node = await pickAppResource<AppResourceTreeItem>(context);
    }

    await ext.tagFS.showTextDocument(node);
}
