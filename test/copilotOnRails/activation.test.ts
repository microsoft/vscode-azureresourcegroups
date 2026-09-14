/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as vscode from 'vscode';
import { resourcesExtensionId } from '../../src/constants';

suite('Copilot on Rails activation', () => {
    test('the welcome view create command activates the extension', () => {
        const extension = vscode.extensions.getExtension(resourcesExtensionId);
        assert.ok(extension, `Expected ${resourcesExtensionId} to be installed`);

        const activationEvents: unknown = extension.packageJSON.activationEvents;
        assert.ok(Array.isArray(activationEvents), 'Expected activationEvents to be an array');
        assert.ok(
            activationEvents.includes('onCommand:copilotOnRails.createProjectWithCopilot'),
            'The welcome view command must activate the extension before its handler is registered',
        );
    });
});