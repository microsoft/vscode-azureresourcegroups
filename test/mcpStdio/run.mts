/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

await build({
    entryPoints: ['test/mcpStdio/protocol.ts'],
    outfile: 'dist/mcpStdio.protocol.test.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    alias: {
        vscode: resolve('test/mcpStdio/hostFixture.ts'),
        '@microsoft/vscode-azext-utils': resolve('test/mcpStdio/hostFixture.ts'),
    },
});
const child = spawn(process.execPath, ['--test', '--test-timeout=90000', 'dist/mcpStdio.protocol.test.cjs'], { stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
