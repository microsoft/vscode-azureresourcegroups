/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceManagementModels } from "@azure/arm-resources";
import { commands, Extension, extensions } from "vscode";
import { IAzureQuickPickItem } from "vscode-azureextensionui";
import { AzureExtensionApiProvider } from "vscode-azureextensionui/api";
import { azureExtensions, IAzExtMetadata, IAzExtResourceType, IAzExtTutorial } from "./azureExtensions";

let wrappers: AzExtWrapper[] | undefined;
export function getAzureExtensions(): AzExtWrapper[] {
    if (!wrappers) {
        wrappers = azureExtensions.map(d => new AzExtWrapper(d));
    }
    return wrappers;
}

export function getInstalledAzureExtensions(): AzExtWrapper[] {
    const azExtensions: AzExtWrapper[] = getAzureExtensions();
    return azExtensions.filter(e => !!e.getCodeExtension());
}

export function getInstalledExtensionPicks(): IAzureQuickPickItem<AzExtWrapper>[] {
    return getInstalledAzureExtensions()
        .map(e => { return { label: e.label, data: e }; })
        .sort((a, b) => a.label.localeCompare(b.label));
}

export class AzExtWrapper {
    public readonly id: string;

    private readonly _resourceTypes: IAzExtResourceType[];
    private readonly _data: IAzExtMetadata;
    private _verifiedReportIssueCommandId?: string;

    constructor(data: IAzExtMetadata) {
        this._data = data;
        this.id = `${data.publisher || 'ms-azuretools'}.${data.name}`;
        this._resourceTypes = data.resourceTypes.map(rt => {
            return typeof rt === 'object' ? rt : {
                name: rt,
                matchesResource: () => true
            };
        });
    }

    public get name(): string {
        return this._data.name;
    }

    public get label(): string {
        return this._data.label;
    }

    public get tutorial(): IAzExtTutorial | undefined {
        return this._data.tutorial;
    }

    public matchesResourceType(resource: ResourceManagementModels.GenericResource): boolean {
        return this._resourceTypes.some(rt => {
            return rt.name === resource.type?.toLowerCase() && rt.matchesResource(resource);
        });
    }

    public getCodeExtension(): Extension<AzureExtensionApiProvider> | undefined {
        return extensions.getExtension(this.id);
    }

    public async getReportIssueCommandId(): Promise<string | undefined> {
        if (!this._verifiedReportIssueCommandId && this._data.reportIssueCommandId) {
            const commandIs: string[] = await commands.getCommands(true /* filterInternal */);
            if (commandIs.some(c => c === this._data.reportIssueCommandId)) {
                // We want to verify because older versions of the Azure extensions might not support the "report issue" command yet
                this._verifiedReportIssueCommandId = this._data.reportIssueCommandId;
            }
        }
        return this._verifiedReportIssueCommandId;
    }
}
