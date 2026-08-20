/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import * as vscode from "vscode";
import { ViewColumn } from "vscode";
import { ext } from "../../../../extensionVariables";
import { type DeployResultData } from "../../views/utils/deployResultTypes";
import { type DeployResultViewConfiguration, type DeployResultViewStrings } from "../../views/utils/viewConfigTypes";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";
import { openSourceFileOrWarn } from "../utils/singletonViewHost";

export type { DeployResultViewConfiguration, DeployResultViewStrings };

/** Localized strings rendered by the deployment results webview. */
function getDeployResultViewStrings(): DeployResultViewStrings {
    return {
        title: vscode.l10n.t('Deployment Results'),
        loading: vscode.l10n.t('Loading deployment results...'),
        succeededHeading: vscode.l10n.t('Deployment complete'),
        failedHeading: vscode.l10n.t('Deployment failed'),
        inProgressHeading: vscode.l10n.t('Deployment in progress'),
        unknownHeading: vscode.l10n.t('Deployment results'),
        partialBanner: vscode.l10n.t('Some application services were not deployed. Review the endpoints and resources below.'),
        openAppButton: vscode.l10n.t('Open app'),
        openPortalButton: vscode.l10n.t('View in Azure portal'),

        resourceGroupLabel: vscode.l10n.t('Resource group'),
        regionLabel: vscode.l10n.t('Region'),
        elapsedLabel: vscode.l10n.t('Elapsed'),
        healthLabel: vscode.l10n.t('Health'),

        endpointsHeading: vscode.l10n.t('Endpoints'),
        endpointNameHeader: vscode.l10n.t('Name'),
        endpointUrlHeader: vscode.l10n.t('URL'),
        endpointHealthHeader: vscode.l10n.t('Health'),

        resourcesHeading: vscode.l10n.t('Azure Resources'),
        resourceTypeHeader: vscode.l10n.t('Type'),
        resourceNameHeader: vscode.l10n.t('Name'),
        resourceStatusHeader: vscode.l10n.t('Status'),

        healthDetailHeading: vscode.l10n.t('Health Check'),
        healthEndpointLabel: vscode.l10n.t('Endpoint'),
        healthCheckedLabel: vscode.l10n.t('Checked'),
        optionalDependencyLabel: vscode.l10n.t('optional'),

        networkPolicyHeading: vscode.l10n.t('Network Policy'),
        mainSiteLabel: vscode.l10n.t('Main site'),
        scmSiteLabel: vscode.l10n.t('SCM site'),
        basicPublishingLabel: vscode.l10n.t('Basic publishing'),
        basicPublishingScmLabel: vscode.l10n.t('Basic publishing (SCM)'),
        basicPublishingFtpLabel: vscode.l10n.t('Basic publishing (FTP)'),
        enabledLabel: vscode.l10n.t('Enabled'),
        disabledLabel: vscode.l10n.t('Disabled'),

        healingHeading: vscode.l10n.t('Recovery Attempts'),
        healingAttemptLabel: vscode.l10n.t('Attempt'),
        healingIssueLabel: vscode.l10n.t('Issue'),
        healingResolutionLabel: vscode.l10n.t('Resolution'),
        planLevelChangeBadge: vscode.l10n.t('Plan change'),

        warningsHeading: vscode.l10n.t('Warnings'),
        orphanedHeading: vscode.l10n.t('Resource Groups To Clean Up'),
        orphanedHint: vscode.l10n.t('These resource groups were created while recovering from an error and are no longer used. Delete them to avoid unnecessary charges.'),

        cleanupHeading: vscode.l10n.t('Clean Up'),
        cleanupHint: vscode.l10n.t('Run this command to delete every resource this deployment created.'),
        copyButtonAriaLabel: vscode.l10n.t('Copy command'),
        copiedLabel: vscode.l10n.t('Copied'),

        parseFailureTitle: vscode.l10n.t('We couldn\u2019t render these results'),
        parseFailureFallbackMessage: vscode.l10n.t('The deployment result file couldn\u2019t be rendered as a structured view.'),
        parseFailureFileLabel: vscode.l10n.t('Result file'),
        openResultFileButton: vscode.l10n.t('Open result file'),
    };
}

export class DeployResultViewController extends WebviewController<DeployResultViewConfiguration> {
    private resultData: DeployResultData;
    private sourceFileUri: vscode.Uri | undefined;

    constructor(resultData: DeployResultData, sourceFileUri?: vscode.Uri) {
        const strings = getDeployResultViewStrings();
        super(ext.context, strings.title, 'deployResultView', { strings }, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());

        this.resultData = resultData;
        this.sourceFileUri = sourceFileUri;

        void this.postDeployResultData();

        this.panel.webview.onDidReceiveMessage((message: { command: string; url?: string; text?: string }) => {
            switch (message.command) {
                case 'ready':
                    void this.postDeployResultData();
                    break;
                case 'openExternal':
                    if (message.url) {
                        void vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                    break;
                case 'copyText':
                    if (message.text) {
                        void vscode.env.clipboard.writeText(message.text);
                    }
                    break;
                case 'openSourceFile':
                    openSourceFileOrWarn(this.sourceFileUri);
                    break;
            }
        });
    }

    updateDeployResultData(resultData: DeployResultData, sourceFileUri?: vscode.Uri): void {
        this.resultData = resultData;
        if (sourceFileUri) {
            this.sourceFileUri = sourceFileUri;
        }
        void this.postDeployResultData();
    }

    private async postDeployResultData(): Promise<void> {
        await this.panel.webview.postMessage({ command: 'setDeployResultData', data: this.resultData });
    }
}
