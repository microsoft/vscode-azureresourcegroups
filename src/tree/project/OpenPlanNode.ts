/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ActionNode } from './ActionNode';

export class OpenPlanNode extends ActionNode {
    constructor(stageId: string, openPlanCommandId: string) {
        super({
            stageId,
            idSuffix: 'openPlan',
            label: vscode.l10n.t('Open plan'),
            icon: 'preview',
            commandId: openPlanCommandId,
        });
    }
}
