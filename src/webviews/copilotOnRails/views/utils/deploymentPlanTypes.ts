/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DeploymentPlanTable {
    headers: string[];
    rows: string[][];
}

export interface DeploymentPlanData {
    status: string;
    mode: string;
    subscription: string;
    availableSubscriptions?: string[];
    location: string;
    locationCode: string;
    availableLocations?: { name: string; code: string }[];
    architecture: { title?: string; table: DeploymentPlanTable }[];
    workspaceScan: DeploymentPlanTable;
    decisions: DeploymentPlanTable;
    resources: DeploymentPlanTable;
    resourcesHeading?: string;
    /** The `Attribute | Value` requirements table (Classification, Scale, Budget, Subscription, Location). */
    requirements?: DeploymentPlanTable;
    /** Selected deployment recipe as authored (e.g. `AZD (Bicep)`). */
    recipe?: string;
    /** Selected architecture stack as authored (e.g. `Serverless + Static Web Apps`). */
    stack?: string;
    parseError?: DeploymentPlanParseError;
}

export interface DeploymentPlanParseError {
    message: string;
    fileLabel?: string;
}
