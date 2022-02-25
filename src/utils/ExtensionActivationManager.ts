/*!--------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const builtInExtensionIdRegex = /^vscode\./i;

const activationEventRegex = /^x-onAzNodeType(?<trigger>Fetch|Resolve):(?<type>[\w.\/]+)$/;

export class ExtensionActivationManager implements vscode.Disposable {
    private readonly onFetchExtensions = new Map<string, Set<string>>();
    private readonly onResolveExtensions = new Map<string, Set<string>>();

    private readonly extensionChangeDisposable: vscode.Disposable;

    public constructor() {
        // VSCode doesn't offer any metadata on specifically what has happened when extensions change, so the simplest approach is to just reinitialize
        // It's not so bad since the init process takes only about 2 ms
        this.extensionChangeDisposable = vscode.extensions.onDidChange(this.init, this);

        // Run the initialization
        this.init();
    }

    public dispose(): void {
        this.extensionChangeDisposable?.dispose();
    }

    public init(): void {
        this.onFetchExtensions.clear();
        this.onResolveExtensions.clear();

        const possibleExtensions = vscode.extensions.all
            .filter(ext => !ext.isActive) // We don't need to activate extensions that are already active
            .filter(ext => !builtInExtensionIdRegex.test(ext.id)); // We don't need to look at any built-in extensions (often the majority of them)

        for (const ext of possibleExtensions) {
            const activationEvents: string[] = Array.isArray(ext.packageJSON.activationEvents) ? ext.packageJSON.activationEvents : [];

            for (const activationEvent of activationEvents) {
                const match = activationEventRegex.exec(activationEvent);

                if (match?.groups?.trigger && match?.groups?.type) {
                    this.addExtensionToActivationList(
                        match.groups.type,
                        ext.id,
                        match.groups.trigger === 'Fetch' ? this.onFetchExtensions : this.onResolveExtensions
                    );
                }
            }
        }
    }

    public onNodeTypeFetched = (type: string) => this.onNodeType(type, this.onFetchExtensions);
    public onNodeTypeResolved = (type: string) => this.onNodeType(type, this.onResolveExtensions);

    private addExtensionToActivationList(type: string, extensionId: string, activationList: Map<string, Set<string>>): void {
        const typeLower = type.toLowerCase(); // Cast to lowercase
        if (!activationList.has(typeLower)) {
            activationList.set(typeLower, new Set<string>());
        }

        activationList.get(typeLower)!.add(extensionId);
    }

    private onNodeType(type: string, activationList: Map<string, Set<string>>): void {
        const typeLower = type.toLowerCase(); // Cast to lowercase
        const extensionsToActivate = activationList.get(typeLower);

        if (extensionsToActivate) {
            for (const extensionId of extensionsToActivate.values()) {
                const extension = vscode.extensions.getExtension(extensionId);

                if (extension && !extension.isActive) {
                    // Activate without waiting
                    void extension.activate();
                }
            }
        }

        // Remove the type from the registration because all of the subscribed extensions are now activated
        activationList.delete(typeLower);
    }
}
