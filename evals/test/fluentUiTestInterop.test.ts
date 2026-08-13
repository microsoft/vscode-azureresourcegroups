/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateLocalDebugArtifacts } from '../src/artifacts/localDebug';

/**
 * Observed in a real run: the frontend suite aborted at import time with
 * "The requested module 'tabster' is a CommonJS module", burning every repair attempt.
 */
async function buildWorkspace(vitestConfig: string | undefined, options?: {
    testScript?: string;
    dependencies?: Record<string, string>;
    includeTestFile?: boolean;
}): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-fluent-'));
    const web = path.join(root, 'services', 'web');
    await fs.mkdir(path.join(web, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
        name: 'root',
        private: true,
        workspaces: ['services/*'],
    }));
    await fs.writeFile(path.join(web, 'package.json'), JSON.stringify({
        name: 'web',
        scripts: { test: options?.testScript ?? 'vitest run' },
        dependencies: options?.dependencies ?? { '@fluentui/react-components': '^9.0.0' },
    }));
    if (options?.includeTestFile !== false) {
        await fs.writeFile(path.join(web, 'src', 'App.test.tsx'), 'test("renders", () => {});');
    }
    if (vitestConfig !== undefined) {
        await fs.writeFile(path.join(web, 'vitest.config.ts'), vitestConfig);
    }
    return root;
}

async function codes(root: string): Promise<string[]> {
    const result = await validateLocalDebugArtifacts(root, '');
    return result.issues.map(issue => issue.code);
}

const config = (inline: string): string => `
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'jsdom', server: { deps: { inline: ${inline} } } },
});
`;

void test('an anchored regex is reported because vitest matches against the absolute path', async () => {
    // This is the exact config the generator produced. It looks correct and is a silent no-op.
    const root = await buildWorkspace(config('[/^@fluentui\\//, \'tabster\']'));
    assert.ok((await codes(root)).includes('fluentUiTestInteropMissing'));
});

void test('inlining only tabster is reported', async () => {
    // The failing import lives inside @fluentui, so that package must itself be inlined.
    const root = await buildWorkspace(config('[\'tabster\']'));
    assert.ok((await codes(root)).includes('fluentUiTestInteropMissing'));
});

void test('a missing config entirely is reported', async () => {
    const root = await buildWorkspace(undefined);
    assert.ok((await codes(root)).includes('fluentUiTestInteropMissing'));
});

void test('a string entry is accepted', async () => {
    const root = await buildWorkspace(config('[\'@fluentui/react-components\', \'tabster\']'));
    assert.ok(!(await codes(root)).includes('fluentUiTestInteropMissing'));
});

void test('an unanchored regex is accepted', async () => {
    const root = await buildWorkspace(config('[/@fluentui\\//, /tabster/]'));
    assert.ok(!(await codes(root)).includes('fluentUiTestInteropMissing'));
});

void test('inline: true is accepted', async () => {
    const root = await buildWorkspace(config('true'));
    assert.ok(!(await codes(root)).includes('fluentUiTestInteropMissing'));
});

void test('a package that does not use Fluent UI is not reported', async () => {
    const root = await buildWorkspace(undefined, { dependencies: { react: '^18.0.0' } });
    assert.ok(!(await codes(root)).includes('fluentUiTestInteropMissing'));
});

void test('a package with no test files is not reported', async () => {
    // Nothing imports Fluent UI under test, so the interop path is never exercised.
    const root = await buildWorkspace(undefined, { includeTestFile: false });
    assert.ok(!(await codes(root)).includes('fluentUiTestInteropMissing'));
});

void test('a non-vitest runner is not reported', async () => {
    const root = await buildWorkspace(undefined, { testScript: 'jest' });
    assert.ok(!(await codes(root)).includes('fluentUiTestInteropMissing'));
});
