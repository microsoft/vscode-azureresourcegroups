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

const themeIconPattern = /^\$\(.+\)$/;

/**
 * Returns true if `value` is a structurally valid contributed icon path: a
 * non-empty string or an object with non-empty string `light` and `dark`
 * properties. Invalid values (numbers, arrays, nested objects, empty strings,
 * etc.) are rejected so that a misconfigured partner extension cannot crash
 * tree construction.
 *
 * Note: theme-icon strings (`$(id)`) pass this check intentionally — callers
 * are expected to test for theme icons separately before calling this function.
 */
function isValidIconPath(value: unknown): value is ContributedIconPath {
    if (typeof value === 'string') {
        return value.length > 0;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        return typeof obj['light'] === 'string' && obj['light'].length > 0
            && typeof obj['dark'] === 'string' && obj['dark'].length > 0;
    }
    return false;
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
            try {
                if (!branch.type || (branch.displayName === undefined && branch.icon === undefined)) {
                    continue;
                }

                if (map.has(branch.type)) {
                    ext.outputChannel.warn(`Multiple extensions declare a display override for resource type "${branch.type}". Using the first by extension id; ignoring "${extension.id}".`);
                    continue;
                }

                let iconPath: TreeItemIconPath | undefined;
                if (branch.icon !== undefined) {
                    const rawIcon: unknown = branch.icon;
                    if (typeof rawIcon === 'string' && themeIconPattern.test(rawIcon)) {
                        ext.outputChannel.warn(`Extension "${extension.id}" contributed a theme icon ("${rawIcon}") for resource type "${branch.type}". Theme icons are not supported for resource-type group nodes; the icon will be ignored.`);
                    } else if (!isValidIconPath(rawIcon)) {
                        ext.outputChannel.warn(`Extension "${extension.id}" contributed an invalid icon for resource type "${branch.type}"; the icon will be ignored.`);
                    } else {
                        iconPath = resolveIconPath(extension.extensionUri, rawIcon);
                    }
                }

                map.set(branch.type, {
                    label: branch.displayName,
                    iconPath,
                });
            } catch (e) {
                ext.outputChannel.warn(`Failed to process display override from extension "${extension.id}" for resource type "${branch.type ?? '(unknown)'}": ${String(e)}`);
            }
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
