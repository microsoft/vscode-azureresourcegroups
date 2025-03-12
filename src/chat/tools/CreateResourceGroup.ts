/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtLMTool, IActionContext } from '@microsoft/vscode-azext-utils';
import { IResourceGroupWizardContext } from 'node_modules/@microsoft/vscode-azext-azureutils';
import * as vscode from 'vscode';
import { createResourceGroup } from '../../commands/createResourceGroup';

type CreateResourceGroupArguments = {
    resourceGroupName: string;
    location: 'eastus' | 'westus';
};

export class CreateResourceGroup implements AzExtLMTool<CreateResourceGroupArguments> {
    public prepareInvocation?(_context: IActionContext, options: vscode.LanguageModelToolInvocationPrepareOptions<CreateResourceGroupArguments>, _token: vscode.CancellationToken): vscode.PreparedToolInvocation {
        return {
            confirmationMessages: {
                title: vscode.l10n.t('Create Resource Group'),
                message: vscode.l10n.t('Are you sure you want to create a resource group named "{0}" in location "{1}"?', options.input.resourceGroupName, options.input.location),
            },
            invocationMessage: vscode.l10n.t('Creating resource group'),
        }
    }

    public async invoke(context: IActionContext, options: vscode.LanguageModelToolInvocationOptions<CreateResourceGroupArguments>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        try {
            await createResourceGroup({ ...context, newResourceGroupName: options.input.resourceGroupName, /* _location: options.input.location NOT WORKING */ } as IActionContext & Partial<IResourceGroupWizardContext>);
        } catch (e) {
            if (e instanceof Error) {
                return {
                    content: [new vscode.LanguageModelTextPart(vscode.l10n.t('Failed to create resource group: {0}', e.message))],
                }
            } else {
                return {
                    content: [new vscode.LanguageModelTextPart(vscode.l10n.t('Failed to create resource group: {0}', JSON.stringify(e)))],
                }
            }
        }

        return {
            content: [new vscode.LanguageModelTextPart('Resource group created successfully.')],
        }
    }
}
