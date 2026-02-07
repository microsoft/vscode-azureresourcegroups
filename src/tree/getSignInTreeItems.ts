/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { isLoggingIn } from "../commands/accounts/logIn";
import { localize } from "../utils/localize";
import { GenericItem } from "./GenericItem";
import { ResourceGroupsItem } from "./ResourceGroupsItem";

export function tryGetLoggingInTreeItems(): ResourceGroupsItem[] | undefined {
    if (isLoggingIn()) {
        return [
            new GenericItem(
                localize('signingIn', 'Waiting for Azure sign-in...'),
                {
                    commandId: 'azureResourceGroups.logIn',
                    iconPath: new vscode.ThemeIcon('loading~spin')
                }
            )
        ];
    }

    return undefined;
}

export function getSignInTreeItems(includeCreateAccountItems: boolean): ResourceGroupsItem[] {
    const children: ResourceGroupsItem[] = [
        new GenericItem(
            localize('signInLabel', 'Sign in to Azure...'),
            {
                commandId: 'azureResourceGroups.logIn',
                iconPath: new vscode.ThemeIcon('sign-in')
            }
        )
    ];

    if (includeCreateAccountItems) {
        children.push(
            new GenericItem(
                localize('createAccountLabel', 'Create an Azure Account...'),
                {
                    commandId: 'azureResourceGroups.openUrl',
                    commandArgs: ['https://aka.ms/VSCodeCreateAzureAccount'],
                    iconPath: new vscode.ThemeIcon('add')
                }
            )
        );

        children.push(
            new GenericItem(
                localize('createStudentAccount', 'Create an Azure for Students Account...'),
                {
                    commandId: 'azureResourceGroups.openUrl',
                    commandArgs: ['https://aka.ms/student-account'],
                    iconPath: new vscode.ThemeIcon('mortar-board')
                }
            )
        );
    }

    return children;
}
