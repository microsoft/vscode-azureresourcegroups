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

        test('finds a keyValue from the overview section', () => {
            const section = getSection(parsedPlan, 'Project Overview');
            assert.strictEqual(findKeyValue(section, 'App Type'), 'SPA + API');
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
