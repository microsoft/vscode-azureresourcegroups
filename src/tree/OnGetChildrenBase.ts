/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import * as vscode from 'vscode';
import { isLoggingIn } from "../commands/accounts/logIn";
import { ext } from "../extensionVariables";
import { localize } from "../utils/localize";
import { GenericItem } from "./GenericItem";
import { ResourceGroupsItem } from "./ResourceGroupsItem";
import { AzureResourceTreeDataProvider } from "./azure/AzureResourceTreeDataProvider";
import { AzureResourceTreeDataProviderBase } from "./azure/AzureResourceTreeDataProviderBase";
import { TenantResourceTreeDataProvider } from "./tenants/TenantResourceTreeDataProvider";

export async function OnGetChildrenBase(subscriptionProvider: AzureSubscriptionProvider, tdp?: AzureResourceTreeDataProvider): Promise<ResourceGroupsItem[]> {
    const children: ResourceGroupsItem[] = [];

    if (subscriptionProvider) {
        if (isLoggingIn()) {
            return [
                new GenericItem(
                    localize('signingIn', 'Waiting for Azure sign-in...'),
                    {
                        commandId: 'azureResourceGroups.logIn',
                        iconPath: new vscode.ThemeIcon('loading~spin')
                    }
                )];
        } else if (!(await subscriptionProvider.isSignedIn())) {
            children.push(
                new GenericItem(
                    localize('signInLabel', 'Sign in to Azure...'),
                    {
                        commandId: 'azureResourceGroups.logIn',
                        iconPath: new vscode.ThemeIcon('sign-in')
                    }
                ));
            if (tdp) {
                children.push(
                    new GenericItem(
                        localize('createAccountLabel', 'Create an Azure Account...'),
                        {
                            commandId: 'azureResourceGroups.openUrl',
                            commandArgs: ['https://aka.ms/VSCodeCreateAzureAccount'],
                            iconPath: new vscode.ThemeIcon('add')
                        }));
                children.push(
                    new GenericItem(
                        localize('createStudentAccount', 'Create an Azure for Students Account...'),
                        {
                            commandId: 'azureResourceGroups.openUrl',
                            commandArgs: ['https://aka.ms/student-account'],
                            iconPath: new vscode.ThemeIcon('mortar-board')
                        }));
            }
        }
    }
    return children;
}

export async function getAzureSubscriptionProvider(tdp: AzureResourceTreeDataProviderBase | TenantResourceTreeDataProvider): Promise<AzureSubscriptionProvider> {
    // override for testing
    if (ext.testing.overrideAzureSubscriptionProvider) {
        return ext.testing.overrideAzureSubscriptionProvider();
    } else {
        if (!tdp.subscriptionProvider) {
            tdp.subscriptionProvider = await ext.subscriptionProviderFactory();
        }

        tdp.statusSubscription = vscode.authentication.onDidChangeSessions((evt: vscode.AuthenticationSessionsChangeEvent) => {
            if (evt.provider.id === 'microsoft' || evt.provider.id === 'microsoft-sovereign-cloud') {
                if (Date.now() > tdp.nextSessionChangeMessageMinimumTime) {
                    tdp.nextSessionChangeMessageMinimumTime = Date.now() + tdp.sessionChangeMessageInterval;
                    // This event gets HEAVILY spammed and needs to be debounced
                    // Suppress additional messages for 1 second after the first one
                    tdp.notifyTreeDataChanged();
                }
            }
        });

        return tdp.subscriptionProvider;
    }
}
