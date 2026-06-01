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
}

export type DeploymentPlanViewStrings = {
    title: string;
    loading: string;
    subscriptionLabel: string;
    locationLabel: string;
    selectSubscriptionPlaceholder: string;
    selectLocationPlaceholder: string;
    architectureDiagramHeading: string;
    workspaceScanHeading: string;
    decisionsHeading: string;
    azureResourcesHeading: string;
    approveButton: string;
    feedbackButtonAriaLabel: string;
    feedbackButtonTooltip: string;
    approveButtonTooltip: string;
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
    noDiagramAvailable: string;
    parseFailureTitle: string;
    parseFailureFallbackMessage: string;
    parseFailureFileLabel: string;
    openPlanFileButton: string;
};

export type DeploymentPlanViewConfiguration = {
    strings: DeploymentPlanViewStrings;
};
