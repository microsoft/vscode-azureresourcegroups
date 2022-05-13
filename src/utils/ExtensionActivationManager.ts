/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/*!--------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { contributesKey } from '../constants';

const builtInExtensionIdRegex = /^vscode\./i;

interface AzResourceContributionPoint {
    readonly activation?: {
        readonly onFetch?: string[];
        readonly onResolve?: string[];
    }
}

interface AzExtensionManifest {
    readonly contributes?: {
        readonly [contributesKey]?: AzResourceContributionPoint;
    }
}

export class ExtensionActivationManager implements vscode.Disposable {
    private readonly onFetchExtensions = new Map<string, Set<string>>();
    private readonly onResolveExtensions = new Map<string, Set<string>>();

    private readonly previouslyFetchedTypes = new Set<string>();
    private readonly previouslyResolvedTypes = new Set<string>();

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
            const activation = (ext.packageJSON as AzExtensionManifest)?.contributes?.[contributesKey]?.activation;

            activation?.onFetch?.forEach(fetchType => this.activateOrAddExtensionToActivationList(fetchType, ext.id, 'fetch'));
            activation?.onResolve?.forEach(resolveType => this.activateOrAddExtensionToActivationList(resolveType, ext.id, 'resolve'));
        }
    }

    public onNodeTypeFetched = (type: string): void => this.onNodeType(type, 'fetch');
    public onNodeTypeResolved = (type: string): void => this.onNodeType(type, 'resolve');

    private activateOrAddExtensionToActivationList(type: string, extensionId: string, activationType: 'fetch' | 'resolve'): void {
        const typeLower = type.toLowerCase(); // Cast to lowercase
        const activationList = activationType === 'fetch' ? this.onFetchExtensions : this.onResolveExtensions;
        const previousTypesList = activationType === 'fetch' ? this.previouslyFetchedTypes : this.previouslyResolvedTypes;

        // If we've already fetched/resolved this type, then just activate now, and don't add it to the list to activate
        // This way, if an extension is installed after-the-fact, it will be immediately activated
        if (previousTypesList.has(typeLower)) {
            this.activateExtension(extensionId);
            return;
        }

        if (!activationList.has(typeLower)) {
            activationList.set(typeLower, new Set<string>());
        }

        // allow non-null assertion because we are sure that this key exists due to above check
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        activationList.get(typeLower)!.add(extensionId);
    }

    private onNodeType(type: string, activationType: 'fetch' | 'resolve'): void {
        const typeLower = type.toLowerCase(); // Cast to lowercase
        const activationList = activationType === 'fetch' ? this.onFetchExtensions : this.onResolveExtensions;
        const previousTypesList = activationType === 'fetch' ? this.previouslyFetchedTypes : this.previouslyResolvedTypes;

        previousTypesList.add(typeLower);

        activationList.get(typeLower)?.forEach(extId => this.activateExtension(extId));

        // Remove the type from the registration because all of the subscribed extensions are now activated
        activationList.delete(typeLower);
    }

    private activateExtension(extensionId: string): void {
        const extension = vscode.extensions.getExtension(extensionId);

        if (extension && !extension.isActive) {
            // Activate without waiting
            void extension.activate();
        }
    }
}
