/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

/**
 * @param resourceId Azure resource Id
 * @returns Azure resource id minus the subscription part
 */
export function getApplicationResourceId(resourceId: string): string {
    const splitId = resourceId.split(/(resourceGroups)/);
    return splitId[1] + splitId[2];
}
