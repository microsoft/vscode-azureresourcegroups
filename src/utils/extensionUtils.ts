/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { contributesKey } from '../constants';

const builtInExtensionIdRegex = /^vscode\./i;

export function getExternalExtensions(): vscode.Extension<unknown>[] {
    return vscode.extensions
        .all
        // We don't need to look at any built-in extensions (often the majority of them)
        .filter(extension => !builtInExtensionIdRegex.test(extension.id));
}

export function getInactiveExtensions(): vscode.Extension<unknown>[] {
    return getExternalExtensions()
        // We don't need to activate extensions that are already active
        .filter(extension => !extension.isActive);
}

interface ResourceGroupsContribution {
    readonly azure: {
        readonly branches?: { type: string }[];
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

export function getV2ResourceContributions(extension: vscode.Extension<unknown>): ResourceGroupsContribution | undefined {
    const packageJson = extension.packageJSON as ExtensionPackage;

    return packageJson?.contributes?.[contributesKey];
}
