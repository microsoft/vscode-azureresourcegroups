import * as vscode from 'vscode';
import { ApplicationResource, BranchDataProvider } from '../../../api/v2/v2AzureResourcesApi';
import { localize } from "../../../utils/localize";
import { BuiltInApplicationResourceItem } from './BuiltInApplicationResourceItem';
import { BuiltInResourceModelBase } from './BuiltInResourceModelBase';

export class BuiltInApplicationResourceBranchDataProvider implements BranchDataProvider<ApplicationResource, BuiltInResourceModelBase> {
    getChildren(element: BuiltInResourceModelBase): vscode.ProviderResult<BuiltInResourceModelBase[]> {
        if (!element) {
            throw new Error(localize('UnexpectedElement', 'Expected a valid element.'));
        }

        return element.getChildren();
    }

    getResourceItem(element: ApplicationResource): BuiltInResourceModelBase | Thenable<BuiltInResourceModelBase> {
        return new BuiltInApplicationResourceItem(element);
    }

    // TODO: Implement change eventing.
    // onDidChangeTreeData?: vscode.Event<void | BuiltInResourceModelBase | null | undefined> | undefined;

    getTreeItem(element: BuiltInResourceModelBase): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }
}
