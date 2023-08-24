/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, ContextValueFilter, ITreeItemPickerContext, PickTreeItemWithCompatibility } from "@microsoft/vscode-azext-utils";
import { PickAppResourceOptions } from "@microsoft/vscode-azext-utils/hostapi";
import { AzExtResourceType, getAzExtResourceType } from "../../../api/src/index";
import { ext } from "../../extensionVariables";

export function createCompatibilityPickAppResource() {
    return async function pickAppResource<T extends AzExtTreeItem>(context: ITreeItemPickerContext, options?: PickAppResourceOptions): Promise<T> {
        const result = await PickTreeItemWithCompatibility.resource<T>(context, ext.v2.api.resources.azureResourceTreeDataProvider, {
            // Below error happens if you change AzExtResourceType in this repo, but it hasn't been updated in utils.
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            resourceTypes: convertAppResourceFilterToAzExtResourceType(options?.filter),
            childItemFilter: convertExpectedChildContextValueToContextValueFilter(options?.expectedChildContextValue)
        });

        return result;
    }
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

function filterMap<T, TMapped>(source: T[], predicateMapper: (item: T, index: number) => TMapped | null | undefined): TMapped[] {
    let index = 0;
    return source.reduce<TMapped[]>((accumulator, current) => {
        const mapped = predicateMapper(current, index++);
        if (mapped !== null && mapped !== undefined) {
            accumulator.push(mapped);
        }
        return accumulator;
    }, []);
}
