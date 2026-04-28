/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as vscode from 'vscode';
import { AzExtResourceType } from '../api/src/AzExtResourceType';
import { buildOverrideMapFromExtensions } from '../src/utils/getResourceTypeOverrides';

function mockExtension(id: string, packageJson: object): vscode.Extension<unknown> {
    return {
        id,
        extensionUri: vscode.Uri.file(`/mock-ext/${id}`),
        extensionPath: `/mock-ext/${id}`,
        isActive: false,
        packageJSON: packageJson,
        extensionKind: vscode.ExtensionKind.UI,
        exports: undefined,
        activate: () => Promise.resolve(undefined),
    };
}

function contributingExt(id: string, type: string, overrides: { displayName?: string; icon?: unknown }): vscode.Extension<unknown> {
    return mockExtension(id, {
        contributes: {
            'x-azResources': {
                azure: {
                    branches: [{ type, ...overrides }]
                }
            }
        }
    });
}

suite('getResourceTypeOverrides', () => {

    test('returns undefined when extension contributes type without displayName or icon', () => {
        // Extension contributes the type but provides neither displayName nor icon
        const map = buildOverrideMapFromExtensions([
            contributingExt('ext.a', AzExtResourceType.FunctionApp, {})
        ]);
        assert.strictEqual(map.get(AzExtResourceType.FunctionApp), undefined);
    });

    test('returns label override when displayName is contributed', () => {
        const map = buildOverrideMapFromExtensions([
            contributingExt('ext.a', AzExtResourceType.FunctionApp, { displayName: 'My Functions' })
        ]);
        const override = map.get(AzExtResourceType.FunctionApp);
        assert.ok(override, 'Expected an override entry');
        assert.strictEqual(override.label, 'My Functions');
    });

    test('returns iconPath (Uri) when a single-string icon is contributed', () => {
        const map = buildOverrideMapFromExtensions([
            contributingExt('ext.a', AzExtResourceType.FunctionApp, { icon: 'resources/icon.svg' })
        ]);
        const override = map.get(AzExtResourceType.FunctionApp);
        assert.ok(override, 'Expected an override entry');
        assert.ok(override.iconPath instanceof vscode.Uri, 'Expected iconPath to be a Uri for a string icon');
        assert.ok((override.iconPath as vscode.Uri).path.endsWith('resources/icon.svg'));
    });

    test('returns iconPath (light/dark) when a light/dark icon is contributed', () => {
        const map = buildOverrideMapFromExtensions([
            contributingExt('ext.a', AzExtResourceType.FunctionApp, {
                icon: { light: 'light/icon.svg', dark: 'dark/icon.svg' }
            })
        ]);
        const override = map.get(AzExtResourceType.FunctionApp);
        assert.ok(override, 'Expected an override entry');
        assert.ok(override.iconPath && typeof override.iconPath === 'object' && 'light' in override.iconPath,
            'Expected iconPath to be a light/dark object');
        const ip = override.iconPath as { light: vscode.Uri; dark: vscode.Uri };
        assert.ok(ip.light.path.endsWith('light/icon.svg'));
        assert.ok(ip.dark.path.endsWith('dark/icon.svg'));
    });

    test('returns no iconPath when a theme icon is contributed', () => {
        const map = buildOverrideMapFromExtensions([
            contributingExt('ext.a', AzExtResourceType.FunctionApp, { icon: '$(rocket)', displayName: 'Keep This' })
        ]);
        const override = map.get(AzExtResourceType.FunctionApp);
        assert.ok(override, 'Expected an override entry (displayName should still be set)');
        assert.strictEqual(override.label, 'Keep This');
        assert.strictEqual(override.iconPath, undefined, 'Theme icon should be ignored');
    });

    test('returns no iconPath when an invalid icon value is contributed', () => {
        // icon: 123 is not a valid path — should be silently ignored
        const map = buildOverrideMapFromExtensions([
            contributingExt('ext.a', AzExtResourceType.FunctionApp, { icon: 123, displayName: 'Keep This' })
        ]);
        const override = map.get(AzExtResourceType.FunctionApp);
        assert.ok(override, 'Expected an override entry (displayName should still be set)');
        assert.strictEqual(override.label, 'Keep This');
        assert.strictEqual(override.iconPath, undefined, 'Invalid icon should be ignored');
    });

    test('conflict resolution: first extension by id wins', () => {
        // 'aaa.ext' sorts before 'zzz.ext', so its contribution should win
        const map = buildOverrideMapFromExtensions([
            contributingExt('zzz.ext', AzExtResourceType.FunctionApp, { displayName: 'ZZZ Label' }),
            contributingExt('aaa.ext', AzExtResourceType.FunctionApp, { displayName: 'AAA Label' }),
        ]);
        const override = map.get(AzExtResourceType.FunctionApp);
        assert.ok(override, 'Expected an override entry');
        assert.strictEqual(override.label, 'AAA Label', 'First by id should win');
    });

    test('returns undefined for a type not claimed by any extension', () => {
        const map = buildOverrideMapFromExtensions([
            contributingExt('ext.a', AzExtResourceType.AppServices, { displayName: 'App Services Override' })
        ]);
        assert.strictEqual(map.get(AzExtResourceType.FunctionApp), undefined);
    });

    test('extensions with no x-azResources contribution are ignored', () => {
        const map = buildOverrideMapFromExtensions([
            mockExtension('ext.no-contrib', { contributes: {} })
        ]);
        assert.strictEqual(map.size, 0);
    });
});
