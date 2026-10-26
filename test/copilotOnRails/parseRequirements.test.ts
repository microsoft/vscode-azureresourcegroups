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

    test('restricts backend framework suggestions while preserving explicit custom answers', () => {
        const result = parseRequirementsJson(JSON.stringify({
            services: [{ id: 'api', label: 'API', role: 'backend' }],
            questions: [{
                id: 'api:framework',
                serviceId: 'api',
                question: 'Which framework?',
                status: 'confirmed',
                answer: 'FastAPI',
                options: [{ label: 'Express' }, { label: 'FastAPI' }],
                recommendedChoice: 'Express',
                multiSelect: true,
                allowFreeformInput: false,
            }],
        }));

        const question = result.questions[0];
        assert.deepStrictEqual(question.options?.map(option => option.label), ['Azure Functions']);
        assert.strictEqual(question.answer, 'FastAPI');
        assert.strictEqual(question.recommendedChoice, 'FastAPI');
        assert.strictEqual(question.status, 'confirmed');
        assert.strictEqual(question.multiSelect, false);
        assert.strictEqual(question.allowFreeformInput, true);
    });

    test('recommends Functions for unanswered backend questions, including malformed answer objects', () => {
        for (const answer of [null, '', { framework: 'Express' }]) {
            const result = parseRequirementsJson(JSON.stringify({
                services: [{ id: 'api', label: 'API', role: 'backend' }],
                questions: [{
                    id: 'api:framework',
                    serviceId: 'api',
                    question: 'Which framework?',
                    answer,
                    recommendedChoice: 'Express',
                }],
            }));
            assert.deepStrictEqual(result.questions[0].options?.map(option => option.label), ['Azure Functions']);
            assert.strictEqual(result.questions[0].recommendedChoice, 'Azure Functions');
            assert.strictEqual(result.questions[0].allowFreeformInput, true);
        }
    });

    test('preserves a single legacy framework choice when converting to a single-select question', () => {
        const result = parseRequirementsJson(JSON.stringify({
            services: [{ id: 'api', label: 'API', role: 'backend' }],
            questions: [{
                id: 'api:framework', serviceId: 'api', answer: ['FastAPI'], status: 'confirmed', multiSelect: true,
            }],
        }));
        assert.strictEqual(result.questions[0].answer, 'FastAPI');
        assert.strictEqual(result.questions[0].recommendedChoice, 'FastAPI');
        assert.strictEqual(result.questions[0].status, 'confirmed');
        assert.strictEqual(result.questions[0].multiSelect, false);
    });

    test('requires review for nontext or ambiguous backend framework answers instead of silently selecting Functions', () => {
        for (const answer of [true, 42, ['FastAPI', 'Flask']]) {
            const result = parseRequirementsJson(JSON.stringify({
                services: [{ id: 'api', label: 'API', role: 'backend' }],
                questions: [{
                    id: 'api:framework', serviceId: 'api', answer, status: 'confirmed', recommendedChoice: 'Express',
                }],
            }));
            assert.strictEqual(result.questions[0].answer, null);
            assert.strictEqual(result.questions[0].recommendedChoice, undefined);
            assert.strictEqual(result.questions[0].status, 'needs_input');
            assert.match(result.questions[0].rationale ?? '', /must be a single name/);
        }
    });

    test('does not change frontend, worker, or unidentified-service framework choices', () => {
        for (const role of ['frontend', 'worker', 'invalid']) {
            const result = parseRequirementsJson(JSON.stringify({
                services: [{ id: 'app', label: 'App', role }],
                questions: [{
                    id: 'app:framework',
                    serviceId: 'app',
                    question: 'Which framework?',
                    answer: 'Custom',
                    options: [{ label: 'Custom' }],
                }],
            }));
            assert.deepStrictEqual(result.questions[0].options?.map(option => option.label), ['Custom']);
            assert.strictEqual(result.questions[0].recommendedChoice, undefined);
        }
    });
});
