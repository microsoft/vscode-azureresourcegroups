/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { contributesKey } from '../constants';

/**
 * A path to an icon file contributed by an extension. Either a single path used
 * for both light and dark themes, or distinct paths per theme. Paths are
 * resolved relative to the contributing extension's root.
 *
 * Theme icons (`$(id)` references) are intentionally not supported here:
 * resource-type group nodes are expected to use branded Azure service icons.
 */
export type ContributedIconPath = string | { readonly light: string; readonly dark: string };

export interface AzureBranchContribution {
    readonly type: string;
    /**
     * Optional. Overrides the default localized label of the resource-type
     * group node when the tree is grouped by resource type. Supports `%key%`
     * NLS substitution against the contributing extension's `package.nls.json`.
     */
    readonly displayName?: string;
    /**
     * Optional. Overrides the default icon of the resource-type group node
     * when the tree is grouped by resource type.
     */
    readonly icon?: ContributedIconPath;
}

interface ResourceGroupsContribution {
    readonly azure: {
        readonly branches?: AzureBranchContribution[];
        readonly resources?: boolean;
    }
    readonly workspace: {
        readonly branches?: { type: string }[];
        readonly resources?: boolean;
    }
    readonly commands?: (vscode.Command & { detail?: string })[];
}

interface ExtensionPackage {
    readonly contributes?: {
        readonly [contributesKey]?: ResourceGroupsContribution;
    };
}

export function getResourceContributions(extension: vscode.Extension<unknown>): ResourceGroupsContribution | undefined {
    const packageJson = extension.packageJSON as ExtensionPackage;

    return packageJson?.contributes?.[contributesKey];
}
