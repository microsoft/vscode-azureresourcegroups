/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getHttpUrl } from '../../shared/httpUrl';

export async function openExternalHttpUrl(value: unknown): Promise<void> {
    const url = getHttpUrl(value);
    if (!url) {
        await vscode.window.showWarningMessage(vscode.l10n.t('Only absolute HTTP or HTTPS links without embedded credentials can be opened.'));
        return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
}
