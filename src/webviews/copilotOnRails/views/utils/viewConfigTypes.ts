/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type CreateProjectViewControllerType = {
    title: string;
    heading: string;
    subtitle: string;
    promptPlaceholder: string;
    hint: string;
    planButtonLabel: string;
    modelLabel: string;
    modelOptions: string[];
    /** Recently submitted project-creation prompts, newest-first, for input-history navigation. */
    recentPrompts: string[];
    /** Pre-fills the prompt input, e.g. when re-opening the view after a reload-for-agent-discovery. */
    initialPrompt?: string;
    /** Pre-selects the model dropdown to match {@link initialPrompt}'s original submission. */
    initialModel?: string;
}

export type DeploymentPlanViewStrings = {
    title: string;
    loading: string;
    locationLabel: string;
    selectLocationPlaceholder: string;
    /** Shown beside a read-only region when no Azure account is signed in. */
    locationsSignedOutHint: string;
    /** Shown beside a read-only region when the live region list couldn't be loaded. */
    locationsFailedHint: string;
    azureResourcesHeading: string;
    prerequisitesHeading: string;
    prerequisiteToolHeader: string;
    prerequisiteInstalledHeader: string;
    prerequisiteVersionHeader: string;
    prerequisiteInstallHeader: string;
    prerequisiteInstalledLabel: string;
    prerequisiteUnknownLabel: string;
    prerequisiteInstallLinkLabel: string;
    prerequisiteRefreshTooltip: string;
    prerequisiteRefreshingTooltip: string;
    costEstimateHeading: string;
    costEstimateTotalLabel: string;
    costServiceHeader: string;
    costSkuHeader: string;
    costMonthlyHeader: string;
    costNotesHeader: string;
    recommendationsHeading: string;
    recommendationEffortLabel: string;
    environmentNameLabel: string;
    estimatedCostLabel: string;
    approveButton: string;
    approvedTooltip: string;
    feedbackButtonAriaLabel: string;
    feedbackButtonTooltip: string;
    approveButtonTooltip: string;
    approveButtonMissingSelectionTooltip: string;
    feedbackDrawerInfoTooltip: string;
    revisingBanner: string;
    requestChangesHeading: string;
    feedbackDrawerAriaLabel: string;
    closeFeedbackAriaLabel: string;
    drawerHint: string;
    freeformPlaceholder: string;
    addNoteButton: string;
    discardAllButton: string;
    submitFeedbackButton: string;
    removeFeedbackItemAriaLabel: string;
    submitEditsDialogTitle: string;
    /**
     * Message shown when there is exactly one pending edit. Use `{0}` as the count placeholder.
     */
    pendingEditsSingularMessage: string;
    /**
     * Message shown when there are multiple pending edits. Use `{0}` as the count placeholder.
     */
    pendingEditsPluralMessage: string;
    /** Fallback message shown when edits exist but the count is unknown. */
    editsMadeFallbackMessage: string;
    cancelButton: string;
    submitEditsButton: string;
    parseFailureTitle: string;
    parseFailureFallbackMessage: string;
    parseFailureFileLabel: string;
    openPlanFileButton: string;
};

export type DeploymentPlanViewConfiguration = {
    strings: DeploymentPlanViewStrings;
};

/** Localized strings rendered by the deployment results webview. */
export type DeployResultViewStrings = {
    title: string;
    loading: string;
    succeededHeading: string;
    failedHeading: string;
    inProgressHeading: string;
    unknownHeading: string;
    partialBanner: string;
    openAppButton: string;
    openPortalButton: string;

    resourceGroupLabel: string;
    regionLabel: string;
    elapsedLabel: string;
    healthLabel: string;

    endpointsHeading: string;
    endpointNameHeader: string;
    endpointUrlHeader: string;
    endpointHealthHeader: string;

    resourcesHeading: string;
    resourceTypeHeader: string;
    resourceNameHeader: string;
    resourceStatusHeader: string;

    healthDetailHeading: string;
    healthEndpointLabel: string;
    healthCheckedLabel: string;
    optionalDependencyLabel: string;

    networkPolicyHeading: string;
    mainSiteLabel: string;
    scmSiteLabel: string;
    basicPublishingLabel: string;
    basicPublishingScmLabel: string;
    basicPublishingFtpLabel: string;
    enabledLabel: string;
    disabledLabel: string;

    healingHeading: string;
    healingAttemptLabel: string;
    healingIssueLabel: string;
    healingResolutionLabel: string;
    planLevelChangeBadge: string;

    warningsHeading: string;
    orphanedHeading: string;
    orphanedHint: string;

    cleanupResourcesHeading: string;
    cleanupResourcesHint: string;
    reviewResourcesHeading: string;
    reviewResourcesHint: string;
    unverifiedInventoryHeading: string;
    unverifiedInventoryForbidden: string;
    unverifiedInventoryTransient: string;
    failedBadge: string;
    orphanedBadge: string;

    cleanupHeading: string;
    cleanupHint: string;
    copyButtonAriaLabel: string;
    copiedLabel: string;

    parseFailureTitle: string;
    parseFailureFallbackMessage: string;
    parseFailureFileLabel: string;
    openResultFileButton: string;
};

export type DeployResultViewConfiguration = {
    strings: DeployResultViewStrings;
};

/** Lifecycle of a single step in a loading view's progress checklist. */
export type LoadingStepStatus = 'pending' | 'active' | 'done' | 'failed';

/** One step in a loading view's progress checklist. */
export type LoadingStep = {
    /** Stable identifier, used as the React key. */
    id: string;
    /** Step label (e.g. "Provisioning Azure resources"). */
    label: string;
    status: LoadingStepStatus;
    /**
     * Optional nested checklist rendered under this step, used for the live per-resource
     * provisioning list. Only one level of nesting is rendered.
     */
    children?: readonly LoadingStep[];
    /**
     * Optional short counter shown beside the label (e.g. "4 of 7 resources ready"). Reserved for
     * machine-derived counts — never free-form prose.
     */
    summary?: string;
    /**
     * Optional secondary text rendered beside the label, de-emphasised and smaller. Used to carry
     * an Azure resource's name while the label carries its (far more readable) resource type.
     */
    note?: string;
};

/** Configuration for the transient loading view shown between workflow steps. */
export type LoadingViewConfiguration = {
    /** Stage index for the StageProgress bar (0 = Project Scaffolding, 1 = Local Development, 2 = Deployment). */
    stage: 0 | 1 | 2;
    /** Primary spinner label (e.g. "Generating your project plan"). */
    title: string;
    /** Optional secondary description shown below the spinner. */
    message?: string;
    /**
     * When true, shows a "Need help?" link below the loading message that
     * triggers the resume-project command for the current phase. Shown after a
     * brief delay.
     */
    showNeedHelp?: boolean;
    /**
     * Optional checklist of sub-steps rendered under the spinner. Omitted for
     * phases that have no observable intermediate progress.
     */
    /**
     * When true the view is blocked on the user rather than on Copilot, so the spinner is replaced
     * with a static prompt icon — an animation here reads as "work in progress" and hides the fact
     * that nothing advances until the user answers.
     */
    awaitingInput?: boolean;
    steps?: readonly LoadingStep[];
};

/**
 * Configuration for the post-local-development "what's next" view that surfaces
 * the three branching options (keep iterating, run API tests, deploy to Azure).
 */
export type LocalDevNextStepsViewConfiguration = {
    /** When false, the "Run API tests" card is hidden (no API tests were generated). */
    hasApiTests: boolean;
};
