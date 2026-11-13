/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { resolveAutopilotSelection } from '../../src/webviews/copilotOnRails/views/utils/autopilotSelection';

suite('Autopilot selection', () => {
    test('uses the artifact default before the user edits the switch', () => {
        assert.strictEqual(resolveAutopilotSelection(false, false, 'auto'), true);
        assert.strictEqual(resolveAutopilotSelection(true, false, 'guided'), false);
    });

    test('preserves a user-edited selection when plan data refreshes', () => {
        assert.strictEqual(resolveAutopilotSelection(false, true, 'auto'), false);
        assert.strictEqual(resolveAutopilotSelection(true, true, 'guided'), true);
    });
});
