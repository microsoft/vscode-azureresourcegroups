/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceManagementClient, Tags } from "@azure/arm-resources";
import { uiUtils } from "@microsoft/vscode-azext-azureutils";
import { AzExtTreeFileSystem, AzExtTreeFileSystemItem, callWithTelemetryAndErrorHandling, createSubscriptionContext, IActionContext, nonNullValue } from '@microsoft/vscode-azext-utils';
import * as jsonc from 'jsonc-parser';
import * as os from "os";
import { commands, Diagnostic, DiagnosticSeverity, FileStat, FileType, languages, MessageItem, Uri, window } from "vscode";
import { AzureResource, AzureSubscription } from "../../../api/src/index";
import { ext } from "../../extensionVariables";
import { createResourceClient } from "../../utils/azureClients";
import { localize } from "../../utils/localize";

const insertKeyHere: string = localize('insertTagName', '<Insert tag name>');
const insertValueHere: string = localize('insertTagValue', '<Insert tag value>');

export interface ITagsModel extends AzExtTreeFileSystemItem {
    getTags(): Promise<Tags['tags']>;
    subscription: AzureSubscription;
    displayName: string;
    displayType: 'resource group' | 'resource';

    cTime: number;
    mTime: number;
}

export class ResourceTags implements ITagsModel {
    constructor(private readonly resource: AzureResource) {
        this.displayType = resource.resourceGroup ? 'resource' : 'resource group';
    }

    readonly id: string = this.resource.id;
    readonly subscription: AzureSubscription = this.resource.subscription;

    readonly displayName: string = this.resource.name;
    readonly displayType: ITagsModel['displayType'];

    cTime!: number;
    mTime!: number;

    async getTags(): Promise<Tags['tags']> {
        return await callWithTelemetryAndErrorHandling('getTags', async (context): Promise<Tags['tags'] | undefined> => {
            const subscriptionContext = createSubscriptionContext(this.resource.subscription);
            const client = await createResourceClient([context, subscriptionContext]);

            if (this.resource.resourceGroup) {
                // use list because getById is only available for certain api versions and locations
                const resources = await uiUtils.listAllIterator(client.resources.listByResourceGroup(nonNullValue(this.resource.resourceGroup)));
                return resources.find(r => r.id === this.id)?.tags;
            } else {
                const resourceGroup = await client.resourceGroups.get(nonNullValue(this.resource.name));
                return resourceGroup.tags;
            }
        }) ?? {};
    }
}

/**
 * File system for editing resource tags.
 */
export class TagFileSystem extends AzExtTreeFileSystem<ITagsModel> {
    public static scheme: string = 'azureResourceGroups';
    public scheme: string = TagFileSystem.scheme;

    public async statImpl(_context: IActionContext, model: ITagsModel): Promise<FileStat> {
        const fileContent: string = this.getFileContentFromTags(await this.getTagsFromNode(model));
        return { type: FileType.File, ctime: model.cTime, mtime: model.mTime, size: Buffer.byteLength(fileContent) };
    }

    public async readFileImpl(_context: IActionContext, node: ITagsModel): Promise<Uint8Array> {
        const fileContent: string = this.getFileContentFromTags(await this.getTagsFromNode(node));
        return Buffer.from(fileContent);
    }

    public async writeFileImpl(context: IActionContext, model: ITagsModel, content: Uint8Array, originalUri: Uri): Promise<void> {
        // weird issue when in vscode.dev, the content Uint8Array has a giant byteOffset that causes it impossible to decode
        // so re-form the buffer with 0 byteOffset
        const buf = Buffer.from(content, 0)
        const text: string = buf.toString('utf-8');

        const diagnostics: Diagnostic[] = languages.getDiagnostics(originalUri).filter(d => d.severity === DiagnosticSeverity.Error);
        if (diagnostics.length > 0) {
            context.telemetry.measurements.tagDiagnosticsLength = diagnostics.length;

            const showErrors: MessageItem = { title: localize('showErrors', 'Show Errors') };
            const message: string = localize('errorsExist', 'Failed to upload tags for {0}.', this.getDetailedName(model));
            void window.showErrorMessage(message, showErrors).then(async (result) => {
                if (result === showErrors) {
                    const openedUri: Uri | undefined = window.activeTextEditor?.document.uri;
                    if (!openedUri || originalUri.query !== openedUri.query) {
                        await this.showTextDocument(model);
                    }

                    await commands.executeCommand('workbench.action.showErrorsWarnings');
                }
            });

            // de-duped, sorted list of diagnostic sources
            context.telemetry.properties.diagnosticSources = diagnostics.map(d => d.source).filter((value, index, array) => value && array.indexOf(value) === index).sort().join(',');
            context.errorHandling.suppressDisplay = true;
            // This won't be displayed, but might as well track the first diagnostic for telemetry
            throw new Error(diagnostics[0].message);
        } else {
            const confirmMessage: string = localize('confirmTags', 'Are you sure you want to update tags for {0}?', this.getDetailedName(model));
            const update: MessageItem = { title: localize('update', 'Update') };
            await context.ui.showWarningMessage(confirmMessage, { modal: true }, update);

            const tags: { [key: string]: string } = <{}>jsonc.parse(text);

            // remove example tag
            if (Object.keys(tags).includes(insertKeyHere) && tags[insertKeyHere] === insertValueHere) {
                delete tags[insertKeyHere];
            }

            const subscriptionContext = createSubscriptionContext(model.subscription);
            const client: ResourceManagementClient = await createResourceClient([context, subscriptionContext]);
            await client.tagsOperations.updateAtScope(model.id, { properties: { tags }, operation: 'Replace' });

            const updatedMessage: string = localize('updatedTags', 'Successfully updated tags for {0}.', this.getDetailedName(model));
            void window.showInformationMessage(updatedMessage);
            ext.outputChannel.appendLog(updatedMessage);
        }
    }

    public getFilePath(node: ITagsModel): string {
        return `${node.displayName}-tags.jsonc`;
    }

    private getFileContentFromTags(tags: {} | undefined): string {
        tags = tags || {};

        const comment: string = localize('editAndSave', 'Edit and save this file to upload tags in Azure');
        if (Object.keys(tags).length === 0) {
            // Make sure to use a new object here because of https://github.com/microsoft/vscode-azureresourcegroups/issues/54
            tags = {
                [insertKeyHere]: insertValueHere
            };
        }
        return `// ${comment}${os.EOL}${JSON.stringify(tags, undefined, 4)}`;
    }

    private async getTagsFromNode(node: ITagsModel): Promise<Tags['tags'] | undefined> {
        return await node.getTags();
    }

    private getDetailedName(node: ITagsModel): string {
        return `${node.displayType} "${node.displayName}"`;
    }
}
