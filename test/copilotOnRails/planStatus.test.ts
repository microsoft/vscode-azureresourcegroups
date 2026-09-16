/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'mocha';
import { replaceProjectPlanStatus } from '../../src/webviews/copilotOnRails/extension/utils/planStatus';

suite('planStatus', () => {
    test('replaces only the canonical status metadata row', () => {
        const plan = [
            '# Project Plan',
            '**Status**: Planning',
            '',
            'A section mentioning Status: Planning must remain unchanged.',
        ].join('\n');

        assert.strictEqual(
            replaceProjectPlanStatus(plan, 'Approved'),
            plan.replace('**Status**: Planning', '**Status**: Approved'),
        );
    });

    test('preserves CRLF line endings and status spacing', () => {
        const plan = '# Project Plan\r\n**Status**:\tPlanning\r\n**Mode**: NEW\r\n';

        assert.strictEqual(
            replaceProjectPlanStatus(plan, 'Approved'),
            '# Project Plan\r\n**Status**:\tApproved\r\n**Mode**: NEW\r\n',
        );
    });

    test('rejects a plan without the canonical status row', () => {
        assert.strictEqual(replaceProjectPlanStatus('# Project Plan\nStatus: Planning', 'Approved'), undefined);
    });
});
