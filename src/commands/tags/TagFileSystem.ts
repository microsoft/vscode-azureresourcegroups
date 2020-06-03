/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceManagementClient } from "azure-arm-resource";
import * as jsonc from 'jsonc-parser';
import * as os from "os";
import { commands, Diagnostic, FileStat, FileType, MessageItem, Uri, window } from "vscode";
import { createAzureClient, IActionContext } from 'vscode-azureextensionui';
import { ext } from "../../extensionVariables";
import { ResourceGroupTreeItem } from "../../tree/ResourceGroupTreeItem";
import { localize } from "../../utils/localize";
import { AzExtFileSystem } from "./AzExtFileSystem";
import { getTagDiagnostics } from "./getTagDiagnostics";

const insertKeyHere: string = localize('insertTagName', '<Insert tag name>');
const insertValueHere: string = localize('insertTagValue', '<Insert tag value>');

/**
 * For now this file system only supports editing tags.
 * However, the scheme was left generic so that it could support editing other stuff in this extension without needing to create a whole new file system
 */
export class TagFileSystem extends AzExtFileSystem<ResourceGroupTreeItem> {
    public static scheme: string = 'azureResourceGroups';
    public scheme: string = TagFileSystem.scheme;

    public async statImpl(_context: IActionContext, node: ResourceGroupTreeItem): Promise<FileStat> {
        const fileContent: string = this.getFileContentFromTags(node.data.tags);
        return { type: FileType.File, ctime: node.cTime, mtime: node.mTime, size: Buffer.byteLength(fileContent) };
    }

    public async readFileImpl(_context: IActionContext, node: ResourceGroupTreeItem): Promise<Uint8Array> {
        const fileContent: string = this.getFileContentFromTags(node.data.tags);
        return Buffer.from(fileContent);
    }

    public async writeFileImpl(context: IActionContext, node: ResourceGroupTreeItem, content: Uint8Array, originalUri: Uri): Promise<void> {
        const text: string = content.toString();

        // tslint:disable-next-line: strict-boolean-expressions
        const diagnostics: readonly Diagnostic[] = ext.diagnosticCollection.get(originalUri) || getTagDiagnostics(text);
        if (diagnostics.length > 0) {
            context.telemetry.measurements.tagDiagnosticsLength = diagnostics.length;

            const showErrors: MessageItem = { title: localize('showErrors', 'Show Errors') };
            const message: string = localize('errorsExist', 'Failed to upload tags for resource group "{0}".', node.name);
            // don't wait
            window.showErrorMessage(message, showErrors).then(async (result) => {
                if (result === showErrors) {
                    const openedUri: Uri | undefined = window.activeTextEditor?.document.uri;
                    if (!openedUri || !this.areUrisEqual(originalUri, openedUri)) {
                        await this.showTextDocument(node);
                    }

                    await commands.executeCommand('workbench.action.showErrorsWarnings');
                }
            });

            context.errorHandling.suppressDisplay = true;
            // This won't be displayed, but might as well track the first diagnostic for telemetry
            throw new Error(diagnostics[0].message);
        } else {
            const message: string = localize('confirmTags', 'Are you sure you want to update tags for resource group "{0}"?', node.name);
            const update: MessageItem = { title: localize('update', 'Update') };
            await ext.ui.showWarningMessage(message, { modal: true }, update);

            const tags: {} = <{}>jsonc.parse(text);

            // remove example tag
            if (Object.keys(tags).includes(insertKeyHere) && tags[insertKeyHere] === insertValueHere) {
                delete tags[insertKeyHere];
            }

            const client: ResourceManagementClient = createAzureClient(node.root, ResourceManagementClient);
            await client.resourceGroups.update(node.name, { tags });
            window.showInformationMessage(localize('updatedRgTags', 'Successfully updated tags for resource group "{0}".', node.name));
        }
    }

    public getFilePath(node: ResourceGroupTreeItem): string {
        return `${node.name}-tags.jsonc`;
    }

    private getFileContentFromTags(tags: {} | undefined): string {
        // tslint:disable-next-line: strict-boolean-expressions
        tags = tags || {};

        const comment: string = localize('editAndSave', 'Edit and save this file to upload tags in Azure');
        if (Object.keys(tags).length === 0) {
            tags[insertKeyHere] = insertValueHere;
        }
        return `// ${comment}${os.EOL}${JSON.stringify(tags, undefined, 4)}`;
    }
}
