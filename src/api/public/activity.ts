/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

// TODO: move Activity related declarations to this package
import type { Activity } from "@microsoft/vscode-azext-utils/hostapi";

export interface ActivityApi {
    /**
     * Registers an activity to appear in the activity window.
    *
    * @param activity - The activity information to show.
    */
    registerActivity(activity: Activity): Promise<void>;
}
