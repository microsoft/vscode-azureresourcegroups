/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
    isAnswerEmpty,
    parseRequirementsJson,
    toggleRequirementsOption,
    type RequirementsOption,
} from '../src/webviews/copilotOnRails/views/utils/parseRequirements';

suite('parseRequirements', () => {
    const options: RequirementsOption[] = [
        { label: 'No datastore required', exclusive: true },
        { label: 'Blob Storage' },
        { label: 'PostgreSQL' },
    ];

    test('parses exclusive options', () => {
        const parsed = parseRequirementsJson(JSON.stringify({
            questions: [{
                id: 'dataStores',
                category: 'data',
                question: 'Which data stores does your app need?',
                answer: [],
                status: 'needs_input',
                options,
            }],
        }));

        assert.strictEqual(parsed.questions[0].options?.[0].exclusive, true);
    });

    test('exclusive option replaces concrete and custom selections', () => {
        assert.deepStrictEqual(
            toggleRequirementsOption(['Blob Storage', 'Custom store'], options, 'No datastore required'),
            ['No datastore required'],
        );
    });

    test('concrete option replaces an exclusive selection', () => {
        assert.deepStrictEqual(
            toggleRequirementsOption(['No datastore required'], options, 'PostgreSQL'),
            ['PostgreSQL'],
        );
    });

    test('no datastore sentinel is a non-empty answer', () => {
        assert.strictEqual(isAnswerEmpty([]), true);
        assert.strictEqual(isAnswerEmpty(['No datastore required']), false);
    });
});
