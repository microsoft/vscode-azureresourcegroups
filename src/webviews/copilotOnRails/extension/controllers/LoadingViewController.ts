/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewController } from "@microsoft/vscode-azext-webview";
import { ViewColumn } from "vscode";
import { ext } from "../../../../extensionVariables";
import { type LoadingViewConfiguration } from "../../views/utils/viewConfigTypes";
import { getCopilotOnRailsBundleLocation } from "../copilotOnRailsBundleLocation";

/**
 * Transient webview shown while Copilot generates the artifact (requirements,
 * plan, scaffold) that the next step's view will render.
 */
export class LoadingViewController extends WebviewController<LoadingViewConfiguration> {
    constructor(initialConfig: LoadingViewConfiguration) {
        super(ext.context, initialConfig.title, 'loadingView', initialConfig, ViewColumn.Active, undefined, getCopilotOnRailsBundleLocation());
    }

    /** Push a new title/message into the running webview without re-creating the panel. */
    updateConfig(config: LoadingViewConfiguration): void {
        this.panel.title = config.title;
        void this.panel.webview.postMessage({ command: 'updateLoadingState', data: config });
    }
}
