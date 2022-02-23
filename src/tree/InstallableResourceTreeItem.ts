/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { GenericResource } from "@azure/arm-resources";
import { AzExtParentTreeItem, AzExtTreeItem, GenericTreeItem, IActionContext, nonNullProp } from "@microsoft/vscode-azext-utils";
import { AzExtWrapper } from "../AzExtWrapper";

export class InstallableResourceTreeItem extends AzExtParentTreeItem {

    constructor(parent: AzExtParentTreeItem, private readonly resource: GenericResource, private readonly azExt: AzExtWrapper) {
        super(parent);
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, _context: IActionContext): Promise<AzExtTreeItem[]> {
        return [
            new GenericTreeItem(this, {
                contextValue: 'Must install extension',
                label: `Install the ${this.azExt.label} extension`,
                id: nonNullProp(this.resource, 'id')
            })
        ]
    }
    public hasMoreChildrenImpl(): boolean {
        return false;
    }
    public label: string = nonNullProp(this.resource, 'name');
    public contextValue: string = 'installableResource';

}
