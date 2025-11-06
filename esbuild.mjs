/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { autoEsbuildOrWatch, autoSelectEsbuildConfig } from '@microsoft/vscode-azext-eng/esbuild';

const baseConfig = autoSelectEsbuildConfig();

/** @type {import('esbuild').BuildOptions} */
const finalConfig = {
    ...baseConfig,
    entryPoints: [
        ...baseConfig.entryPoints,
        {
            in: './src/cloudConsole/cloudShellChildProcess/cloudConsoleLauncher.ts',
            out: 'cloudConsoleLauncher',
        },
    ],
};

await autoEsbuildOrWatch(finalConfig);
