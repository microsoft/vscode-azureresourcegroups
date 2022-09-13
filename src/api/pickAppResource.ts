/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { appResourceExperience, AzExtResourceType, getAzExtResourceType, ITreeItemPickerContext } from "@microsoft/vscode-azext-utils";
import { AppResourceFilter, PickAppResourceOptions } from "@microsoft/vscode-azext-utils/hostapi";
import { ext } from "../extensionVariables";

export async function pickAppResource<T>(context: ITreeItemPickerContext, options?: PickAppResourceOptions): Promise<T> {

    return await appResourceExperience<T>(
        context,
        ext.v2.resourceGroupsTreeDataProvider,
        convertAppResourceFilterToAzExtResourceType(options?.filter),
        options?.expectedChildContextValue ? (
            {
                include: options?.expectedChildContextValue
            }) : undefined
    )

    // const subscription: SubscriptionTreeItem = await ext.appResourceTree.showTreeItemPicker(SubscriptionTreeItem.contextValue, context);
    // const appResource = await subscription.pickAppResource(context, options);

    // if (options?.expectedChildContextValue) {
    //     return ext.appResourceTree.showTreeItemPicker(options.expectedChildContextValue, context, appResource);
    // } else {
    //     return appResource as unknown as T;
    // }
}

function convertAppResourceFilterToAzExtResourceType(filter?: AppResourceFilter | AppResourceFilter[]): AzExtResourceType[] | undefined {
    if (!filter) {
        return undefined;
    }

    filter = Array.isArray(filter) ? filter : [filter];

    return filterMap(filter, (f) => getAzExtResourceType({ type: f.type, kind: f.kind }))
}

export function filterMap<T, TMapped>(
    source: T[],
    predicateMapper: (item: T, index: number) => TMapped | null | undefined,
): TMapped[] {
    let index = 0;
    return source.reduce<TMapped[]>((accumulator, current) => {
        const mapped = predicateMapper(current, index++);
        // handles null or undefined
        // eslint-disable-next-line eqeqeq
        if (mapped != null) {
            accumulator.push(mapped);
        }
        return accumulator;
    }, []);
}
