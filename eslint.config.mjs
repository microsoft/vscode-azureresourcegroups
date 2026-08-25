/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { azExtEslintRecommended } from '@microsoft/vscode-azext-eng/eslint'; // Other configurations exist
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
    azExtEslintRecommended,
    {
        ignores: [
            'api/dist/**',
            'api/out/**',
            'evals/grader-certification/reference-node-fullstack/**',
            'evals/grader-certification/sample-agent-output/**',
            'evals/msbench/.staged/**',
            'evals/vscode-parity/**',
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
        // The eval harness is plain Node JS (.cjs/.mjs) run directly by node — it is not
        // part of the extension's TypeScript program, so the type-aware project service
        // can't resolve these files. Lint them without type information, against Node globals.
        files: ['evals/**/*.{js,cjs,mjs}'],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: false,
                project: null,
            },
            globals: {
                __dirname: 'readonly',
                __filename: 'readonly',
                Buffer: 'readonly',
                console: 'readonly',
                crypto: 'readonly',
                exports: 'writable',
                module: 'writable',
                process: 'readonly',
                require: 'readonly',
            },
        },
        rules: {
            // run-eval.cjs and generate-report.cjs are CommonJS entry points by design.
            '@typescript-eslint/no-require-imports': 'off',
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
