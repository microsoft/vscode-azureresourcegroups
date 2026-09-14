/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { isJsonObject, readStringRecord } from '../../src/webviews/copilotOnRails/shared/jsonUtils';

suite('jsonUtils', () => {
    suite('isJsonObject', () => {
        test('accepts plain objects', () => {
            assert.strictEqual(isJsonObject({ value: 'test' }), true);
            assert.strictEqual(isJsonObject({}), true);
        });

        test('rejects non-object JSON values', () => {
            for (const value of [null, [], 'value', 42, true]) {
                assert.strictEqual(isJsonObject(value), false);
            }
        });
    });

    suite('readStringRecord', () => {
        test('returns records whose values are all strings', () => {
            assert.deepStrictEqual(readStringRecord({ first: 'one', second: 'two' }), {
                first: 'one',
                second: 'two',
            });
            assert.deepStrictEqual(readStringRecord({}), {});
        });

        test('rejects non-objects and records with non-string values', () => {
            assert.strictEqual(readStringRecord(null), undefined);
            assert.strictEqual(readStringRecord(['one']), undefined);
            assert.strictEqual(readStringRecord({ first: 'one', second: 2 }), undefined);
        });
    });
});
