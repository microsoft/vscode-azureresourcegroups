/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem, callWithTelemetryAndErrorHandlingSync } from "@microsoft/vscode-azext-utils";
import { WorkspaceResourceProvider } from "@microsoft/vscode-azext-utils/hostapi";
import { Disposable, Event, WorkspaceFolder } from "vscode";
import { refreshWorkspace } from "../commands/workspace/refreshWorkspace";
import { ext } from "../extensionVariables";
import { CompatibleWorkspaceResourceBranchDataProvider } from "./v2/compatibility/CompatibleWorkspaceResourceBranchDataProvider";
import { BranchDataProvider, WorkspaceResource, WorkspaceResourceProvider as V2WorkspaceResourceProvider } from "./v2/v2AzureResourcesApi";

export const workspaceResourceProviders: Record<string, WorkspaceResourceProvider> = {};

export function registerWorkspaceResourceProvider(resourceType: string, provider: WorkspaceResourceProvider): Disposable {
    workspaceResourceProviders[resourceType] = provider;

    return callWithTelemetryAndErrorHandlingSync('registerWorkspaceResourceProvider', (context) => {

        void refreshWorkspace(context);

        ext.v2.api.registerWorkspaceResourceProvider(resourceType, new CompatibilityWorkspaceResourceProvider(resourceType, provider));
        ext.v2.api.registerWorkspaceResourceBranchDataProvider(resourceType, new CompatibleWorkspaceResourceBranchDataProvider('foo') as unknown as BranchDataProvider<WorkspaceResource, AzExtTreeItem>)

        return new Disposable(() => {
            delete workspaceResourceProviders[resourceType];
            void refreshWorkspace(context);
        });
    }) as Disposable;
}

class CompatibilityWorkspaceResourceProvider implements V2WorkspaceResourceProvider {
    constructor(private readonly resourceType: string, private readonly provider: WorkspaceResourceProvider) { }

    onDidChangeResource?: Event<WorkspaceResource | undefined> = undefined;

    public async getResources(source: WorkspaceFolder): Promise<WorkspaceResource[]> {

        const resources = await this.provider.provideResources(
            // pass in stub parent
            {
                treeDataProvider: new CompatibleWorkspaceResourceBranchDataProvider('foo'),
                valuesToMask: [],
                parent: undefined,
            } as unknown as AzExtParentTreeItem
        );

        if (resources) {
            return resources.map((resource) => {
                return Object.assign<AzExtTreeItem, WorkspaceResource>(resource,
                    {
                        // omit id because it's already in the treeItem
                        folder: source,
                        type: this.resourceType,
                        name: resource.label,
                    } as WorkspaceResource
                );
            });
        }

        return [];
    }
}
