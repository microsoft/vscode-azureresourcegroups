/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzureSubscription } from 'api/src/resources/azure';
import * as vscode from 'vscode';
import { AzureLoginStatus } from '../../azure-account.api';

export interface AzureSubscriptionProvider {
    logIn(): Promise<void>;
    logOut(): Promise<void>;
    selectSubscriptions(): Promise<void>;

    readonly onStatusChanged: vscode.Event<AzureLoginStatus>;
    readonly onFiltersChanged: vscode.Event<void>;
    readonly onSessionsChanged: vscode.Event<void>;
    readonly onSubscriptionsChanged: vscode.Event<void>;

    readonly waitForFilters: () => Promise<boolean>;

    readonly status: AzureLoginStatus;
    readonly allSubscriptions: AzureSubscription[];
    readonly filters: AzureSubscription[];
}
