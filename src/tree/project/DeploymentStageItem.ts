/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { copilotOnRailsCommandIds } from '../../commands/copilotOnRails/registerCopilotOnRailsCommands';
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

    constructor(currentStage: number, hasPlanFile: boolean, private readonly hasAppOnboardSession: boolean) {
        super(currentStage, hasPlanFile);
    }

    getChildren(): ProgressNode[] {
        if (this.hasPlanFile) {
            return [new OpenPlanNode(this.stageId, copilotOnRailsCommandIds.openDeploymentPlanView)];
        }

        return [new StateStageNode(
            this.stageId,
            copilotOnRailsCommandIds.startDeployment,
            this.hasAppOnboardSession ? vscode.l10n.t('Resume') : vscode.l10n.t('Start'),
        )];
    }
}
