/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

interface ResourceGroupsContribution {
    readonly application: {
        readonly branches?: { type: string }[];
        readonly resources?: { type: string }[];
    }
    readonly workspace: {
        readonly branches?: { type: string }[];
        readonly resources?: { type: string }[];
    }
}

interface ExtensionPackage {
    readonly contributes?: {
        readonly 'x-azResourcesV2'?: ResourceGroupsContribution;
    };
}

const v2ResourceContributionsKey = 'x-azResourcesV2';

function getV2ResourceContributions(extension: vscode.Extension<unknown>): ResourceGroupsContribution | undefined {
    const packageJson = extension.packageJSON as ExtensionPackage;

    return packageJson?.contributes?.[v2ResourceContributionsKey];
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
    async activateApplicationResourceBranchDataProvider(type: string): Promise<void> {
        type = type.toLowerCase();

        const extensionAndContributions =
            getInactiveExtensions()
                .map(extension => ({ extension, contributions: getV2ResourceContributions(extension)?.application?.branches?.map(resource => resource.type.toLowerCase()) ?? [] }))
                .find(extensionAndContributions => extensionAndContributions.contributions.find(contribution => contribution === type) !== undefined);

        if (extensionAndContributions) {
            await extensionAndContributions.extension.activate();
        }
    }

    async activateApplicationResourceProviders(): Promise<void> {
        const inactiveResourceContributors =
            getInactiveExtensions()
                .map(extension => ({ extension, resources: getV2ResourceContributions(extension)?.application?.resources ?? [] }))
                .filter(extensionAndContributions => extensionAndContributions.resources.length > 0);

        await Promise.all(inactiveResourceContributors.map(contributor => contributor.extension.activate()));
    }

    async activateWorkspaceResourceProviders(): Promise<void> {
        const inactiveResourceContributors =
            getInactiveExtensions()
                .map(extension => ({ extension, resources: getV2ResourceContributions(extension)?.workspace?.resources ?? [] }))
                .filter(extensionAndContributions => extensionAndContributions.resources.length > 0);

        await Promise.all(inactiveResourceContributors.map(contributor => contributor.extension.activate()));
    }

    async activateWorkspaceResourceBranchDataProvider(type: string): Promise<void> {
        type = type.toLowerCase();

        const extensionAndContributions =
            getInactiveExtensions()
                .map(extension => ({ extension, contributions: getV2ResourceContributions(extension)?.workspace?.branches?.map(resources => resources.type.toLowerCase()) ?? [] }))
                .find(extensionAndContributions => extensionAndContributions.contributions.find(contribution => contribution === type) !== undefined);

        if (extensionAndContributions) {
            await extensionAndContributions.extension.activate();
        }
    }
}
