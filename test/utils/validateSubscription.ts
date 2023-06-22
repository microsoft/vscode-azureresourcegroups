/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import assert = require("assert");
import { AzureSubscription, ISubscriptionContext } from "../../extension.bundle";

/**
 * Validate that the given object is an ISubscriptionContext & AzureSubscription.
 */
export function validateSubscription(maybeSubscription: unknown): void {
    const subscription = maybeSubscription as ISubscriptionContext & AzureSubscription;

    // properties only on ISubscriptionContext
    assert.ok(subscription.credentials);
    assert.ok(subscription.subscriptionDisplayName);
    assert.ok(subscription.userId !== undefined);
    assert.ok(subscription.subscriptionPath);

    // properties only on AzureSubscription
    assert.ok(subscription.authentication);
    assert.ok(subscription.name);

    // properties common to both ISubscriptionContext & AzureSubscription
    assert.ok(subscription.environment);
    assert.ok(subscription.subscriptionId);
}
