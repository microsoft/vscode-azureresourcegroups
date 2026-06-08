/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { azExtEslintRecommended } from '@microsoft/vscode-azext-eng/eslint'; // Other configurations exist
import { defineConfig } from 'eslint/config';

export default defineConfig([
    azExtEslintRecommended,
    {
        ignores: [
            'api/dist/**',
            'api/out/**',
        ],
    },
    {
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    {
                        group: ['*api/docs*'],
                        message: 'Don\'t import from docs. Import from src instead.',
                    },
                ],
            }],
        },
    },
]);
