import * as vscode from 'vscode';

interface ResourceGroupsContribution {
    readonly activation?: {
        readonly onFetch?: string[];
    }
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

export class ResourceGroupsExtensionManager {
    async activateApplicationResourceBranchDataProvider(type: string): Promise<void> {
        type = type.toLowerCase();

        const extensionAndContributions =
            vscode.extensions.all
                .map(extension => ({ extension, contributions: (extension.packageJSON as ExtensionPackage)?.contributes?.['x-azResourcesV2']?.activation?.onFetch?.map(type => type.toLowerCase()) ?? [] }))
                .find(extensionAndContributions => extensionAndContributions.contributions.find(contribution => contribution === type) !== undefined);

        if (extensionAndContributions) {
            if (!extensionAndContributions.extension.isActive) {
                await extensionAndContributions.extension.activate();
            }
        }
    }

    async activateApplicationResourceProviders(): Promise<void> {
        const inActiveResourceContributors =
            vscode.extensions.all
                .map(extension => ({ extension, resources: (extension.packageJSON as ExtensionPackage)?.contributes?.['x-azResourcesV2']?.application?.resources ?? [] }))
                .filter(extensionAndContributions => extensionAndContributions.resources.length > 0 && !extensionAndContributions.extension.isActive);

        await Promise.all(inActiveResourceContributors.map(contributor => contributor.extension.activate()));
    }

    async activateWorkspaceResourceProviders(): Promise<void> {
        const inActiveResourceContributors =
            vscode.extensions.all
                .map(extension => ({ extension, resources: (extension.packageJSON as ExtensionPackage)?.contributes?.['x-azResourcesV2']?.workspace?.resources ?? [] }))
                .filter(extensionAndContributions => extensionAndContributions.resources.length > 0 && !extensionAndContributions.extension.isActive);

        await Promise.all(inActiveResourceContributors.map(contributor => contributor.extension.activate()));
    }

    async activateWorkspaceResourceBranchDataProvider(type: string): Promise<void> {
        type = type.toLowerCase();

        const extensionAndContributions =
            vscode.extensions.all
                .map(extension => ({ extension, contributions: (extension.packageJSON as ExtensionPackage)?.contributes?.['x-azResourcesV2']?.workspace?.branches?.map(resources => resources.type.toLowerCase()) ?? [] }))
                .find(extensionAndContributions => extensionAndContributions.contributions.find(contribution => contribution === type) !== undefined);

        if (extensionAndContributions) {
            if (!extensionAndContributions.extension.isActive) {
                await extensionAndContributions.extension.activate();
            }
        }
    }
}
