/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { parseScaffoldPlanMarkdown } from '../../src/webviews/copilotOnRails/views/utils/parseScaffoldPlanMarkdown';
import { hasMissingBackendFramework, isBackendFrameworkField, isLimitedSupportBackendLanguage, languageDependentFields, matchServiceStackOption, optionsForField } from '../../src/webviews/copilotOnRails/views/utils/serviceStackOptions';

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

    test('matches versioned service tooling to the existing dropdown choice', () => {
        for (const [field, language, value, expected] of [
            ['Runtime', 'Python', 'CPython 3.12', 'CPython'],
            ['Runtime', 'Python', '  cpython v3.12.7  ', 'CPython'],
            ['Runtime', 'TypeScript', 'Node 22 LTS', 'Node'],
            ['Runtime', 'C# (.NET)', '.NET 8.0', '.NET'],
            ['Package Manager', 'Python', 'pip 24.3.1', 'pip'],
            ['Test Runner', 'Python', 'pytest 8.x', 'pytest'],
        ] as const) {
            const options = optionsForField(field, language, 'backend');
            assert.ok(options);
            assert.strictEqual(matchServiceStackOption(value, options), expected);
        }
    });

    test('preserves unknown and incompatible runtime values instead of matching prefixes', () => {
        const options = optionsForField('Runtime', 'Python', 'backend');
        assert.ok(options);
        for (const value of [undefined, '', 'CPython experimental', 'CPython 3.12 with extensions', 'CPythonista', 'Node 22', '<script>CPython 3.12</script>']) {
            assert.strictEqual(matchServiceStackOption(value, options), undefined);
        }
        assert.strictEqual(matchServiceStackOption('CPython', options), 'CPython');
        assert.strictEqual(matchServiceStackOption('PyPy 3.10', options), 'PyPy');
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

    test('allows repairing one-cell backend framework rows before approval', () => {
        for (const label of ['Framework', 'Backend Framework', 'Backend']) {
            for (const framework of ['Azure Functions', 'FastAPI']) {
                const parsed = parseScaffoldPlanMarkdown([
                    '# Project Plan',
                    '## 2. Backend - App',
                    '| Component | Technology |',
                    '| --- | --- |',
                    '| Language | Python |',
                    `| ${label} |`,
                ].join('\n'));
                const table = parsed.sections[0].content.find(content => content.type === 'table');
                assert.ok(table?.type === 'table');
                assert.strictEqual(hasMissingBackendFramework(parsed), true);
                assert.deepStrictEqual(table.rows[1], [label, '']);

                table.rows[1][1] = framework;
                assert.strictEqual(hasMissingBackendFramework(parsed), false);
            }
        }
    });

    test('preserves existing cells while filling missing framework columns', () => {
        const plan = parseScaffoldPlanMarkdown([
            '# Project Plan',
            '## 2. Backend - APIs',
            '| Component | API 1 | API 2 |',
            '| --- | --- | --- |',
            '| Language | Python | TypeScript |',
            '| Framework | FastAPI |',
        ].join('\n'));
        const table = plan.sections[0].content.find(content => content.type === 'table');
        assert.ok(table?.type === 'table');
        assert.deepStrictEqual(table.rows[1], ['Framework', 'FastAPI', '']);
        assert.strictEqual(hasMissingBackendFramework(plan), true);

        table.rows[1][2] = 'Azure Functions';
        assert.strictEqual(hasMissingBackendFramework(plan), false);
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
