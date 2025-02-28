/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import * as vscode from 'vscode';
import { isLoggingIn } from "../commands/accounts/logIn";
import { localize } from "../utils/localize";
import { GenericItem } from "./GenericItem";
import { ResourceGroupsItem } from "./ResourceGroupsItem";
import { AzureResourceTreeDataProvider } from "./azure/AzureResourceTreeDataProvider";

export async function onGetAzureChildrenBase(subscriptionProvider: AzureSubscriptionProvider, tdp?: AzureResourceTreeDataProvider): Promise<ResourceGroupsItem[]> {
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
