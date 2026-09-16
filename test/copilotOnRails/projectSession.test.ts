/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'mocha';
import { buildResumePrompt, type CopilotSessionState } from '../../src/webviews/copilotOnRails/extension/projectSession';

function sessionState(phase: CopilotSessionState['phase']): CopilotSessionState {
    return {
        phase,
        updatedAt: Date.now(),
        contextRefs: ['.copilot-azure/sessions/active-session.json'],
    };
}

suite('projectSession', () => {
    suite('buildResumePrompt', () => {
        test('requires a fresh inventory baseline before a resumed deployment provisions resources', () => {
            const prompt = buildResumePrompt(sessionState('deploy'));

            assert.match(prompt, /user confirms.*resume/i);
            assert.match(prompt, /capture_deployment_inventory/);
            assert.match(prompt, /phase: "baseline"/);
            assert.match(prompt, /before running any command that can provision resources/i);
            assert.match(prompt, /merge later capture results/i);
        });

        test('does not add deployment inventory instructions when resuming another phase', () => {
            const prompt = buildResumePrompt(sessionState('debug'));

            assert.doesNotMatch(prompt, /capture_deployment_inventory/);
            assert.doesNotMatch(prompt, /provision resources/i);
        });
    });
});