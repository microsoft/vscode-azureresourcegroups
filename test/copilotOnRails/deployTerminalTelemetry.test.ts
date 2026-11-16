/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getDeployTerminalTelemetryKey } from '../../src/webviews/copilotOnRails/extension/openDeployResultView';

suite('deployment terminal telemetry', () => {
    test('deduplicates one terminal artifact without conflating deployment retries', () => {
        const first = getDeployTerminalTelemetryKey('workflow', 'attempt-1', 'deployment-session');
        const enriched = getDeployTerminalTelemetryKey('workflow', 'attempt-1', 'deployment-session');
        const retry = getDeployTerminalTelemetryKey('workflow', 'attempt-2', 'deployment-session');

        assert.strictEqual(first, enriched);
        assert.notStrictEqual(first, retry);
    });
});
