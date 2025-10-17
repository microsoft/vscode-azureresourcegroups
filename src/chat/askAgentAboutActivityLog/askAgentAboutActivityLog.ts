/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { ext } from "../../extensionVariables";
import { ActivityItem } from "../../tree/activityLog/ActivityItem";
import { TreeDataItem } from "../../tree/ResourceGroupsItem";
import { ActivitySelectedCache } from "./ActivitySelectedCache";

const genericActivityLogPrompt: string = vscode.l10n.t('Help explain important information from my Azure activity log.');

export async function askAgentAboutActivityLog(context: IActionContext, item?: ActivityItem): Promise<void> {
    const activitySelectedCache = ActivitySelectedCache.getInstance();

    if (item?.id) {
        activitySelectedCache.addActivity(item.id);
    } else {
        const treeItems: TreeDataItem[] = await ext.activityLogTree.getChildren() ?? [];

        if (treeItems.length > 1) {
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
                    placeHolder: vscode.l10n.t('Select activity items for Copilot'),
                    // All picks should start out selected by default
                    isPickSelected: () => true,
                },
            );

            for (const item of selectedItems) {
                if (item.id) {
                    activitySelectedCache.addActivity(item.id);
                }
            }
        }
    }

    await vscode.commands.executeCommand("workbench.action.chat.newChat");
    await vscode.commands.executeCommand("workbench.action.chat.open", { mode: 'agent', query: genericActivityLogPrompt });
}
