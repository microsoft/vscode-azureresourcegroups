/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Environment } from '@azure/ms-rest-azure-env';
import { AzExtParentTreeItem, AzExtServiceClientCredentials, AzExtTreeItem, callWithTelemetryAndErrorHandling, GenericTreeItem, IActionContext, ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AzureSubscription, AzureSubscriptionProvider, AzureSubscriptionStatus } from '../services/AzureSubscriptionProvider';
import { localize } from '../utils/localize';
import { SubscriptionItem } from './azure/SubscriptionItem';

/**
 * Converts a VS Code authentication session to an Azure Track 1 & 2 compatible compatible credential.
 */
export function createCredential(getSession: (scopes?: string[]) => vscode.ProviderResult<vscode.AuthenticationSession>): AzExtServiceClientCredentials {
    return {
        getToken: async (scopes?: string | string[]) => {
            if (typeof scopes === 'string') {
                scopes = [scopes];
            }

            const session = await getSession(scopes);

            if (session) {
                return {
                    token: session.accessToken
                };
            } else {
                return null;
            }
        }
    };
}

/**
 * Creates a subscription context from an application subscription.
 */
export function createSubscriptionContext(subscription: AzureSubscription): ISubscriptionContext {
    return {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        environment: {} as Environment,
        isCustomCloud: false,
        subscriptionDisplayName: subscription.displayName,
        subscriptionId: subscription.id,
        subscriptionPath: '',
        tenantId: '',
        userId: '',
        credentials: createCredential(subscription.getSession)
    };
}

export class VsCodeAzureAccountTreeItem extends AzExtParentTreeItem {
    private readonly subscriptionsSubscription: vscode.Disposable;

    public constructor(private readonly subscriptionProvider: AzureSubscriptionProvider) {
        super(undefined);

        this.subscriptionsSubscription = this.subscriptionProvider.onSubscriptionsChanged(
            () => callWithTelemetryAndErrorHandling(
                'azureAccountTreeItem.onSubscriptionsChanged',
                context => this.refresh(context)));
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        const subscriptionsResult = await this.subscriptionProvider.getSubscriptions();

        if (subscriptionsResult.status === AzureSubscriptionStatus.LoggedIn) {
            if (subscriptionsResult.selectedSubscriptions.length === 0) {
                return [
                    new GenericTreeItem(
                        this,
                        {
                            commandId: 'azure-account.selectSubscriptions',
                            contextValue: 'azure-account.selectSubscriptions',
                            label: localize('noSubscriptions', 'Select Subscriptions...')
                        })
                ];
            } else {
                return subscriptionsResult.selectedSubscriptions.map(
                    subscription => {
                        return new SubscriptionItem(
                            subscription
                            createSubscriptionContext(subscription));
                    });
            }
        } else if (subscriptionsResult.status === AzureSubscriptionStatus.LoggedOut) {
            return [
                new GenericTreeItem(
                    this,
                    {
                        commandId: 'azureResourceGroups.accounts.logIn',
                        contextValue: 'azureResourceGroups.accounts.logIn',
                        iconPath: new vscode.ThemeIcon('sign-in'),
                        label: localize('signInLabel', 'Sign in to Azure...')
                    }),
                new GenericTreeItem(
                    this,
                    {
                        commandId: 'azure-account.createAccount',
                        contextValue: 'azureResourceGroups.accounts.createAccount',
                        iconPath: new vscode.ThemeIcon('add'),
                        label: localize('createAccountLabel', 'Create an Azure Account...')
                    }),
                new GenericTreeItem(
                    this,
                    {
                        // TODO: How to deal with the args?  commandArgs: ['https://aka.ms/student-account'],
                        commandId: 'azureResourceGroups.openUrl',
                        contextValue: 'azureResourceGroups.openUrl',
                        iconPath: new vscode.ThemeIcon('mortar-board'),
                        label: localize('createStudentAccount', 'Create an Azure for Students Account...')
                    }),
            ];
        } else {
            return [
                new GenericTreeItem(
                    this,
                    {
                        commandId: 'azure-account.login',
                        contextValue: 'azure-account.login',
                        iconPath: new vscode.ThemeIcon('loading~spin'),
                        label: subscriptionsResult.status === AzureSubscriptionStatus.Initializing
                            ? localize('loadingTreeItem', 'Loading...')
                            : localize('signingIn', 'Waiting for Azure sign-in...')
                    })
            ];
        }
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public label: string;

    public contextValue: string;

    public dispose(): void {
        this.subscriptionsSubscription.dispose();
    }
}
