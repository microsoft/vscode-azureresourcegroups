/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { gulp_installAzureAccount, gulp_webpack } from '@microsoft/vscode-azext-dev';
import * as fs from 'fs/promises';
import * as gulp from 'gulp';
import * as path from 'path';

declare let exports: { [key: string]: unknown };

async function prepareForWebpack(): Promise<void> {
    const mainJsPath: string = path.join(__dirname, 'main.js');
    let contents: string = (await fs.readFile(mainJsPath)).toString();
    contents = contents
        .replace('out/src/extension', 'dist/extension.bundle')
        .replace(', true /* ignoreBundle */', '');
    await fs.writeFile(mainJsPath, contents);
}

async function listIcons(): Promise<void> {
    const rootPath: string = path.join(__dirname, 'resources', 'providers');
    const subDirs: string[] = (await fs.readdir(rootPath)).filter(dir => dir.startsWith('microsoft.'));
    while (true) {
        const subDir: string | undefined = subDirs.pop();
        if (!subDir) {
            break;
        } else {
            const subDirPath: string = path.join(rootPath, subDir);
            const paths: string[] = await fs.readdir(subDirPath);
            for (const p of paths) {
                const subPath: string = path.posix.join(subDir, p);
                if (subPath.endsWith('.svg')) {
                    console.log(`'${subPath.slice(0, -4)}',`);
                } else {
                    subDirs.push(subPath);
                }
            }
        }
    }
}

async function cleanReadme(): Promise<void> {
    const readmePath: string = path.join(__dirname, 'README.md');
    let data: string = (await fs.readFile(readmePath)).toString();
    data = data.replace(/<!-- region exclude-from-marketplace -->.*?<!-- endregion exclude-from-marketplace -->/gis, '');
    await fs.writeFile(readmePath, data);
}

exports['webpack-dev'] = gulp.series(prepareForWebpack, () => gulp_webpack('development'));
exports['webpack-prod'] = gulp.series(prepareForWebpack, () => gulp_webpack('production'));
exports.preTest = gulp_installAzureAccount;
exports.listIcons = listIcons;
exports.cleanReadme = cleanReadme;
