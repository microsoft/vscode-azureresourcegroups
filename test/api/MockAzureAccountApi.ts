/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISubscriptionContext } from '@microsoft/vscode-azext-utils';
import { Event, EventEmitter } from 'vscode';
import { AzureLoginStatus, AzureSession, CloudShell } from '../../azure-account.api';
import { AzureSubscription, AzureSubscriptionProvider, createSubscriptionContext2 } from '../../extension.bundle';
import { MockResources } from './mockServiceFactory';

export class MockAzureAccount implements AzureSubscriptionProvider {
    public status: AzureLoginStatus = 'LoggedIn';
    public onStatusChanged: Event<AzureLoginStatus>;
    readonly sessions!: AzureSession[];
    public getsessions: AzureSession[] = [];
    public onSessionsChanged: Event<void>;
    public onSubscriptionsChanged: Event<void>;
    public onFiltersChanged: Event<void>;

    get subscriptions(): AzureSubscription[] {
        return this.resources.subscriptions.map((subscription) => ({
            authentication: {
                getSession: () => {
                    return undefined;
                }
            },
            environment: undefined,
            isCustomCloud: false,
            name: subscription.name,
            tenantId: 'tenantId',
            subscriptionId: subscription.subscriptionId,
        } as unknown as AzureSubscription));
    }

    get filters(): AzureSubscription[] {
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
            subscriptionId: subscription.subscriptionId,
        } as unknown as AzureSubscription));
    }

    apiVersion = '1.0.0';

    createCloudShell(_os: 'Linux' | 'Windows'): CloudShell {
        throw new Error('not implemented');
    }

    private readonly _onStatusChangedEmitter: EventEmitter<AzureLoginStatus>;
    private readonly _onFiltersChangedEmitter: EventEmitter<void>;
    private readonly _onSessionsChangedEmitter: EventEmitter<void>;
    private readonly _onSubscriptionsChangedEmitter: EventEmitter<void>;

    public constructor(vscode: typeof import('vscode'), private readonly resources: MockResources) {
        this._onStatusChangedEmitter = new vscode.EventEmitter<AzureLoginStatus>();
        this.onStatusChanged = this._onStatusChangedEmitter.event;
        this._onFiltersChangedEmitter = new vscode.EventEmitter<void>();
        this.onFiltersChanged = this._onFiltersChangedEmitter.event;
        this._onSessionsChangedEmitter = new vscode.EventEmitter<void>();
        this.onSessionsChanged = this._onSessionsChangedEmitter.event;
        this._onSubscriptionsChangedEmitter = new vscode.EventEmitter<void>();
        this.onSubscriptionsChanged = this._onSubscriptionsChangedEmitter.event;
    }
    logIn(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    logOut(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    selectSubscriptions(): Promise<void> {
        throw new Error('Method not implemented.');
    }
    allSubscriptions!: AzureSubscription[];

    public async signIn(): Promise<void> {
        this.changeStatus('LoggedIn');
    }

    public signOut(): void {
        this.changeStatus('LoggedOut');
        this.changeFilter();
    }

    public getSubscriptionContext(): ISubscriptionContext {
        this.verifySubscription();
        return createSubscriptionContext2(this.subscriptions[0]);
    }

    public async waitForLogin(): Promise<boolean> {
        return true;
    }

    public async waitForSubscriptions(): Promise<boolean> {
        return true;
    }

    public async waitForFilters(): Promise<boolean> {
        return true;
    }

    private changeStatus(newStatus: AzureLoginStatus): void {
        this.status = newStatus;
        this._onStatusChangedEmitter.fire(this.status);
    }

    private changeFilter(): void {
        this._onFiltersChangedEmitter.fire();
    }

    private verifySubscription(): void {
        if (this.subscriptions.length === 0) {
            const noSubscription: string = 'No subscription found.  Invoke TestAzureAccount.signIn().';
            throw new Error(noSubscription);
        }
    }
}
