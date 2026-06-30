/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { copilotOnRailsCommandIds } from '../../webviews/copilotOnRails/extension/copilotOnRailsCommands';
import { DebugConfigurationNode } from './DebugConfigurationNode';
import { OpenPlanNode } from './OpenPlanNode';
import { ProgressNode } from './ProgressNode';
import { getDebugConfigurations } from './projectPlanFiles';
import { ResumeStageNode } from './ResumeStageNode';
import { StageNode } from './StageNode';
import { StateStageNode } from './StateStageNode';

export class LocalDevelopmentStageItem extends StageNode {
    protected readonly stageId = 'azureProject.stage.localDevelopment';
    protected readonly label = vscode.l10n.t('Local Development');
    protected readonly stepNumber = 2;
    protected readonly stepIndex = 1;
    protected readonly iconName = 'terminal';

    getChildren(): ProgressNode[] {
        if (this.resumeCommandId) {
            return [new ResumeStageNode(this.stageId)];
        }

        if (!this.hasPlanFile) {
            return [new StateStageNode(this.stageId, copilotOnRailsCommandIds.startLocalDevelopment)];
        }

        const debugConfigs = getDebugConfigurations();

        if (debugConfigs.length === 0) {
            return [new OpenPlanNode(this.stageId, copilotOnRailsCommandIds.openLocalPlanView)];
        }

        return debugConfigs.map((config) => new DebugConfigurationNode(this.stageId, config));
    }
}
