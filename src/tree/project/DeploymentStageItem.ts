/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { copilotOnRailsCommandIds } from '../../webviews/copilotOnRails/extension/copilotOnRailsCommands';
import { OpenPlanNode } from './OpenPlanNode';
import { ProgressNode } from './ProgressNode';
import { StageNode } from './StageNode';
import { StateStageNode } from './StateStageNode';

export class DeploymentStageItem extends StageNode {
    protected readonly stageId = 'azureProject.stage.deployment';
    protected readonly label = vscode.l10n.t('Deployment');
    protected readonly stepNumber = 3;
    protected readonly stepIndex = 2;
    protected readonly iconName = 'rocket';

    getChildren(): ProgressNode[] {
        if (!this.hasPlanFile) {
            return [new StateStageNode(this.stageId, copilotOnRailsCommandIds.startDeployment)];
        }

        return [new OpenPlanNode(this.stageId, copilotOnRailsCommandIds.openDeploymentPlanView)];
    }
}
