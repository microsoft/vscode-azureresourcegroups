/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureResource, AzureResourceModel, BranchDataProvider } from '../../../api/src/index';
import { DefaultAzureResourceItem } from './DefaultAzureResourceItem';

export class DefaultAzureResourceBranchDataProvider implements BranchDataProvider<AzureResource, AzureResourceModel> {
    getChildren(element: DefaultAzureResourceItem): vscode.ProviderResult<AzureResourceModel[]> {
        return element.getChildren();
    }

    getResourceItem(element: AzureResource): DefaultAzureResourceItem | Thenable<DefaultAzureResourceItem> {
        return new DefaultAzureResourceItem(element);
    }

    // TODO: Implement change eventing.
    // onDidChangeTreeData?: vscode.Event<void | ResourceGroupsItem | null | undefined> | undefined;

    getTreeItem(element: DefaultAzureResourceItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }
}
