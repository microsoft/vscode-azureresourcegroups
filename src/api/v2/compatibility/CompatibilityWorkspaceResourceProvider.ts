/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { WorkspaceResourceProvider } from "@microsoft/vscode-azext-utils/hostapi";
import { Event, WorkspaceFolder } from "vscode";
import { WorkspaceResource, WorkspaceResourceProvider as V2WorkspaceResourceProvider } from "../../v2/v2AzureResourcesApi";
import { CompatibleWorkspaceResourceBranchDataProvider } from "./CompatibleWorkspaceResourceBranchDataProvider";

export class CompatibilityWorkspaceResourceProvider implements V2WorkspaceResourceProvider {
    constructor(private readonly resourceType: string, private readonly provider: WorkspaceResourceProvider) { }

    // TODO: not sure what to do with this?
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
