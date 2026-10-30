/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { generateSandboxGroupName, validateSandboxGroupName } from '../src/commands/createContainerAppsSandboxGroup';

suite('Create Container Apps sandbox group', () => {
    test('generates a portal-style default name', () => {
        strictEqual(generateSandboxGroupName(() => Buffer.from([0xdd, 0x6f])), 'sandbox-group-dd6f');
    });

    test('validates sandbox group names', () => {
        strictEqual(validateSandboxGroupName('sandbox-group-1'), undefined);
        strictEqual(validateSandboxGroupName('a'.repeat(32)), undefined);
        strictEqual(validateSandboxGroupName('a'), undefined);
        strictEqual(typeof validateSandboxGroupName(''), 'string');
        strictEqual(typeof validateSandboxGroupName('-sandbox'), 'string');
        strictEqual(typeof validateSandboxGroupName('.sandbox'), 'string');
        strictEqual(typeof validateSandboxGroupName('Sandbox'), 'string');
        strictEqual(typeof validateSandboxGroupName('sandbox-'), 'string');
        strictEqual(typeof validateSandboxGroupName('1-sandbox'), 'string');
        strictEqual(typeof validateSandboxGroupName('sandbox_group'), 'string');
        strictEqual(typeof validateSandboxGroupName('a'.repeat(33)), 'string');
    });
});
