/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { ScaffoldPlanSection } from '../../src/webviews/copilotOnRails/views/utils/parseScaffoldPlanMarkdown';
import {
    getServiceStackKind,
    isFullySupportedOption,
    isServiceStackSection,
    optionsForField,
} from '../../src/webviews/copilotOnRails/views/utils/scaffoldPlanTechnologyOptions';

suite('scaffold plan technology options', () => {
    test('offers supported backend frameworks for an Azure Functions API', () => {
        const section = serviceSection('Attendance API \u2014 Azure Functions', 'TypeScript', 'Azure Functions');
        const kind = getServiceStackKind(section);
        const options = optionsForField('Framework', 'TypeScript', kind);

        assert.strictEqual(kind, 'backend');
        assert.deepStrictEqual(options, ['Azure Functions', 'Fastify', 'Express']);
        assert.strictEqual(options?.includes('React + Vite'), false);
        assert.strictEqual(isFullySupportedOption('Framework', 'Azure Functions', kind), true);
    });

    test('offers frontend frameworks for a web app section', () => {
        const section = serviceSection('Attendance Web App \u2014 Web App', 'TypeScript', 'React + Vite');
        const kind = getServiceStackKind(section);
        const options = optionsForField('Framework', 'TypeScript', kind);

        assert.strictEqual(kind, 'frontend');
        assert.deepStrictEqual(options, ['React + Vite', 'Next.js', 'Vue + Vite', 'Angular', 'Svelte']);
        assert.strictEqual(options?.includes('Azure Functions'), false);
        assert.deepStrictEqual(optionsForField('Language', 'TypeScript', kind), ['JavaScript', 'TypeScript']);
    });

    test('narrows backend frameworks when the language changes', () => {
        const section = serviceSection('Orders \u2014 Backend', 'TypeScript', 'Fastify');
        const kind = getServiceStackKind(section);

        assert.deepStrictEqual(optionsForField('Framework', 'Python', kind), ['Azure Functions', 'FastAPI', 'Flask']);
        assert.deepStrictEqual(optionsForField('Framework', 'C# (.NET)', kind), ['Azure Functions', 'ASP.NET Core']);
    });

    test('preserves legacy Backend and Frontend row choices', () => {
        const section = legacyStackSection();
        const kind = getServiceStackKind(section);

        assert.strictEqual(kind, 'backend');
        assert.strictEqual(isServiceStackSection(section), true);
        assert.deepStrictEqual(
            optionsForField('Runtime', undefined, kind, false),
            ['JavaScript', 'TypeScript', 'Python', 'C# (.NET)'],
        );
        assert.deepStrictEqual(
            optionsForField('Backend', undefined, kind, false),
            ['Azure Functions v4 (Node.js v4 model)', 'Express.js', 'Fastify', 'Flask', 'FastAPI', 'Spring Boot', 'ASP.NET Core'],
        );
        assert.deepStrictEqual(
            optionsForField('Frontend', undefined, kind, false),
            ['React + Vite', 'Next.js', 'Vue + Vite', 'Angular', 'Svelte', 'Blazor', 'None'],
        );
        assert.strictEqual(isFullySupportedOption('Runtime', 'TypeScript', kind, false), undefined);
        assert.strictEqual(
            isFullySupportedOption('Backend', 'Azure Functions v4 (Node.js v4 model)', kind, false),
            undefined,
        );
    });

    test('recognizes Azure Functions framework label variants', () => {
        const section = serviceSection('Functions service', 'TypeScript', 'Azure Functions v4 (Node.js v4 model)');
        const kind = getServiceStackKind(section);

        assert.strictEqual(kind, 'backend');
        assert.strictEqual(
            isFullySupportedOption('Framework', 'Azure Functions v4 (Node.js v4 model)', kind),
            true,
        );
    });

    test('keeps an unclassified Framework row editable without assuming frontend', () => {
        const section = serviceSection('Reporting Service', 'TypeScript', 'Custom HTTP host');
        const kind = getServiceStackKind(section);
        const options = optionsForField('Framework', 'TypeScript', kind);

        assert.strictEqual(kind, 'unknown');
        assert.strictEqual(options?.includes('Azure Functions'), true);
        assert.strictEqual(options?.includes('React + Vite'), true);
        assert.strictEqual(options?.includes('Azure Functions v4 (Node.js v4 model)'), false);
        assert.strictEqual(isFullySupportedOption('Framework', 'Custom HTTP host', kind), undefined);
    });

    test('does not treat a generic client service name as frontend', () => {
        const section = serviceSection('Client Service \u2014 Node.js Server', 'TypeScript', 'Custom Node Server');

        assert.strictEqual(getServiceStackKind(section), 'unknown');
    });
});

function serviceSection(title: string, language: string, framework: string): ScaffoldPlanSection {
    return {
        number: 2,
        title,
        content: [{
            type: 'table',
            headers: ['Component', 'Technology'],
            rows: [
                ['Language', language],
                ['Framework', framework],
            ],
        }],
    };
}

function legacyStackSection(): ScaffoldPlanSection {
    return {
        number: 2,
        title: 'Runtime & Framework',
        content: [{
            type: 'table',
            headers: ['Component', 'Technology'],
            rows: [
                ['Runtime', 'TypeScript'],
                ['Backend', 'Azure Functions v4 (Node.js v4 model)'],
                ['Frontend', 'React + Vite'],
            ],
        }],
    };
}
