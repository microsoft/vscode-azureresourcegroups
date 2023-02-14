import assert = require("assert");
import { Event, EventEmitter, TreeItem } from "vscode";
import { WorkspaceResource, WorkspaceResourceBranchDataProvider } from "../../extension.bundle";

export class TestBranchDataProvider implements WorkspaceResourceBranchDataProvider<WorkspaceResource> {

    onDidChangeTreeDataEmitter: EventEmitter<WorkspaceResource | WorkspaceResource[] | undefined | null | void> = new EventEmitter<WorkspaceResource | WorkspaceResource[] | undefined | null | void>();
    onDidChangeTreeData: Event<WorkspaceResource | WorkspaceResource[] | undefined | null | void> = this.onDidChangeTreeDataEmitter.event;

    private _getChildrenCalled = false;
    private _getResourceItemCalled = false;
    private _getTreeItemCalled = false;

    private _childrenMap: Map<WorkspaceResource, WorkspaceResource[]> = new Map();

    registerChildren(parent: WorkspaceResource, children: WorkspaceResource[]): void {
        this._childrenMap.set(parent, children);
    }

    async assertGetChildrenCalledAsync(block: () => Promise<void>): Promise<void> {
        await block();
        assert.strictEqual(this._getChildrenCalled, true, 'Get children was not called');
    }

    async assertGetResourceItemCalledAsync(block: () => Promise<void>): Promise<void> {
        await block();
        assert.strictEqual(this._getResourceItemCalled, true, 'Get resource item was not called');
    }

    async assertGetTreeItemCalledAsync(block: () => Promise<void>): Promise<void> {
        await block();
        assert.strictEqual(this._getTreeItemCalled, true, 'Get tree item was not called');
    }

    getChildren(_element: WorkspaceResource): WorkspaceResource[] {
        this._getChildrenCalled = true;
        return this._childrenMap.get(_element) ?? [];
    }

    getResourceItem(element: WorkspaceResource): WorkspaceResource {
        this._getResourceItemCalled = true;
        return element;
    }

    getTreeItem(element: WorkspaceResource): TreeItem {
        this._getTreeItemCalled = true;
        return new TreeItem(element.name)
    }
}

