/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { OPEN_PROJECT_FOLDER_OPTIONS, validateProjectSubfolderName } from '../../src/webviews/copilotOnRails/extension/createProjectWithCopilot';

suite('Create Project with Copilot folder selection', () => {
    test('always opens the project folder in a new window', () => {
        assert.deepStrictEqual(OPEN_PROJECT_FOLDER_OPTIONS, { forceNewWindow: true });
    });

    test('accepts a direct child folder name', () => {
        assert.strictEqual(validateProjectSubfolderName('my-project'), undefined);
        assert.strictEqual(validateProjectSubfolderName('My Project'), undefined);
    });

    for (const value of ['', '   ', '.', '..', '../outside', '..\\outside', 'nested/project', 'nested\\project']) {
        test(`rejects unsafe folder name ${JSON.stringify(value)}`, () => {
            assert.ok(validateProjectSubfolderName(value));
        });
    }
});
