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

export class ProjectCreationStageItem extends StageNode {
    protected readonly stageId = 'azureProject.stage.projectCreation';
    protected readonly label = vscode.l10n.t('Project Creation');
    protected readonly stepNumber = 1;
    protected readonly stepIndex = 0;
    protected readonly iconName = 'new-file';

    getChildren(): ProgressNode[] {
        if (!this.hasPlanFile) {
            return [new StateStageNode(this.stageId, copilotOnRailsCommandIds.createProjectWithCopilot)];
        }

        return [new OpenPlanNode(this.stageId, copilotOnRailsCommandIds.openScaffoldPlanView)];
    }
}
