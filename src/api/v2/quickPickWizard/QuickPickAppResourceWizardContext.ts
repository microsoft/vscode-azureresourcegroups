/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApplicationResource, ApplicationSubscription, ResourceModelBase } from '../v2AzureResourcesApi';
import { QuickPickWizardContext } from './QuickPickWizardContext';

export interface QuickPickAppResourceWizardContext<TModel extends ResourceModelBase> extends QuickPickWizardContext<TModel> {
    applicationResource: ApplicationResource | undefined;
    applicationSubscription?: ApplicationSubscription;
}
