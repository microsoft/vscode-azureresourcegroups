/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as querystring from "querystring";
import { Disposable, Event, EventEmitter, FileChangeEvent, FileChangeType, FileStat, FileSystemError, FileSystemProvider, FileType, Uri, window } from "vscode";
import { AzExtTreeItem, callWithTelemetryAndErrorHandling, IActionContext } from 'vscode-azureextensionui';
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";

const unsupportedError: Error = new Error(localize('notSupported', 'This operation is not supported.'));

// tslint:disable-next-line: no-reserved-keywords
export type TreeItemChangeEvent<T extends AzExtTreeItem> = { type: FileChangeType; treeItem: T };

export abstract class AzExtFileSystem<T extends AzExtTreeItem> implements FileSystemProvider {
    public abstract scheme: string;

    private readonly _emitter: EventEmitter<FileChangeEvent[]> = new EventEmitter<FileChangeEvent[]>();
    private readonly _bufferedEvents: FileChangeEvent[] = [];
    private _fireSoonHandle?: NodeJS.Timer;

    public get onDidChangeFile(): Event<FileChangeEvent[]> {
        return this._emitter.event;
    }

    public abstract statImpl(context: IActionContext, node: T, originalUri: Uri): Promise<FileStat>;
    public abstract readFileImpl(context: IActionContext, node: T, originalUri: Uri): Promise<Uint8Array>;
    public abstract writeFileImpl(context: IActionContext, node: T, content: Uint8Array, originalUri: Uri): Promise<void>;
    public abstract getFilePath(node: T): string;

    public async showTextDocument(node: T): Promise<void> {
        await window.showTextDocument(this.getUri(node));
    }

    public watch(): Disposable {
        return new Disposable(() => {
            // Since we're not actually watching "in Azure" (i.e. polling for changes), there's no need to selectively watch based on the Uri passed in here. Thus there's nothing to dispose
        });
    }

    public async stat(uri: Uri): Promise<FileStat> {
        return await callWithTelemetryAndErrorHandling('stat', async (context) => {
            context.telemetry.suppressIfSuccessful = true;

            const node: T = await this.lookup(context, uri);
            return await this.statImpl(context, node, uri);
            // tslint:disable-next-line: strict-boolean-expressions
        }) || { type: FileType.Unknown, ctime: 0, mtime: 0, size: 0 };
    }

    public async readFile(uri: Uri): Promise<Uint8Array> {
        return await callWithTelemetryAndErrorHandling('readFile', async (context) => {
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;

            const node: T = await this.lookup(context, uri);
            return await this.readFileImpl(context, node, uri);
            // tslint:disable-next-line: strict-boolean-expressions
        }) || Buffer.from('');
    }

    public async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
        await callWithTelemetryAndErrorHandling('writeFile', async (context) => {
            const node: T = await this.lookup(context, uri);
            await this.writeFileImpl(context, node, content, uri);
            await node.refresh();
        });
    }

    public readDirectory(_uri: Uri): [string, FileType][] | Thenable<[string, FileType][]> {
        throw unsupportedError;
    }

    public async createDirectory(_uri: Uri): Promise<void> {
        throw unsupportedError;
    }

    // tslint:disable-next-line: no-reserved-keywords
    public async delete(_uri: Uri): Promise<void> {
        throw unsupportedError;
    }

    public async rename(_uri: Uri): Promise<void> {
        throw unsupportedError;
    }

    /**
     * Uses a simple buffer to group events that occur within a few milliseconds of each other
     * Adapted from https://github.com/microsoft/vscode-extension-samples/blob/master/fsprovider-sample/src/fileSystemProvider.ts
     */
    // tslint:disable-next-line: no-reserved-keywords
    public fireSoon(...events: TreeItemChangeEvent<T>[]): void {
        this._bufferedEvents.push(...events.map(e => {
            return {
                type: e.type,
                uri: this.getUri(e.treeItem)
            };
        }));

        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle);
        }

        this._fireSoonHandle = setTimeout(
            () => {
                this._emitter.fire(this._bufferedEvents);
                this._bufferedEvents.length = 0; // clear buffer
            },
            5
        );
    }

    public areUrisEqual(uri1: Uri, uri2: Uri): boolean {
        return this.getResourceId(uri1) === this.getResourceId(uri2);
    }

    private getUri(node: T): Uri {
        const fileName: string = this.getFilePath(node);
        return Uri.parse(`${this.scheme}:///${fileName}?resourceId=${node.fullId}`);
    }

    private async lookup(context: IActionContext, uri: Uri): Promise<T> {
        const resourceId: string = this.getResourceId(uri);
        const node: T | undefined = await ext.tree.findTreeItem(resourceId, context);
        if (!node) {
            context.telemetry.suppressAll = true;
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;
            throw FileSystemError.FileNotFound(uri);
        } else {
            return node;
        }
    }

    private getResourceId(uri: Uri): string {
        return <string>(querystring.parse(uri.query)).resourceId;
    }
}
