/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebviewBundleLocation } from "@microsoft/vscode-azext-webview";
import * as path from "path";
import { ext } from "../../../extensionVariables";

/**
 * Returns the location of the bundled Copilot on Rails webview script and stylesheet
 * (produced by `esbuild.copilotOnRailsViews.mjs`).
 */
export function getCopilotOnRailsBundleLocation(): WebviewBundleLocation {
    return {
        distDir: path.join(ext.context.extensionPath, 'dist', 'copilotOnRails'),
        scriptFileName: 'views.js',
        styleFileName: 'views.css',
    };
}
