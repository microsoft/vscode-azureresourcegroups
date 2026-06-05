/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { openChatWithAgent } from './openChatWithAgent';

export function startAzureDebugGenerate(_context: IActionContext, prompt?: string): Promise<void> {
    return openChatWithAgent('Azure Debug Generate', prompt ?? 'The local debugging plan has been approved. Now generate the artifacts as specified by `.azure/vscode-debug-plan.md`.');
}
