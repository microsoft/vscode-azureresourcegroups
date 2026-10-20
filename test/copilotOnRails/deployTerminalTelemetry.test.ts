/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getDeployTerminalTelemetryKey } from '../../src/webviews/copilotOnRails/extension/openDeployResultView';

suite('deployment terminal telemetry', () => {
    test('deduplicates one terminal artifact without conflating deployment retries', () => {
        const first = getDeployTerminalTelemetryKey('file:///deploy-result.json', '{"status":"failed"}', 'workflow', 'attempt-1');
        const duplicate = getDeployTerminalTelemetryKey('file:///deploy-result.json', '{"status":"failed"}', 'workflow', 'attempt-1');
        const retry = getDeployTerminalTelemetryKey('file:///deploy-result.json', '{"status":"failed"}', 'workflow', 'attempt-2');

        assert.strictEqual(first, duplicate);
        assert.notStrictEqual(first, retry);
    });
});
