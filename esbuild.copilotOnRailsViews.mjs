/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isAutoDebug, isAutoWatch } from '@microsoft/vscode-azext-eng/esbuild';
import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outdir = path.resolve(__dirname, 'dist', 'copilotOnRails');
const entryDir = path.resolve(__dirname, 'src', 'webviews', 'copilotOnRails', 'views');

/** @type {import('esbuild').BuildOptions} */
const commonConfig = {
    entryPoints: {
        views: path.resolve(entryDir, 'webviewEntry.tsx'),
    },
    bundle: true,
    outdir,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: isAutoWatch,
    minify: !isAutoWatch,
    metafile: isAutoDebug,
    splitting: false,

    inject: [path.resolve(entryDir, 'react-shim.js')],

    loader: {
        '.ts': 'ts',
        '.tsx': 'tsx',
        '.css': 'css',
        '.scss': 'css',
        '.ttf': 'dataurl',
        '.woff': 'dataurl',
        '.woff2': 'dataurl',
    },

    plugins: [
        {
            name: 'sass',
            setup(build) {
                build.onLoad({ filter: /\.s[ac]ss$/ }, async (args) => {
                    const sass = await import('sass');
                    const result = sass.compile(args.path);
                    return {
                        contents: result.css,
                        loader: 'css',
                    };
                });
            },
        },
    ],
    logLevel: 'info',
};

const ctx = await esbuild.context(commonConfig);
await ctx.rebuild();

if (isAutoWatch) {
    await ctx.watch();
    console.log('Watching Copilot on Rails webview bundle...');
} else {
    await ctx.dispose();
}
