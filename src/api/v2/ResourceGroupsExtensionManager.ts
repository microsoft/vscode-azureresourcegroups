import * as vscode from 'vscode';

interface ResourceGroupsContribution {
    readonly activation?: {
        readonly onFetch?: string[];
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
}
