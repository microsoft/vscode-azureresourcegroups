/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import {
    findColumnIndex,
    findKeyValue,
    findSection,
    findTable,
    getServiceStackKind,
    isAzureFunctionsFramework,
    normalizeScaffoldPlanComponent,
    parseScaffoldPlanMarkdown,
    type ScaffoldPlanData,
    type ScaffoldPlanSection,
} from '../../src/webviews/copilotOnRails/views/utils/parseScaffoldPlanMarkdown';
import { getWorkspaceFolderUri } from '../testUtils';

export const scrapbookProjectFolder = 'copilotOnRails-scrapbook';
export const attendanceProjectFolder = 'copilotOnRails-attendance';

suite('parseScaffoldPlanMarkdown', () => {
    suite('attendance project plan', () => {
        let parsedPlan: ScaffoldPlanData;

        suiteSetup(() => {
            parsedPlan = loadPlan(attendanceProjectFolder);
        });

        test('parses the document metadata header', () => {
            assert.strictEqual(parsedPlan.status, 'Awaiting Integration');
            assert.strictEqual(parsedPlan.mode, 'NEW');
            assert.strictEqual(parsedPlan.executionMode, 'auto');
            assert.strictEqual(parsedPlan.parseError, undefined);
        });

        test('extracts the top-level sections in order', () => {
            assert.deepStrictEqual(
                parsedPlan.sections.map((s) => s.title),
                [
                    'Project Overview',
                    'Attendance Compliance API — Azure Functions',
                    'Attendance Compliance Web App — Web App',
                    'Services Required',
                    'Quality Attributes & Tradeoffs',
                    'Prerequisites',
                    'Design System & UI',
                    'Project Structure',
                    'Route Definitions',
                    'Next Steps',
                ],
            );
        });

        test('finds a service Component/Technology table', () => {
            const section = getSection(parsedPlan, 'Attendance Compliance API');
            const table = findTable(section, ['Component', 'Technology']);
            assert.ok(table, 'Expected a Component/Technology table');
            assert.strictEqual(table.rows.find((r) => r[0] === 'Language')?.[1], 'TypeScript');
            assert.strictEqual(table.rows.find((r) => r[0] === 'Orchestration')?.[1], 'docker-compose');
        });

        test('classifies service stacks from their section headers', () => {
            assert.strictEqual(getServiceStackKind(getSection(parsedPlan, 'Attendance Compliance API')), 'backend');
            assert.strictEqual(getServiceStackKind(getSection(parsedPlan, 'Attendance Compliance Web App')), 'frontend');
        });

        test('finds a keyValue from the overview section', () => {
            const section = getSection(parsedPlan, 'Project Overview');
            assert.strictEqual(findKeyValue(section, 'App Type'), 'SPA + API');
        });

        test('parses the workload quality contract', () => {
            const section = getSection(parsedPlan, 'Quality Attributes');
            assert.strictEqual(findKeyValue(section, 'Operating Profile'), 'Standard Production');
            assert.strictEqual(findKeyValue(section, 'Data Classification'), 'Confidential / Personal');
            const table = findTable(section, ['Pillar', 'Workload Target', 'Planned Validation']);
            assert.ok(table);
            assert.deepStrictEqual(
                table.rows.map(row => row[0]),
                ['Reliability', 'Security', 'Cost Optimization', 'Operational Excellence', 'Performance Efficiency'],
            );
        });

        test('specializes the design system color palette and pages', () => {
            const section = getSection(parsedPlan, 'Design System');
            const palette = section.content.find((c) => c.type === 'colorPalette');
            const pages = section.content.find((c) => c.type === 'pages');
            assert.ok(palette && palette.type === 'colorPalette');
            assert.strictEqual(palette.entries.length, 6);
            assert.ok(pages && pages.type === 'pages');
            assert.strictEqual(pages.entries.length, 3);
        });
    });

    suite('scrapbook project plan', () => {
        let parsedPlan: ScaffoldPlanData;

        suiteSetup(() => {
            parsedPlan = loadPlan(scrapbookProjectFolder);
        });

        test('defaults executionMode to Unknown when absent', () => {
            assert.strictEqual(parsedPlan.status, 'Integrating');
            assert.strictEqual(parsedPlan.executionMode, 'Unknown');
        });

        test('parses the Route Definitions table', () => {
            const section = getSection(parsedPlan, 'Route Definitions');
            const table = findTable(section, ['Method', 'Path']);
            assert.ok(table);
            assert.strictEqual(table.rows.length, 11);
        });
    });

    test('findColumnIndex matches a case-insensitive substring by default', () => {
        assert.strictEqual(findColumnIndex(['Tool', 'Installed', 'Version'], 'install'), 1);
        assert.strictEqual(findColumnIndex(['Tool', 'Installed'], 'runtime'), -1);
    });

    test('normalizes model variations in component labels', () => {
        assert.strictEqual(normalizeScaffoldPlanComponent('Backend'), 'Backend');
        assert.strictEqual(normalizeScaffoldPlanComponent('Frontend'), 'Frontend');
        assert.strictEqual(normalizeScaffoldPlanComponent('Programming Language'), 'Language');
        assert.strictEqual(normalizeScaffoldPlanComponent('Execution Runtime'), 'Runtime');
        assert.strictEqual(normalizeScaffoldPlanComponent('Backend Framework'), 'Framework');
        assert.strictEqual(normalizeScaffoldPlanComponent('Package Management'), 'Package Manager');
        assert.strictEqual(normalizeScaffoldPlanComponent('Testing Framework'), 'Test Runner');
    });

    test('recognizes flexible web app section headers', () => {
        for (const title of ['Web App', 'web-app', 'WEB_APP', 'WebApp', 'web application', 'Website', 'Front-End']) {
            assert.strictEqual(getServiceStackKind({ number: 2, title, content: [] }), 'frontend');
        }
    });

    test('recognizes Azure Functions framework labels', () => {
        assert.strictEqual(isAzureFunctionsFramework('Azure Functions'), true);
        assert.strictEqual(isAzureFunctionsFramework('Azure Functions v4 (Node.js v4 model)'), true);
        assert.strictEqual(isAzureFunctionsFramework('Express'), false);
    });
});

function loadPlan(workspaceFolderName: string): ScaffoldPlanData {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(workspaceFolderName), 'project-plan.md');
    const markdown = fs.readFileSync(fixtureUri.fsPath, 'utf8');
    return parseScaffoldPlanMarkdown(markdown);
}

function getSection(plan: ScaffoldPlanData, titleFragment: string): ScaffoldPlanSection {
    const section = findSection(plan, titleFragment);
    assert.ok(section, `Expected a section matching "${titleFragment}"`);
    return section;
}
