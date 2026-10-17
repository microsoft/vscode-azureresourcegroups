/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { parseScaffoldPlanMarkdown } from '../../src/webviews/copilotOnRails/views/utils/parseScaffoldPlanMarkdown';
import { hasMissingBackendFramework, isBackendFrameworkField, isLimitedSupportBackendLanguage, languageDependentFields, optionsForField } from '../../src/webviews/copilotOnRails/views/utils/serviceStackOptions';

suite('serviceStackOptions', () => {
    test('offers only Azure Functions for APIs regardless of language', () => {
        for (const language of ['Python', ' Python ', 'TypeScript', 'JavaScript', 'C# (.NET)', 'Go', undefined]) {
            assert.deepStrictEqual(optionsForField('Framework', language, 'backend'), ['Azure Functions']);
            assert.deepStrictEqual(optionsForField('Backend', language, 'unknown'), ['Azure Functions']);
        }
    });

    test('preserves frontend choices and language-specific tooling', () => {
        assert.deepStrictEqual(optionsForField('Framework', 'TypeScript', 'frontend'), ['React + Vite', 'Next.js', 'Vue + Vite', 'Angular', 'Svelte']);
        assert.deepStrictEqual(optionsForField('Language', 'Python', 'frontend'), ['JavaScript', 'TypeScript']);
        assert.deepStrictEqual(optionsForField('Runtime', 'Python', 'backend'), ['CPython', 'PyPy']);
        assert.deepStrictEqual(optionsForField('Package Manager', 'Python', 'backend'), ['pip', 'poetry', 'uv']);
        assert.deepStrictEqual(optionsForField('Package Manager', 'C# (.NET)', 'backend'), ['dotnet (NuGet)']);
        assert.deepStrictEqual(optionsForField('Test Runner', 'TypeScript', 'backend'), ['vitest', 'jest', 'mocha']);
    });

    test('excludes backend frameworks from the language-change cascade', () => {
        assert.ok(!languageDependentFields.filter(field => !isBackendFrameworkField(field, 'backend')).includes('Framework'));
        assert.ok(languageDependentFields.filter(field => !isBackendFrameworkField(field, 'frontend')).includes('Framework'));
    });

    test('does not flag Python as a limited-support language', () => {
        for (const language of ['Python', 'python', 'CPython', 'TypeScript', 'JavaScript']) {
            assert.strictEqual(isLimitedSupportBackendLanguage(language), false);
        }
        for (const language of ['C# (.NET)', '.NET', 'C#']) {
            assert.strictEqual(isLimitedSupportBackendLanguage(language), true);
        }
    });

    test('requires a nonempty backend framework but accepts custom frameworks', () => {
        for (const framework of ['Azure Functions', 'Azure Functions v4 (Python v2 model)', 'FastAPI', '<custom framework>']) {
            assert.strictEqual(hasMissingBackendFramework(stackPlan('Backend', framework)), false);
        }
        for (const framework of ['', '   ']) {
            assert.strictEqual(hasMissingBackendFramework(stackPlan('Backend', framework)), true);
            assert.strictEqual(hasMissingBackendFramework(stackPlan('Frontend', framework)), false);
        }
    });

    test('supports legacy Backend Framework labels and incomplete value cells', () => {
        const plan = stackPlan('Backend', '');
        const table = plan.sections[0].content.find(content => content.type === 'table');
        assert.ok(table?.type === 'table');
        table.rows[1] = ['Backend Framework'];
        assert.strictEqual(hasMissingBackendFramework(plan), true);
    });

    test('does not block approval on noneditable overview or unrelated framework rows', () => {
        const plan = parseScaffoldPlanMarkdown([
            '# Project Plan',
            '## 1. Project Overview',
            '| Component | Technology |',
            '| --- | --- |',
            '| Backend | |',
            '## 6. Design System',
            '| Component | Technology |',
            '| --- | --- |',
            '| Framework | |',
        ].join('\n'));
        assert.strictEqual(hasMissingBackendFramework(plan), false);
    });
});

function stackPlan(role: string, framework: string) {
    return parseScaffoldPlanMarkdown([
        '# Project Plan',
        `## 2. ${role} - App`,
        '| Component | Technology |',
        '| --- | --- |',
        '| Language | Python |',
        `| Framework | ${framework} |`,
    ].join('\n'));
}
