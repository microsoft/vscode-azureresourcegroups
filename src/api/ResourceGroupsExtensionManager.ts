/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzExtResourceType } from '../../api/src/index';
import { getResourceContributions } from '../utils/getResourceContributions';

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
                .map(extension => ({ extension, contributions: getResourceContributions(extension)?.azure?.branches?.map(resource => resource.type) ?? [] }))
                .find(extensionAndContributions => extensionAndContributions.contributions.find(contribution => contribution === type) !== undefined);

        if (extensionAndContributions) {
            await extensionAndContributions.extension.activate();
        }
    }

    async activateApplicationResourceProviders(): Promise<void> {
        const inactiveResourceContributors =
            getInactiveExtensions()
                .filter(extension => getResourceContributions(extension)?.azure?.resources);

        await Promise.all(inactiveResourceContributors.map(extension => extension.activate()));
    }

    async activateWorkspaceResourceProviders(): Promise<void> {
        const inactiveResourceContributors =
            getInactiveExtensions()
                .filter(extension => getResourceContributions(extension)?.workspace?.resources);

        await Promise.all(inactiveResourceContributors.map(extension => extension.activate()));
    }

    async activateWorkspaceResourceBranchDataProvider(type: string): Promise<void> {
        const extensionAndContributions =
            getInactiveExtensions()
                .map(extension => ({ extension, contributions: getResourceContributions(extension)?.workspace?.branches?.map(resources => resources.type) ?? [] }))
                .find(extensionAndContributions => extensionAndContributions.contributions.find(contribution => contribution === type) !== undefined);

        if (extensionAndContributions) {
            await extensionAndContributions.extension.activate();
        }
    }
}
