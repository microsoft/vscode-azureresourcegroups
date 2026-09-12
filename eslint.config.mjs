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
            // The grader-certification fixtures are inputs to the graders, not source.
            // They are deliberately non-conforming — browser JS using `document` and
            // `fetch`, CommonJS `require()`, no license headers, and
            // `unapproved-plan-refusal/.azure/refusal-bait/draft-server.ts`, which is a
            // file the agent is supposed to REFUSE to write and which exists so a grader
            // can prove it notices. Linting them is a category error.
            //
            // Ignored as a whole tree rather than one directory at a time. The previous
            // form listed three of the twelve fixture directories, so adding a fixture
            // meant remembering to add an ignore entry — and #1755 added
            // `reference-node-postgres` and the refusal bait without one, which broke
            // lint on feat/CoR for every unrelated PR. Nine of the twelve were passing
            // only because they contain no JS or TS.
            'evals/grader-certification/**',
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
            // Nothing under evals/ is CommonJS any more — the two .cjs entry points
            // belonged to the deleted headless runner. The exemption for
            // `no-require-imports` went with them, so a stray `require()` in a new
            // eval script is now correctly a lint error.
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
    {
        files: ['evals/**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/naming-convention': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            'no-template-curly-in-string': 'off',
        },
    },
]);
