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
 * Run 10 died at the build gate — the very first one — because the agent appended a `test: { … }`
 * block after the closing `});` of `defineConfig`. A syntax error in a generated config is the
 * cheapest possible defect to detect offline and one of the most expensive to hit in a paid run,
 * since it blocks every downstream gate.
 */
async function configIssues(files: Record<string, string>): Promise<{ code: string; message: string }[]> {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-cfg-'));
    try {
        for (const [relative, contents] of Object.entries(files)) {
            const target = path.join(workspace, relative);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, contents, 'utf8');
        }
        const result = await validateLocalDebugArtifacts(workspace, '');
        return result.issues.filter(issue => issue.code === 'generatedConfigSyntaxError');
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
}

/** Byte-for-byte the file run 10 generated. */
const RUN_TEN_VITE_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: true, allowedHosts: true, strictPort: false }
});
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    server: { deps: { inline: ['@fluentui/react-components', '@fluentui/react-icons', 'tabster'] } }
  }
});
`;

void test('fires on the botched config merge that killed run 10', async () => {
    const issues = await configIssues({ 'services/web/vite.config.ts': RUN_TEN_VITE_CONFIG });
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /not syntactically valid TypeScript/u);
    assert.match(issues[0].message, /npm run build` fails before any other gate/u);
    // The line/column and TS code make it directly actionable.
    assert.match(issues[0].message, /vite\.config\.ts\(\d+,\d+\): TS1\d{3}/u);
    // And it must name the actual mistake, not just report a parse error.
    assert.match(issues[0].message, /appended\s+after the closing/u);
});

void test('accepts the correct merged config (test block inside defineConfig)', async () => {
    const issues = await configIssues({
        'services/web/vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: true },
  test: {
    environment: 'jsdom',
    server: { deps: { inline: ['@fluentui/react-components', 'tabster'] } },
  },
});
`,
    });
    assert.deepEqual(issues, []);
});

void test('accepts a standalone vitest.config.ts', async () => {
    const issues = await configIssues({
        'services/web/vitest.config.ts': `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    server: { deps: { inline: ['@fluentui/react-components', 'tabster'] } },
  },
});
`,
    });
    assert.deepEqual(issues, []);
});

void test('accepts TypeScript-only syntax that plain JS parsers would reject', async () => {
    // The contract must not fire on satisfies/generics/type imports, or it becomes noise.
    const issues = await configIssues({
        'services/web/vite.config.ts': `import { defineConfig, type UserConfig } from 'vite';

const config = {
  plugins: [] as unknown[],
  server: { host: true },
} satisfies UserConfig;

export default defineConfig(config);
`,
    });
    assert.deepEqual(issues, []);
});

void test('catches a malformed knexfile too', async () => {
    const issues = await configIssues({
        'services/api/knexfile.ts': `export default {
  client: 'pg',
  migrations: { directory: './migrations' },
`,
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /knexfile\.ts/u);
});

void test('ignores config files inside node_modules', async () => {
    const issues = await configIssues({ 'node_modules/dep/vite.config.ts': RUN_TEN_VITE_CONFIG });
    assert.deepEqual(issues, []);
});
