/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { WorkspaceResourceProvider } from "@microsoft/vscode-azext-utils/hostapi";
import { WorkspaceResource, WorkspaceResourceProvider as V2WorkspaceResourceProvider } from "@microsoft/vscode-azext-utils/hostapi.v2";
import { Event, WorkspaceFolder } from "vscode";
import { CompatibleWorkspaceResourceBranchDataProvider } from "./CompatibleWorkspaceResourceBranchDataProvider";

export class CompatibilityWorkspaceResourceProvider implements V2WorkspaceResourceProvider {
    constructor(private readonly resourceType: string, private readonly provider: WorkspaceResourceProvider) { }

    // No comparable mechanism in v1, leave as undefined
    onDidChangeResource?: Event<WorkspaceResource | undefined> = undefined;

    public async getResources(source: WorkspaceFolder | undefined): Promise<WorkspaceResource[]> {
        if (source) {
            return [];
        }

        const resources = await this.provider.provideResources(
            // pass in stub parent
            {
                treeDataProvider: new CompatibleWorkspaceResourceBranchDataProvider('azureWorkspace.loadMore'),
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
                        resourceType: this.resourceType,
                        name: resource.label,
                    } as WorkspaceResource
                );
            });
        }

        return [];
    }
}
