/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CreateProjectView } from "./CreateProjectView";
import { DeploymentPlanView } from "./DeploymentPlanView";
import { FrontendPreviewView } from "./FrontendPreviewView";
import { LoadingView } from "./LoadingView";
import { LocalDevNextStepsView } from "./LocalDevNextStepsView";
import { LocalPlanView } from "./LocalPlanView";
import { RequirementsView } from "./RequirementsView";
import { ScaffoldNextStepsView } from "./ScaffoldNextStepsView";
import { ScaffoldPlanView } from "./ScaffoldPlanView";

export const WebviewRegistry = {
    createProjectView: CreateProjectView,
    deploymentPlanView: DeploymentPlanView,
    frontendPreviewView: FrontendPreviewView,
    loadingView: LoadingView,
    localDevNextStepsView: LocalDevNextStepsView,
    localPlanView: LocalPlanView,
    requirementsView: RequirementsView,
    scaffoldPlanView: ScaffoldPlanView,
    scaffoldNextStepsView: ScaffoldNextStepsView,
} as const;
