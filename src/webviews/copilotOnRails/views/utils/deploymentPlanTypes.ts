/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DeploymentPlanTable {
    headers: string[];
    rows: string[][];
}

/**
 * Detection outcome for a deploy CLI prerequisite (`azd` / `az`). Only two
 * states are ever surfaced (D5): `installed` (with a detected version) or
 * `unknown` (couldn't confirm). We never assert `missing`, because a sandbox
 * can hide a real binary and we must not claim absence.
 */
export type CliPrerequisiteStatus = 'installed' | 'unknown';

/** Inline (non-auto-opened) install / upgrade guidance for a CLI prerequisite. */
export interface CliPrerequisiteInstall {
    /** Short lead-in shown above the commands (e.g. "Install the Azure Developer CLI:"). */
    intro: string;
    /** Shell commands to render as copyable code. */
    commands: string[];
    /** Docs URL shown as plain text; the extension never opens it automatically. */
    docsUrl?: string;
}

/**
 * A single deploy CLI prerequisite as detected extension-side and rendered in
 * the deployment plan's Prerequisites card. This is sourced entirely from code
 * we own (the extension shelling out to the CLIs) - never parsed out of the
 * external `deployment-plan.md`.
 */
export interface CliPrerequisite {
    id: 'azd' | 'az';
    /** Display name, e.g. "Azure Developer CLI (azd)". */
    name: string;
    status: CliPrerequisiteStatus;
    /** Detected `major.minor.patch` version when installed. */
    version?: string;
    /** Latest stable release when the release feed could be reached. */
    latestVersion?: string;
    /** True when the installed version is >= 2 minor versions behind latest stable. */
    updateRecommended: boolean;
    install: CliPrerequisiteInstall;
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
    /**
     * Deploy CLI prerequisites (`azd` / `az`) detected extension-side. `undefined`
     * while the initial detection pass is still running.
     */
    cliPrerequisites?: CliPrerequisite[];
    parseError?: DeploymentPlanParseError;
}

export interface DeploymentPlanParseError {
    message: string;
    fileLabel?: string;
}
