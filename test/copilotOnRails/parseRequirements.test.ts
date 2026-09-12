/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { parseRequirementsJson } from '../../src/webviews/copilotOnRails/views/utils/parseRequirements';

suite('parseRequirementsJson', () => {
    test('rejects valid JSON roots that are not objects', () => {
        for (const content of ['null', '[]', '"requirements"', '42', 'true']) {
            assert.throws(
                () => parseRequirementsJson(content),
                /Requirements JSON must contain an object/,
            );
        }
    });

    test('filters malformed nested values while preserving valid data', () => {
        const result = parseRequirementsJson(JSON.stringify({
            summary: 'Keep this summary',
            questions: [
                null,
                'not a question',
                {
                    id: 'framework',
                    category: 'service',
                    question: 'Which framework?',
                    answer: 'React',
                    status: 'confirmed',
                    options: [
                        { label: 'React', description: 'React with Vite', exclusive: true },
                        { label: 42 },
                        'Vue',
                        null,
                    ],
                },
            ],
            services: [
                { id: 'web', label: 'Web app', role: 'frontend', root: './web' },
                { id: 'api', label: 7, role: 'backend' },
                { id: 'worker', label: 'Worker', role: 'invalid' },
                [],
            ],
            workspaceSignals: {
                rootPath: './app',
                detectedFiles: ['package.json', 42, 'src/index.ts'],
                hasSourceCode: true,
                hasPackageJson: 'yes',
                decision: 'extend',
                decisionReason: false,
            },
        }));

        assert.strictEqual(result.summary, 'Keep this summary');
        assert.deepStrictEqual(result.questions, [{
            id: 'framework',
            category: 'service',
            question: 'Which framework?',
            header: undefined,
            answer: 'React',
            status: 'confirmed',
            rationale: undefined,
            options: [{ label: 'React', description: 'React with Vite', exclusive: true }],
            recommendedChoice: undefined,
            multiSelect: undefined,
            allowFreeformInput: undefined,
            serviceId: undefined,
        }]);
        assert.deepStrictEqual(result.services, [{
            id: 'web',
            label: 'Web app',
            role: 'frontend',
            root: './web',
        }]);
        assert.deepStrictEqual(result.workspaceSignals, {
            rootPath: './app',
            detectedFiles: ['package.json', 'src/index.ts'],
            hasSourceCode: true,
            hasPackageJson: undefined,
            decision: 'extend',
            decisionReason: undefined,
        });
    });

    test('maps unsupported answer objects to null', () => {
        const result = parseRequirementsJson(JSON.stringify({
            questions: [{
                id: 'framework',
                category: 'service',
                question: 'Which framework?',
                answer: { name: 'React' },
                status: 'confirmed',
            }],
        }));

        assert.strictEqual(result.questions[0].answer, null);
    });

    test('omits nested collections whose containers have the wrong type', () => {
        const result = parseRequirementsJson(JSON.stringify({
            questions: 'invalid',
            services: {},
            workspaceSignals: [],
        }));

        assert.deepStrictEqual(result.questions, []);
        assert.strictEqual(result.services, undefined);
        assert.strictEqual(result.workspaceSignals, undefined);
    });
});
