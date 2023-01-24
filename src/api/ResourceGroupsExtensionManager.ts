/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtResourceType } from '@hostapiv2';
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
}

interface ExtensionPackage {
    readonly contributes?: {
        readonly [contributesKey]?: ResourceGroupsContribution;
    };
}

function getV2ResourceContributions(extension: vscode.Extension<unknown>): ResourceGroupsContribution | undefined {
    const packageJson = extension.packageJSON as ExtensionPackage;

    return packageJson?.contributes?.[contributesKey];
}

const builtInExtensionIdRegex = /^vscode\./i;

function getInactiveExtensions(): vscode.Extension<unknown>[] {
    return vscode.extensions
        .all
        // We don't need to activate extensions that are already active
        .filter(extension => !extension.isActive)
        // We don't need to look at any built-in extensions (often the majority of them)
        .filter(extension => !builtInExtensionIdRegex.test(extension.id));
}

export class ResourceGroupsExtensionManager {
    async activateApplicationResourceBranchDataProvider(type: AzExtResourceType): Promise<void> {
        const extensionAndContributions =
            getInactiveExtensions()
                .map(extension => ({ extension, contributions: getV2ResourceContributions(extension)?.azure?.branches?.map(resource => resource.type) ?? [] }))
                .find(extensionAndContributions => extensionAndContributions.contributions.find(contribution => contribution === type) !== undefined);

        if (extensionAndContributions) {
            await extensionAndContributions.extension.activate();
        }
    }

    async activateApplicationResourceProviders(): Promise<void> {
        const inactiveResourceContributors =
            getInactiveExtensions()
                .filter(extension => getV2ResourceContributions(extension)?.azure?.resources);

        await Promise.all(inactiveResourceContributors.map(extension => extension.activate()));
    }

    async activateWorkspaceResourceProviders(): Promise<void> {
        const inactiveResourceContributors =
            getInactiveExtensions()
                .filter(extension => getV2ResourceContributions(extension)?.workspace?.resources);

        await Promise.all(inactiveResourceContributors.map(extension => extension.activate()));
    }

    async activateWorkspaceResourceBranchDataProvider(type: string): Promise<void> {
        const extensionAndContributions =
            getInactiveExtensions()
                .map(extension => ({ extension, contributions: getV2ResourceContributions(extension)?.workspace?.branches?.map(resources => resources.type) ?? [] }))
                .find(extensionAndContributions => extensionAndContributions.contributions.find(contribution => contribution === type) !== undefined);

        if (extensionAndContributions) {
            await extensionAndContributions.extension.activate();
        }
    }
}
