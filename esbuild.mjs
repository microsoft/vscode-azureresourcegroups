/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { autoEsbuildOrWatch, autoSelectEsbuildConfig } from '@microsoft/vscode-azext-eng/esbuild';
import { copy } from 'esbuild-plugin-copy';

const { extensionConfig, telemetryConfig } = autoSelectEsbuildConfig();

/** @type {import('esbuild').BuildOptions} */
const finalConfig = {
    ...extensionConfig,
    entryPoints: [
        ...extensionConfig.entryPoints,
        {
            in: './src/cloudConsole/cloudShellChildProcess/cloudConsoleLauncher.ts',
            out: 'cloudConsoleLauncher',
        },
    ],
    plugins: [
        ...extensionConfig.plugins,
        copy({
            assets: [
                {
                    from: './node_modules/@microsoft/vscode-azext-azureutils/resources/azureIcons/*.svg',
                    to: './node_modules/@microsoft/vscode-azext-azureutils/resources/azureIcons',
                },
            ],
        }),
    ],
};

await autoEsbuildOrWatch({ extensionConfig: finalConfig, telemetryConfig });
