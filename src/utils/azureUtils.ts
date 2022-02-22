/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenericResource } from '@azure/arm-resources';
import { nonNullProp } from '@microsoft/vscode-azext-utils';
import { GroupingConfig } from '../api';
import { localize } from './localize';

function parseResourceId(id: string): RegExpMatchArray {
    const matches: RegExpMatchArray | null = id.match(/\/subscriptions\/(.*)\/resourceGroups\/(.*)\/providers\/(.*)\/(.*)/i);

    if (matches === null || matches.length < 3) {
        throw new Error(localize('InvalidResourceId', 'Invalid Azure Resource Id'));
    }

    return matches;
}

export function getResourceGroupFromId(id: string): string {
    return parseResourceId(id)[2];
}

export function createGroupConfigFromResource(resource: GenericResource): GroupingConfig {
    const id = nonNullProp(resource, 'id');
    return {
        resourceGroup: { label: getResourceGroupFromId(id), id: id.substring(0, id.indexOf('/providers')).toLowerCase() },
        resourceType: { label: resource.type?.toLowerCase() || 'unknown', id: resource.type?.toLowerCase() || 'unknown' }
    }
}
