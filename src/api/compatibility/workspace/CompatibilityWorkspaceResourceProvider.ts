/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtParentTreeItem, AzExtTreeItem } from "@microsoft/vscode-azext-utils";
import { WorkspaceResourceProvider } from "@microsoft/vscode-azext-utils/hostapi";
import { Event } from "vscode";
import { WorkspaceResource, WorkspaceResourceProvider as V2WorkspaceResourceProvider } from "../../../../api/src/index";
import { CompatibleWorkspaceResourceBranchDataProvider } from "./CompatibleWorkspaceResourceBranchDataProvider";

export class CompatibilityWorkspaceResourceProvider implements V2WorkspaceResourceProvider {
    constructor(private readonly resourceType: string, private readonly provider: WorkspaceResourceProvider, private readonly compatTreeDataProvider: CompatibleWorkspaceResourceBranchDataProvider<AzExtTreeItem & WorkspaceResource>) { }

    // No comparable mechanism in v1, leave as undefined
    onDidChangeResource?: Event<WorkspaceResource | undefined> = undefined;

    public async getResources(): Promise<WorkspaceResource[]> {
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
                        resourceType: this.resourceType,
                        name: resource.label,
                    } as WorkspaceResource
                );
            });
        }

        return [];
    }
}
