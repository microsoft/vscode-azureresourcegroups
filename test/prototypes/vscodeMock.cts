/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter as NodeEventEmitter } from 'events';
import { URI } from 'vscode-uri';

export const Uri = URI;
export class Disposable {
    constructor(private readonly release: () => void = () => undefined) { }
    dispose(): void { this.release(); }
    static from(...items: Disposable[]): Disposable {
        return new Disposable(() => items.forEach(item => item.dispose()));
    }
}
export class EventEmitter<T> {
    private readonly emitter = new NodeEventEmitter();
    event = (listener: (value: T) => void): Disposable => {
        this.emitter.on('event', listener);
        return new Disposable(() => this.emitter.off('event', listener));
    };
    fire(value: T): void { this.emitter.emit('event', value); }
    dispose(): void { this.emitter.removeAllListeners(); }
}
export class McpHttpServerDefinition {
    constructor(public label: string, public uri: URI, public headers: Record<string, string> = {}, public version?: string) { }
}
export class ThemeIcon { }
export class TreeItem { }
export class CancellationTokenSource {
    private readonly cancelled = new EventEmitter<void>();
    token = { isCancellationRequested: false, onCancellationRequested: this.cancelled.event };
    dispose(): void { this.cancelled.dispose(); }
}
export const l10n = { t: (value: string) => value };
export const ExtensionMode = { Production: 1, Development: 2, Test: 3 };
export const env = { language: 'en', remoteName: undefined };
export const workspace = { isTrusted: true };
export const window = {};
const handlers = new Map<string, () => unknown>();
export const commands = {
    registerCommand: (id: string, handler: () => unknown): Disposable => {
        if (handlers.has(id)) { throw new Error('Duplicate mock command'); }
        handlers.set(id, handler);
        return new Disposable(() => { handlers.delete(id); });
    },
    executeCommand: async (id: string): Promise<unknown> => {
        const handler = handlers.get(id);
        if (!handler) { throw new Error(`Unregistered command: ${id}`); }
        return handler();
    },
};
export const providers = new Map<string, import('vscode').McpServerDefinitionProvider>();
export const lm = {
    registerMcpServerDefinitionProvider: (id: string, provider: import('vscode').McpServerDefinitionProvider): Disposable => {
        providers.set(id, provider);
        return new Disposable(() => { providers.delete(id); });
    },
};
