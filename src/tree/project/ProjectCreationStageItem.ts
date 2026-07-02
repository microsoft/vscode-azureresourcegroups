/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { copilotOnRailsCommandIds } from '../../webviews/copilotOnRails/extension/copilotOnRailsCommands';
import { FrontendPreviewNode } from './FrontendPreviewNode';
import { OpenPlanNode } from './OpenPlanNode';
import { ProgressNode } from './ProgressNode';
import { ResumeStageNode } from './ResumeStageNode';
import { StageNode } from './StageNode';
import { StateStageNode } from './StateStageNode';

export class ProjectCreationStageItem extends StageNode {
    protected readonly stageId = 'azureProject.stage.projectCreation';
    protected readonly label = vscode.l10n.t('Project Creation');
    protected readonly stepNumber = 1;
    protected readonly stepIndex = 0;
    protected readonly iconName = 'new-file';

    constructor(
        currentStage: number,
        hasPlanFile: boolean,
        resumeCommandId: string | undefined,
        /** When true, a scaffolded frontend exists and a preview action is offered. */
        private readonly hasFrontend: boolean,
        resumeLabel?: string,
    ) {
        super(currentStage, hasPlanFile, resumeCommandId, resumeLabel);
    }

    getChildren(): ProgressNode[] {
        if (this.resumeCommandId) {
            return [new ResumeStageNode(this.stageId, this.resumeLabel)];
        }

        if (!this.hasPlanFile) {
            return [new StateStageNode(this.stageId, copilotOnRailsCommandIds.createProjectWithCopilot)];
        }

        const children: ProgressNode[] = [new OpenPlanNode(this.stageId, copilotOnRailsCommandIds.openScaffoldPlanView)];
        if (this.hasFrontend) {
            children.push(new FrontendPreviewNode(this.stageId, copilotOnRailsCommandIds.openFrontendPreviewView));
        }
        return children;
    }
}
