/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum ActivityLogPromptType {
    Fix = 'fix',
    Explain = 'explain',
}

export interface GetAzureActivityLogInputSchema {
    treeId?: string;
    promptType?: ActivityLogPromptType;
}
