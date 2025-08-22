/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityChildItemBase, IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { ext } from "../../extensionVariables";
import { ActivityItem } from "../../tree/activityLog/ActivityItem";
import { TreeDataItem } from "../../tree/ResourceGroupsItem";
import { activitySelectionCache } from "./ActivitySelectionCache";

const genericActivityLogPrompt: string = vscode.l10n.t('Help explain important information from my Azure activity log.');

export async function askAgentAboutActivityLog(context: IActionContext, item?: ActivityChildItemBase): Promise<void> {
    if (item?.id) {
        activitySelectionCache.addActivityItems(item.id);
    } else {
        const treeItems: TreeDataItem[] = await ext.activityLogTree.getChildren() ?? [];

        if (treeItems.length > 0) {
            const selectedItems = await context.ui.showQuickPick(
                treeItems.map(item => {
                    return {
                        id: item.id,
                        label: (item as ActivityItem).label,
                    };
                }),
                {
                    suppressPersistence: true,
                    canPickMany: true,
                    placeHolder: vscode.l10n.t('Select activity items to provide as context'),
                },
            );

            for (const item of selectedItems) {
                if (item.id) {
                    activitySelectionCache.addActivityItems(item.id);
                }
            }
        }
    }

    await vscode.commands.executeCommand("workbench.action.chat.newChat");
    await vscode.commands.executeCommand("workbench.action.chat.open", { mode: 'agent', query: genericActivityLogPrompt });
}
