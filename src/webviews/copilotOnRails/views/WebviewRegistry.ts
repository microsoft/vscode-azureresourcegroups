/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CreateProjectView } from "./CreateProjectView";
import { DeploymentPlanView } from "./DeploymentPlanView";
import { LocalPlanView } from "./LocalPlanView";
import { ScaffoldPlanView } from "./ScaffoldPlanView";

export const WebviewRegistry = {
    createProjectView: CreateProjectView,
    deploymentPlanView: DeploymentPlanView,
    localPlanView: LocalPlanView,
    scaffoldPlanView: ScaffoldPlanView,
} as const;
