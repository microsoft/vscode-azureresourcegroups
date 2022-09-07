import * as vscode from 'vscode';
import { BranchDataProvider, ResourceModelBase, WorkspaceResource } from '../../../api/v2/v2AzureResourcesApi';

interface WorkspaceResourceModel extends ResourceModelBase {
    readonly name: string;
}

class WorkspaceResourceItem implements WorkspaceResourceModel {
    constructor(private readonly resource: WorkspaceResource) {
    }

    get name(): string {
        return this.resource.name;
    }
}

export class WorkspaceDefaultBranchDataProvider implements BranchDataProvider<WorkspaceResource, WorkspaceResourceModel> {
    getChildren(_element?: WorkspaceResourceModel | undefined): vscode.ProviderResult<WorkspaceResourceModel[]> {
        return [];
    }

    getResourceItem(element: WorkspaceResource): WorkspaceResourceModel | Thenable<WorkspaceResourceModel> {
        return new WorkspaceResourceItem(element);
    }

    getTreeItem(element: WorkspaceResourceModel): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return new vscode.TreeItem(element.name);
    }
}
