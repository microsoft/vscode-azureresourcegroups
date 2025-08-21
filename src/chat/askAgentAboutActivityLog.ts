/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityChildItemBase, IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";

const genericActivityLogPrompt: string = vscode.l10n.t('Help explain important information from my Azure activity log.');

export async function askAgentAboutActivityLog(_: IActionContext, item?: ActivityChildItemBase): Promise<void> {
    if (item) {
        selectedActivityItemId = item.id;
    }

    await vscode.commands.executeCommand("workbench.action.chat.newChat");
    await vscode.commands.executeCommand("workbench.action.chat.open", { mode: 'agent', query: genericActivityLogPrompt });
}

let selectedActivityItemId: string | undefined;

export function getSelectedActivityItemId(): string | undefined {
    return selectedActivityItemId;
}

export function resetSelectedActivityItemId(): void {
    selectedActivityItemId = undefined;
}
