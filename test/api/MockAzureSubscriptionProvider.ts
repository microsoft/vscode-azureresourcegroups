/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, AzureSubscriptionProvider, AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { Disposable, Event } from 'vscode';
import { MockResources } from './mockServiceFactory';

export class MockAzureSubscriptionProvider implements AzureSubscriptionProvider {

    public constructor(private readonly resources: MockResources) { }

    async getSubscriptions(_filter: boolean): Promise<AzureSubscription[]> {
        return this.resources.subscriptions.map((subscription) => ({
            authentication: {
                getSession: () => {
                    return undefined;
                }
            },
            environment: {
                portalUrl: 'portalUrl',
            },
            isCustomCloud: false,
            name: subscription.name,
            tenantId: 'tenantId',
            account: {
                id: 'accountId',
                label: 'accountLabel',
            },
            subscriptionId: subscription.subscriptionId,
        } as unknown as AzureSubscription));
    }

    public async isSignedIn(): Promise<boolean> {
        return true;
    }

    public async signIn(): Promise<boolean> {
        return true;
    }

    public async signOut(): Promise<void> {
        throw new Error('Method not implemented.');
    }

    public async getTenants(): Promise<AzureTenant[]> {
        return [{
            tenantId: 'tenantId',
            account: {
                id: 'accountId',
                label: 'accountLabel',
            }
        }];
    }

    public onDidSignIn: Event<void> = () => { return new Disposable(() => { }) };
    public onDidSignOut: Event<void> = () => { return new Disposable(() => { }) };
}
