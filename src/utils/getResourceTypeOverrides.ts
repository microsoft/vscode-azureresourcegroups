/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';
import { AzExtResourceType } from '../../api/src/AzExtResourceType';
import { ext } from '../extensionVariables';
import { ContributedIconPath, getResourceContributions } from './getResourceContributions';

/**
 * Static, contribution-driven overrides for the display of a resource-type
 * group node. Resolved from contributing extensions' `package.json` without
 * activating them.
 */
export interface ResourceTypeOverride {
    readonly label?: string;
    readonly iconPath?: TreeItemIconPath;
}

let cache: Map<string, ResourceTypeOverride> | undefined;
let changeSubscription: vscode.Disposable | undefined;

function ensureSubscribed(): void {
    if (!changeSubscription) {
        changeSubscription = vscode.extensions.onDidChange(() => {
            cache = undefined;
        });
    }
}

function resolveIconPath(extensionUri: vscode.Uri, icon: ContributedIconPath): TreeItemIconPath {
    if (typeof icon === 'string') {
        return Utils.joinPath(extensionUri, icon);
    }
    return {
        light: Utils.joinPath(extensionUri, icon.light),
        dark: Utils.joinPath(extensionUri, icon.dark),
    };
}

function buildCache(): Map<string, ResourceTypeOverride> {
    const map = new Map<string, ResourceTypeOverride>();

    // Sort by extension id to make conflict resolution deterministic.
    const extensions = [...vscode.extensions.all].sort((a, b) => a.id.localeCompare(b.id));

    for (const extension of extensions) {
        const branches = getResourceContributions(extension)?.azure?.branches;
        if (!branches) {
            continue;
        }

        for (const branch of branches) {
            if (!branch.type || (branch.displayName === undefined && branch.icon === undefined)) {
                continue;
            }

            if (map.has(branch.type)) {
                ext.outputChannel.warn(`Multiple extensions declare a display override for resource type "${branch.type}". Using the first by extension id; ignoring "${extension.id}".`);
                continue;
            }

            map.set(branch.type, {
                label: branch.displayName,
                iconPath: branch.icon !== undefined ? resolveIconPath(extension.extensionUri, branch.icon) : undefined,
            });
        }
    }

    return map;
}

/**
 * Returns the contribution-declared display override for the given resource
 * type, or `undefined` if no contributing extension declares one. Reading does
 * not activate any extension.
 */
export function getResourceTypeOverride(resourceType: AzExtResourceType | string): ResourceTypeOverride | undefined {
    ensureSubscribed();
    if (!cache) {
        cache = buildCache();
    }
    return cache.get(resourceType);
}
