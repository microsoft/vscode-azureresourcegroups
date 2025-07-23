import * as vscode from 'vscode';
import { LmToolTreeDataProvider, LmTreeNode } from './lmToolTreeView';

let lmToolTreeProvider: LmToolTreeDataProvider;

export function registerLmToolTreeView(context: vscode.ExtensionContext) {
    lmToolTreeProvider = new LmToolTreeDataProvider();
    const treeView = vscode.window.createTreeView('lmToolTreeView', { treeDataProvider: lmToolTreeProvider });
    context.subscriptions.push(treeView);

    context.subscriptions.push(vscode.commands.registerCommand('lmTool.showTreeView', (input: unknown) => {
        // Accept both { tree: ... } and direct tree node input
        let tree: unknown;
        console.log('Raw input to lmTool.showTreeView:', input);
        if (input && typeof input === 'object' && input !== null) {
            // If input is { tree: ... }, use input.tree
            if ('tree' in input && (input as { tree?: unknown }).tree) {
                tree = (input as { tree?: unknown }).tree;
            } else if ('label' in input) {
                tree = input;
            }
        }
        // If tree is still undefined, but input is a valid tree node, fallback
        if (!tree && input && typeof input === 'object' && input !== null && 'label' in input) {
            tree = input;
        }
        console.log('Updating tree view with new data:', tree);
        if (!tree || typeof tree !== 'object' || tree === null || !('label' in tree) || typeof (tree as { label: unknown }).label !== 'string') {
            lmToolTreeProvider.setTree({ label: 'No data provided or invalid tree structure.' });
            void treeView.reveal({ label: 'No data provided or invalid tree structure.' }, { expand: true, focus: true });
            return;
        }
        lmToolTreeProvider.setTree(tree as LmTreeNode);
        void treeView.reveal(tree as LmTreeNode, { expand: true, focus: true });
    }));
}
