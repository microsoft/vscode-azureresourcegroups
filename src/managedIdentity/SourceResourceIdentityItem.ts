/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { Identity } from "@azure/arm-msi";
import { GenericResource } from "@azure/arm-resources";
import { createContextValue } from "@microsoft/vscode-azext-utils";
import { AzureSubscription } from "api/src";
import { TreeItem, TreeItemCollapsibleState } from "vscode";
import { createAzureResource } from "../api/DefaultAzureResourceProvider";
import { DefaultAzureResourceItem } from "../tree/azure/DefaultAzureResourceItem";
import { ResourceGroupsItem } from "../tree/ResourceGroupsItem";
import { localize } from "../utils/localize";

export class SourceResourceIdentityItem implements ResourceGroupsItem {
    static readonly contextValue: string = 'sourceResourceIdentityItem';
    static readonly contextValueRegExp: RegExp = new RegExp(SourceResourceIdentityItem.contextValue);
    label: string = localize('sourceResources', 'Source resources');
    id: string;
    children: DefaultAzureResourceItem[] = [];

    constructor(public readonly subscription: AzureSubscription, public readonly msi: Identity, resources: GenericResource[]) {
        this.id = `${msi.id}/${this.label}`;
        this.children = this.filterResources(resources, msi);
    }

    private filterResources(resources: GenericResource[], msi: Identity): DefaultAzureResourceItem[] {
        const assignedResources = resources.filter((r) => {
            // verify the msi is assigned to the resource by checking if the msi id is in the userAssignedIdentities
            const userAssignedIdentities = r.identity?.userAssignedIdentities;
            if (!userAssignedIdentities) {
                return false;
            }

            if (!msi.id) {
                return false;
            }

            return userAssignedIdentities[msi.id] !== undefined
        }).map((r) => {
            const sourceResource = createAzureResource(this.subscription, r);
            return new DefaultAzureResourceItem(sourceResource, { treeId: `${msi.id}/${sourceResource.id}` /** Also include the msi id to ensure uniqueness */ });
        });
        return assignedResources;
    }

    private get contextValue(): string {
        const values: string[] = [];
        values.push(SourceResourceIdentityItem.contextValue);
        return createContextValue(values);
    }

    getChildren(): DefaultAzureResourceItem[] {
        return this.children;
    }

    getTreeItem(): TreeItem {
        return {
            label: this.label,
            id: this.id,
            contextValue: this.contextValue,
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        }
    }
}
