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
            'src/webviews/copilotOnRails/views/react-shim.js',
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
    {
        // The Copilot on Rails React views use display strings as object keys (e.g. "Static Web Apps")
        // for lookup maps and the React-required `__html` property in `dangerouslySetInnerHTML`.
        // These don't fit camelCase/PascalCase but are intentional.
        files: ['src/webviews/copilotOnRails/views/**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/naming-convention': 'off',
        },
    },
]);
