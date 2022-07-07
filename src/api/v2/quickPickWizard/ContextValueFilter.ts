/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceModelBase } from '../v2AzureResourcesApi';

export type ContextValueFilter = string | RegExp | (string | RegExp)[];

export function matchesContextValueFilter(resource: ResourceModelBase, filter: ContextValueFilter): boolean {
    if (!resource?.quickPickOptions) {
        return false;
    }

    const filterArray = Array.isArray(filter) ? filter : [filter];

    return filterArray.some(filter => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return resource.quickPickOptions!.contexts.some(contextValue => {
            if (typeof filter === 'string') {
                return filter === contextValue;
            } else {
                return filter.test(contextValue);
            }
        })
    });
}
