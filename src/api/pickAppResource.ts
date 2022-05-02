/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, ITreeItemPickerContext } from "@microsoft/vscode-azext-utils";
import { PickAppResourceOptions } from "@microsoft/vscode-azext-utils/hostapi";
import { ext } from "../extensionVariables";
import { SubscriptionTreeItem } from "../tree/SubscriptionTreeItem";

export async function pickAppResource<T extends AzExtTreeItem>(context: ITreeItemPickerContext, options?: PickAppResourceOptions): Promise<T> {
    const subscription: SubscriptionTreeItem = await ext.appResourceTree.showTreeItemPicker(SubscriptionTreeItem.contextValue, context);
    const appResource = await subscription.pickAppResource(context, options);

    if (!appResource.resolveResult) {
        await appResource.resolve(true, context);
    }

    if (options?.expectedChildContextValue) {
        return ext.appResourceTree.showTreeItemPicker(options.expectedChildContextValue, context, appResource);
    } else {
        return appResource as unknown as T;
    }
}
