/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getAutopilotAgentHostConfiguration } from '../../src/webviews/copilotOnRails/extension/autopilot';

suite('Copilot on Rails autopilot', () => {
    test('sets Agent Host mode and approvals without discarding other defaults', () => {
        assert.deepStrictEqual(
            getAutopilotAgentHostConfiguration({
                mode: 'interactive',
                approvals: 'default',
                futureSetting: true,
            }),
            {
                mode: 'autopilot',
                approvals: 'allowAll',
                futureSetting: true,
            },
        );
    });
});
