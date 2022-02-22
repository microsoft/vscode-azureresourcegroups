/* eslint-disable @typescript-eslint/no-unsafe-call */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ext } from "../extensionVariables";
import { localize } from "../utils/localize";
import { settingUtils } from "../utils/settingUtils";

export async function configureExplorer(context: IActionContext): Promise<void> {
    const value = await context.ui.showQuickPick([
        { label: localize('groupBy.label', 'Resource Groups') },
        { label: 'Resource Types' },
    ], {})

    await settingUtils.updateGlobalSetting('groupBy', value.label);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    void ext.tree.refresh(context);
}
