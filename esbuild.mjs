/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { autoEsbuildOrWatch, autoSelectEsbuildConfig, createWebviewEsbuildConfig } from '@microsoft/vscode-azext-eng/esbuild';

const configs = autoSelectEsbuildConfig();

/** @type {import('esbuild').BuildOptions} */
configs.extension = {
    ...configs.extension,
    entryPoints: [
        ...configs.extension.entryPoints,
        {
            in: './src/cloudConsole/cloudShellChildProcess/cloudConsoleLauncher.ts',
            out: 'cloudConsoleLauncher',
        },
    ],
};

configs.webview = createWebviewEsbuildConfig({
    entryPoints: {
        views: './src/webviews/copilotOnRails/views/webviewEntry.tsx',
    },
    outdir: './dist/copilotOnRails',
    logLevel: 'info',
});

await autoEsbuildOrWatch(configs);
