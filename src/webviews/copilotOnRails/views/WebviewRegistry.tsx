/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CreateProjectView } from "./CreateProjectView";
import { DeploymentPlanView } from "./DeploymentPlanView";
import { DeployResultView } from "./DeployResultView";
import { FrontendPreviewView } from "./FrontendPreviewView";
import { LoadingView } from "./LoadingView";
import { LocalDevNextStepsView } from "./LocalDevNextStepsView";
import { LocalPlanView } from "./LocalPlanView";
import { RequirementsView } from "./RequirementsView";
import { ScaffoldNextStepsView } from "./ScaffoldNextStepsView";
import { ScaffoldPlanView } from "./ScaffoldPlanView";
import { UserFeedback } from "./components/UserFeedback";
import { type JSX } from "react";

function withUserFeedback(View: () => JSX.Element): () => JSX.Element {
    return function ViewWithUserFeedback(): JSX.Element {
        return (
            <>
                <View />
                <UserFeedback />
            </>
        );
    };
}

export const WebviewRegistry = {
    createProjectView: withUserFeedback(CreateProjectView),
    deploymentPlanView: withUserFeedback(DeploymentPlanView),
    deployResultView: withUserFeedback(DeployResultView),
    frontendPreviewView: withUserFeedback(FrontendPreviewView),
    loadingView: withUserFeedback(LoadingView),
    localDevNextStepsView: withUserFeedback(LocalDevNextStepsView),
    localPlanView: withUserFeedback(LocalPlanView),
    requirementsView: withUserFeedback(RequirementsView),
    scaffoldPlanView: withUserFeedback(ScaffoldPlanView),
    scaffoldNextStepsView: withUserFeedback(ScaffoldNextStepsView),
} as const;
