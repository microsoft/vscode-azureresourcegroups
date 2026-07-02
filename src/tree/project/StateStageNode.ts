/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ActionNode } from './ActionNode';

export class StateStageNode extends ActionNode {
    constructor(stageId: string, startCommandId: string) {
        super({
            stageId,
            idSuffix: 'start',
            label: vscode.l10n.t('Start'),
            icon: 'play-circle',
            commandId: startCommandId,
        });
    }
}
