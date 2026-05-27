/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IActionContext } from "@microsoft/vscode-azext-utils";
import * as vscode from "vscode";
import { openDesignPreviewForPlan } from "./openDesignPreview";

export async function openDesignPreviewFromCommand(_context: IActionContext, planUri?: vscode.Uri): Promise<void> {
    if (planUri) {
        await openDesignPreviewForPlan(planUri);
        return;
    }

    const files = await vscode.workspace.findFiles('**/project-plan.md', '**/node_modules/**', 10);
    if (files.length === 0) {
        void vscode.window.showInformationMessage(
            vscode.l10n.t('No project-plan.md found in the workspace.'),
        );
        return;
    }

    let selected: vscode.Uri;
    if (files.length === 1) {
        selected = files[0];
    } else {
        const picked = await vscode.window.showQuickPick(
            files.map((f) => ({ label: vscode.workspace.asRelativePath(f), uri: f })),
            { placeHolder: vscode.l10n.t('Select a plan to preview') },
        );
        if (!picked) {
            return;
        }
        selected = picked.uri;
    }

    await openDesignPreviewForPlan(selected);
}
