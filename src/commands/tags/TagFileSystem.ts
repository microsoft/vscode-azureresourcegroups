/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceManagementClient } from "azure-arm-resource";
import * as jsonc from 'jsonc-parser';
import * as os from "os";
import { commands, Diagnostic, FileStat, FileType, MessageItem, Uri, window } from "vscode";
import { AzExtTreeFileSystem, createAzureClient, IActionContext } from 'vscode-azureextensionui';
import { ext } from "../../extensionVariables";
import { ResourceGroupTreeItem } from "../../tree/ResourceGroupTreeItem";
import { ResourceTreeItem } from "../../tree/ResourceTreeItem";
import { localize } from "../../utils/localize";
import { requestUtils } from "../../utils/requestUtils";
import { getTagDiagnostics } from "./getTagDiagnostics";

const insertKeyHere: string = localize('insertTagName', '<Insert tag name>');
const insertValueHere: string = localize('insertTagValue', '<Insert tag value>');

/**
 * For now this file system only supports editing tags.
 * However, the scheme was left generic so that it could support editing other stuff in this extension without needing to create a whole new file system
 */
export class TagFileSystem extends AzExtTreeFileSystem<ResourceGroupTreeItem | ResourceTreeItem> {
    public static scheme: string = 'azureResourceGroups';
    public scheme: string = TagFileSystem.scheme;

    public async statImpl(_context: IActionContext, node: ResourceGroupTreeItem | ResourceTreeItem): Promise<FileStat> {
        const fileContent: string = this.getFileContentFromTags(node.data.tags);
        return { type: FileType.File, ctime: node.cTime, mtime: node.mTime, size: Buffer.byteLength(fileContent) };
    }

    public async readFileImpl(_context: IActionContext, node: ResourceGroupTreeItem | ResourceTreeItem): Promise<Uint8Array> {
        const fileContent: string = this.getFileContentFromTags(node.data.tags);
        return Buffer.from(fileContent);
    }

    public async writeFileImpl(context: IActionContext, node: ResourceGroupTreeItem | ResourceTreeItem, content: Uint8Array, originalUri: Uri): Promise<void> {
        const text: string = content.toString();
        const isResourceGroup: boolean = node instanceof ResourceGroupTreeItem;

        // tslint:disable-next-line: strict-boolean-expressions
        const diagnostics: readonly Diagnostic[] = ext.diagnosticCollection.get(originalUri) || getTagDiagnostics(text);
        if (diagnostics.length > 0) {
            context.telemetry.measurements.tagDiagnosticsLength = diagnostics.length;

            const showErrors: MessageItem = { title: localize('showErrors', 'Show Errors') };
            const message: string = isResourceGroup ?
                localize('errorsExistGroup', 'Failed to upload tags for resource group "{0}".', node.name) :
                localize('errorsExistResource', 'Failed to upload tags for resource "{0}".', node.name);
            // don't wait
            window.showErrorMessage(message, showErrors).then(async (result) => {
                if (result === showErrors) {
                    const openedUri: Uri | undefined = window.activeTextEditor?.document.uri;
                    if (!openedUri || originalUri.query !== openedUri.query) {
                        await this.showTextDocument(node);
                    }

                    await commands.executeCommand('workbench.action.showErrorsWarnings');
                }
            });

            context.errorHandling.suppressDisplay = true;
            // This won't be displayed, but might as well track the first diagnostic for telemetry
            throw new Error(diagnostics[0].message);
        } else {
            const confirmMessage: string = isResourceGroup ?
                localize('confirmTagsGroup', 'Are you sure you want to update tags for resource group "{0}"?', node.name) :
                localize('confirmTagsResource', 'Are you sure you want to update tags for resource "{0}"?', node.name);
            const update: MessageItem = { title: localize('update', 'Update') };
            await ext.ui.showWarningMessage(confirmMessage, { modal: true }, update);

            const tags: {} = <{}>jsonc.parse(text);

            // remove example tag
            if (Object.keys(tags).includes(insertKeyHere) && tags[insertKeyHere] === insertValueHere) {
                delete tags[insertKeyHere];
            }

            const client: ResourceManagementClient = createAzureClient(node.root, ResourceManagementClient);
            if (node instanceof ResourceGroupTreeItem) {
                await client.resourceGroups.update(node.name, { tags });
            } else {
                await updateResourceTags(node, tags);
            }

            const updatedMessage: string = isResourceGroup ?
                localize('updatedTagsGroup', 'Successfully updated tags for resource group "{0}".', node.name) :
                localize('updatedTagsResource', 'Successfully updated tags for resource "{0}".', node.name);
            window.showInformationMessage(updatedMessage);
        }
    }

    public getFilePath(node: ResourceGroupTreeItem | ResourceTreeItem): string {
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

interface ITagProperties {
    properties: {
        tags: {};
    };
}

/**
 * Doesn't seem to be supported for the "azure-arm-resource" npm package. Might be supported in the new "@azure/arm-resource" once we switch over (https://github.com/microsoft/vscode-azuretools/issues/510)
 * Docs: https://docs.microsoft.com/rest/api/resources/tags/updateatscope
 */
async function updateResourceTags(node: ResourceTreeItem, tags: {}): Promise<void> {
    const urlPath: string = `${node.id}/providers/Microsoft.Resources/tags/default?api-version=2019-10-01`;
    const request: requestUtils.Request = await requestUtils.getDefaultAzureRequest(urlPath, node.root, 'PATCH');
    request.headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify({
        operation: 'Replace',
        properties: {
            tags
        }
    });
    const result: ITagProperties = <ITagProperties>JSON.parse(await requestUtils.sendRequest(request));
    node.data.tags = result.properties.tags;
}
