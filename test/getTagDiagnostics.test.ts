/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Diagnostic } from 'vscode';
import { getTagDiagnostics, nonNullValue } from '../extension.bundle';

const invalidTagType: RegExp = /tag value.*type/i;
const invalidTagsType: RegExp = /tags.*object.*pairs/i;
const invalidCharsKey: RegExp = /cannot contain.*characters/i;
const tooManyTags: RegExp = /only 50 tags/i;
const valueTooLong: RegExp = /tag value.*256/i;
const keyTooLong: RegExp = /tag name.*512/i;

suite('getTagDiagnostics', () => {
    interface IExpectedDiagnostic {
        range: [number, number, number, number];
        error: RegExp;
    }

    interface ITestCase {
        name: string;
        text: unknown;
        diagnostics: IExpectedDiagnostic[];
    }

    const testCases: ITestCase[] = [
        {
            name: 'valid',
            text: { test: 'test' },
            diagnostics: []
        },
        //#region Invalid tags type
        {
            name: 'numberTags',
            text: 3,
            diagnostics: [
                { range: [0, 0, 0, 1], error: invalidTagsType }
            ]
        },
        {
            name: 'booleanTags',
            text: true,
            diagnostics: [
                { range: [0, 0, 0, 4], error: invalidTagsType }
            ]
        },
        {
            name: 'arrayTags',
            text: [],
            diagnostics: [
                { range: [0, 0, 0, 2], error: invalidTagsType }
            ]
        },
        {
            name: 'nestedArrayTags',
            text: [[]],
            diagnostics: [
                { range: [0, 0, 2, 1], error: invalidTagsType }
            ]
        },
        //#endregion
        //#region Invalid prop type
        {
            name: 'numberProp',
            text: { test: 3 },
            diagnostics: [
                { range: [1, 12, 1, 13], error: invalidTagType }
            ]
        },
        {
            name: 'booleanProp',
            text: { test: true },
            diagnostics: [
                { range: [1, 12, 1, 16], error: invalidTagType }
            ]
        },
        {
            name: 'arrayProp',
            text: { test: [] },
            diagnostics: [
                { range: [1, 12, 1, 14], error: invalidTagType }
            ]
        },
        {
            name: 'nestedArrayProp',
            text: { test: [[]] },
            diagnostics: [
                { range: [1, 12, 3, 5], error: invalidTagType }
            ]
        },
        {
            name: 'objectProp',
            text: { test: {} },
            diagnostics: [
                { range: [1, 12, 1, 14], error: invalidTagType }
            ]
        },
        {
            name: 'nestedObjectProp',
            text: { test: { test2: {} } },
            diagnostics: [
                { range: [1, 12, 3, 5], error: invalidTagType }
            ]
        },
        {
            name: 'nestObjectWithInvalidProp',
            text: { test: { 'test%2': {} } },
            diagnostics: [
                { range: [1, 12, 3, 5], error: invalidTagType }
            ]
        },
        //#endregion
        {
            name: 'disallowedCharKey',
            text: { 'tes%t': 'test' },
            diagnostics: [
                { range: [1, 4, 1, 11], error: invalidCharsKey }
            ]
        },
        {
            name: 'tooLongKey',
            text: (() => {
                const value = {} as { [key: string]: unknown };
                value['a'.repeat(513)] = 'test';
                return value;
            })(),
            diagnostics: [
                { range: [1, 4, 1, 519], error: keyTooLong }
            ]
        },
        {
            name: 'tooLongProp',
            text: { test: 'a'.repeat(257) },
            diagnostics: [
                { range: [1, 12, 1, 271], error: valueTooLong }
            ]
        },
        {
            name: 'tooManyProps',
            text: (() => {
                const value = {} as { [key: string]: unknown };
                let count: number = 0;
                while (count < 52) {
                    value[String(count)] = 'test';
                    count += 1;
                }
                return value;
            })(),
            diagnostics: [
                { range: [51, 4, 51, 8], error: tooManyTags },
                { range: [52, 4, 52, 8], error: tooManyTags }
            ]
        },
        {
            name: 'multipleErrors',
            text: {
                test: '5',
                'test/': '3',
                test2: '5',
                test3: false
            },
            diagnostics: [
                { range: [2, 4, 2, 11], error: invalidCharsKey },
                { range: [4, 13, 4, 18], error: invalidTagType }
            ]
        }
    ];

    for (const testCase of testCases) {
        test(testCase.name, () => {
            const text = typeof testCase.text === 'object' ? JSON.stringify(testCase.text, undefined, 4) : String(testCase.text);
            const diagnostics: Diagnostic[] = getTagDiagnostics(text);
            assert.strictEqual(diagnostics.length, testCase.diagnostics.length, 'Number of diagnostics does not match.');
            for (const actual of diagnostics) {
                const expected = nonNullValue(testCase.diagnostics.shift());
                const [startLine, startChar, endLine, endChar]: number[] = expected.range;
                assert.strictEqual(actual.range.start.line, startLine, 'Start line does not match.');
                assert.strictEqual(actual.range.start.character, startChar, 'Start char does not match.');
                assert.strictEqual(actual.range.end.line, endLine, 'End line does not match.');
                assert.strictEqual(actual.range.end.character, endChar, 'End char does not match.');
                assert.ok(expected.error.test(actual.message), 'Message does not match.');
            }
        });
    }
});
