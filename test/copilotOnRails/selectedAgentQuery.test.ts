/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { guardSelectedAgentQuery } from '../../src/utils/copilotOnRails/selectedAgentQuery';

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
