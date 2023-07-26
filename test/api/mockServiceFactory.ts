/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { GenericResource, ResourceGroup } from "@azure/arm-resources";
import { randomUUID } from "crypto";
import { AzureResourcesServiceFactory, AzureSubscription, ext } from "../../extension.bundle";
import { MockAzureSubscriptionProvider } from "./MockAzureSubscriptionProvider";

export class MockResources {
    get subscriptions(): MockSubscription[] {
        return Array.from(this.subscriptionsMap.values());
    }
    subscriptionsMap: Map<string, MockSubscription> = new Map();
}

class MockSubscription {
    constructor(public readonly name: string) { }
    readonly subscriptionId = randomUUID();
    readonly id: string = `/subscriptions/${this.subscriptionId}`;
    readonly resourceGroups: MockResourceGroup[] = [];

    get resources(): MockResource[] {
        return this.resourceGroups.reduce((acc, rg) => acc.concat(rg.resources), [] as MockResource[]);
    }
}

class MockResourceGroup implements ResourceGroup {
    readonly type: string = 'microsoft.resources/resourcegroups';
    constructor(private readonly subscriptionId: string, public readonly name: string, public readonly location: string) { }
    readonly resources: MockResource[] = [];
    readonly id: string = `${this.subscriptionId}/resourceGroups/${this.name}`;
}

class MockResource implements GenericResource {
    constructor(private readonly resourceGroupId: string, public readonly name: string, public readonly type: string, public readonly kind: string) { }
    readonly id: string = `${this.resourceGroupId}/providers/${this.type}/${this.name}`;
}

function addSubscription(resources: MockResources, name: string) {
    const subscription = new MockSubscription(name);
    resources.subscriptionsMap.set(subscription.subscriptionId, subscription);
    return subscription;
}

function addResourceGroup(subscription: MockSubscription, resourceGroupOptions: { name: string, location?: string }): MockResourceGroup {
    const mockResourceGroup = new MockResourceGroup(subscription.id, resourceGroupOptions.name, resourceGroupOptions.location ?? 'westus2');
    subscription.resourceGroups.push(mockResourceGroup);
    return mockResourceGroup;
}

function addResource(resourceGroup: MockResourceGroup, resourceOptions: { name: string, type: string, kind: string }): MockResource {
    const resource = new MockResource(resourceGroup.id, resourceOptions.name, resourceOptions.type, resourceOptions.kind);
    resourceGroup.resources.push(resource);
    return resource;
}

function addFunctionApp(resoruceGroup: MockResourceGroup, name: string): MockResource {
    return addResource(resoruceGroup, {
        name,
        type: 'microsoft.web/sites',
        kind: 'functionapp',
    });
}

export class MockSubscriptionWithFunctions extends MockSubscription {
    constructor() {
        super('mock-subscription-with-functions');
        this.rg1 = addResourceGroup(this, {
            name: 'test-rg-1',
        });

        this.functionApp1 = addFunctionApp(this.rg1, 'test-function-1');
        addFunctionApp(this.rg1, 'test-function-2');
        addFunctionApp(this.rg1, 'test-function-3');
    }

    readonly rg1: MockResourceGroup;
    readonly functionApp1: MockResource;
}

class BasicMockResources extends MockResources {

    readonly sub1: MockSubscriptionWithFunctions;
    readonly functionApp1: MockResource;

    constructor() {
        super();
        this.sub1 = new MockSubscriptionWithFunctions();
        this.functionApp1 = this.sub1.functionApp1;
        this.subscriptionsMap.set(this.sub1.subscriptionId, this.sub1);
        addSubscription(this, 'mock-subscription-1');
        addSubscription(this, 'mock-subscription-2');
    }
}

export const createMockSubscriptionWithFunctions = (): BasicMockResources => {
    const mockResources = new BasicMockResources();
    ext.testing.overrideAzureServiceFactory = createTestAzureResourcesServiceFactory(mockResources);
    const mockAzureSubscriptionProvider = new MockAzureSubscriptionProvider(mockResources);
    ext.testing.overrideAzureSubscriptionProvider = () => mockAzureSubscriptionProvider;
    return mockResources;
}

export function createTestAzureResourcesServiceFactory(mockResources: MockResources): AzureResourcesServiceFactory {
    return () => {
        return {
            async listResources(_context, subscription: AzureSubscription): Promise<GenericResource[]> {
                if (mockResources.subscriptionsMap.has(subscription.subscriptionId)) {
                    return mockResources.subscriptionsMap.get(subscription.subscriptionId)!.resources;
                }
                throw new Error(`Subscription ${subscription.subscriptionId} not found. \n\t${mockResources.subscriptions.map(s => s.subscriptionId).join('\n\t')}`);
            },
            async listResourceGroups(_context, subscription: AzureSubscription): Promise<ResourceGroup[]> {
                if (mockResources.subscriptionsMap.has(subscription.subscriptionId)) {
                    return mockResources.subscriptionsMap.get(subscription.subscriptionId)!.resourceGroups;
                }
                throw new Error(`Subscription ${subscription.subscriptionId} not found. \n\t${mockResources.subscriptions.map(s => s.subscriptionId).join('\n\t')}`);
            },
        }
    }
}

