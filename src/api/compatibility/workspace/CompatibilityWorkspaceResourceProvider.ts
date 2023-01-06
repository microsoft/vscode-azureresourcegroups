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
    constructor(private readonly resourceType: string, private readonly provider: WorkspaceResourceProvider, private readonly compatTreeDataProvider: CompatibleWorkspaceResourceBranchDataProvider<AzExtTreeItem & WorkspaceResource>) { }

    // No comparable mechanism in v1, leave as undefined
    onDidChangeResource?: Event<WorkspaceResource | undefined> = undefined;

    public async getResources(source: WorkspaceFolder | undefined): Promise<WorkspaceResource[]> {
        // For compatibility, and to avoid duplicating resources, we'll only return resources when undefined is passed.
        // See https://github.com/microsoft/vscode-azureresourcegroups/pull/451
        if (source) {
            return [];
        }

        const resources = await this.provider.provideResources(
            // pass in stub parent
            {
                treeDataProvider: this.compatTreeDataProvider,
                valuesToMask: [],
                parent: undefined,
                fullId: '', // prevent ids from starting with undefined
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
