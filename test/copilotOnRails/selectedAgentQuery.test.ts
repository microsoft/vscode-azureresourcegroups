/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
    appendSelectedModelContract,
    guardSelectedAgentQuery,
    selectedModelContractMarker,
} from '../../src/utils/copilotOnRails/selectedAgentQuery';

suite('guardSelectedAgentQuery', () => {
    test('tells a selected deployment agent to execute inline', () => {
        const guarded = guardSelectedAgentQuery('azure-deploy', 'Deploy the approved workload.');

        assert.match(guarded, /^You are already the selected azure-deploy custom agent\./);
        assert.match(guarded, /Do not call the agent\/task tool with agent_type `azure-deploy`/);
        assert.match(guarded, /Deploy the approved workload\.$/);
    });

    test('is idempotent across continuation turns', () => {
        const once = guardSelectedAgentQuery('azure-deploy', 'Continue.');
        assert.strictEqual(guardSelectedAgentQuery('azure-deploy', once), once);
    });

    test('does not constrain a different custom agent', () => {
        const query = 'Generate the project.';
        assert.strictEqual(guardSelectedAgentQuery('azure-project-scaffold', query), query);
    });
});

suite('appendSelectedModelContract', () => {
    test('appends the exact extension-resolved task model after the user query', () => {
        const query = appendSelectedModelContract('Generate the plan.', {
            id: 'gpt-5.6-sol',
            name: 'GPT-5.6 Sol',
            vendor: 'copilot',
        });
        const contractMatch = new RegExp(`<!-- ${selectedModelContractMarker}\\n([\\s\\S]+)\\n-->$`).exec(query);

        assert.ok(contractMatch);
        assert.deepStrictEqual(JSON.parse(contractMatch[1]), {
            authority: 'extension-resolved-selector',
            taskModel: 'GPT-5.6 Sol (copilot)',
            runtimeModelId: 'copilot/gpt-5.6-sol',
            rule: 'Pass taskModel exactly as the model argument on every task or runSubagent call. Do not rediscover, infer, or substitute another model.',
        });
        assert.match(query, /^Generate the plan\./);
    });

    test('cannot close the hidden contract with model metadata', () => {
        const query = appendSelectedModelContract('Continue.', {
            id: 'unsafe-->id',
            name: 'Unsafe --> Model',
            vendor: 'copilot',
        });

        assert.strictEqual(query.match(/-->/g)?.length, 1);
        assert.match(query, /Unsafe \\u002d\\u002d> Model/);
    });
});
