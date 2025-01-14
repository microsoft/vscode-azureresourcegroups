/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureQuickPickItem } from "@microsoft/vscode-azext-utils";
import { AppResource } from "@microsoft/vscode-azext-utils/hostapi";
import { AzExtResourceType, AzureResource } from "api/src";
import { Extension, commands, extensions } from "vscode";
import { apiUtils } from '../api/src/utils/apiUtils';
import { IAzExtMetadata, IAzExtTutorial, azureExtensions } from "./azureExtensions";
import { contributesKey } from "./constants";

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

    private readonly _resourceTypes: AzExtResourceType[];
    private readonly _data: IAzExtMetadata;
    private _verifiedReportIssueCommandId?: string;

    constructor(data: IAzExtMetadata) {
        this._data = data;
        this.id = `${data.publisher || 'ms-azuretools'}.${data.name}`;
        this._resourceTypes = data.resourceTypes;
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

    public matchesResourceType(resource: AppResource): boolean {
        return this._resourceTypes.some(rt => rt === resource.azExtResourceType);
    }

    public matchesApplicationResourceType(resource: AzureResource): boolean {
        return this._resourceTypes.some(rt => rt === resource.resourceType);
    }

    public getCodeExtension(): Extension<apiUtils.AzureExtensionApiProvider> | undefined {
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

    public isInstalled(): boolean {
        return !!this.getCodeExtension();
    }

    public isPrivate(): boolean {
        return this._data.private === true;
    }

    public meetsMinVersion(): boolean {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        return this.getCodeExtension()?.packageJSON?.contributes?.[contributesKey] !== undefined;
    }
}
