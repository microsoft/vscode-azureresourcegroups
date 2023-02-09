/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { contributesKey } from '../constants';

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

export function getResourceContributions(extension: vscode.Extension<unknown>): ResourceGroupsContribution | undefined {
    const packageJson = extension.packageJSON as ExtensionPackage;

    return packageJson?.contributes?.[contributesKey];
}
