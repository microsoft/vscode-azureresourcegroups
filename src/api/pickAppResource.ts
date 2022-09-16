/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtResourceType, AzExtTreeItem, compatibilityPickAppResourceExperience, ContextValueFilter, getAzExtResourceType, ITreeItemPickerContext } from "@microsoft/vscode-azext-utils";
import { PickAppResourceOptions } from "@microsoft/vscode-azext-utils/hostapi";
import { ext } from "../extensionVariables";

export async function pickAppResource<T extends AzExtTreeItem>(context: ITreeItemPickerContext, options?: PickAppResourceOptions): Promise<T> {
    return await compatibilityPickAppResourceExperience<T>(context, ext.v2.resourceGroupsTreeDataProvider, {
        resourceTypes: convertAppResourceFilterToAzExtResourceType(options?.filter),
        childItemFilter: convertExpectedChildContextValueToContextValueFilter(options?.expectedChildContextValue)
    });
}

function convertExpectedChildContextValueToContextValueFilter(expectedChildContextValue?: PickAppResourceOptions['expectedChildContextValue']): ContextValueFilter | undefined {
    return expectedChildContextValue ? { include: expectedChildContextValue } : undefined
}

function convertAppResourceFilterToAzExtResourceType(filter?: PickAppResourceOptions['filter']): AzExtResourceType[] | undefined {
    if (!filter) {
        return undefined;
    }

    filter = Array.isArray(filter) ? filter : [filter];

    return filterMap(filter, getAzExtResourceType);
}

function filterMap<T, TMapped>(
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
