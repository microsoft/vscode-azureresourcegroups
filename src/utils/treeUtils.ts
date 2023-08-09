/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import { URI, Utils } from 'vscode-uri';
import { ext } from '../extensionVariables';

export namespace treeUtils {
    export function getIconPath(iconName: string): URI {
        return Utils.joinPath(getResourcesPath(), `${iconName}.svg`);
    }

    export function getThemedIconPath(iconName: string): TreeItemIconPath {
        return {
            light: Utils.joinPath(getResourcesPath(), 'light', `${iconName}.svg`),
            dark: Utils.joinPath(getResourcesPath(), 'dark', `${iconName}.svg`)
        };
    }

    function getResourcesPath(): URI {
        return Utils.joinPath(ext.context.extensionUri, 'resources');
    }
}
