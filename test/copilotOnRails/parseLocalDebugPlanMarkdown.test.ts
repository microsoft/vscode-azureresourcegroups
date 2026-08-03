/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import {
    findColumnIndex,
    findSection,
    findTable,
    firstTable,
    flattenContent,
    isChecked,
    isDebugPlanImplemented,
    type LocalPlanData,
    type LocalPlanSection,
    type LocalPlanTableContent,
    parseLocalDebugPlanMarkdown,
} from '../../src/webviews/copilotOnRails/views/utils/parseLocalDebugPlanMarkdown';
import { getWorkspaceFolderUri } from '../testUtils';

export const scrapbookProjectFolder = 'copilotOnRails-scrapbook';
export const attendanceProjectFolder = 'copilotOnRails-attendance';

suite('parseLocalDebugPlanMarkdown', () => {
    suite('scrapbook local debug plan', () => {
        let parsedPlan: LocalPlanData;

        suiteSetup(() => {
            parsedPlan = loadPlan(scrapbookProjectFolder);
        });

        test('parses the document header', () => {
            assert.strictEqual(parsedPlan.title, 'Azure Debug Plan');
            assert.strictEqual(parsedPlan.status, 'Planning');
            assert.strictEqual(parsedPlan.executionMode, 'Guided');
            assert.strictEqual(parsedPlan.parseError, undefined);
        });

        test('extracts the top-level sections in order', () => {
            assert.deepStrictEqual(
                parsedPlan.sections.map((s) => s.title),
                [
                    'Prerequisites',
                    'Debug Configurations',
                    'Orchestrator',
                    'Emulators',
                    'Architecture Diagram',
                    'Migrations',
                    'API Test Collections',
                    'Convenience Scripts',
                ],
            );
        });

        test('parses the Prerequisites table headers and rows', () => {
            const table = getFirstTable(getSection(parsedPlan, 'Prerequisites'));
            assert.deepStrictEqual(table.headers, [
                'Tool / Extension',
                'Category',
                'Service(s)',
                'Installed',
                'Version',
                'Install',
            ]);
            assert.strictEqual(table.rows.length, 7);
            assert.deepStrictEqual(table.rows[0], ['Node.js', 'Runtime', '*', '✅', 'v24.18.0', '`brew install node`']);
            // The unconfirmed Docker Compose row keeps its ❓ marker intact.
            assert.ok(table.rows.some((row) => row.includes('❓')));
        });

        test('parses the Debug Configurations table and skips <details>/<summary> wrappers', () => {
            const section = getSection(parsedPlan, 'Debug Configurations');
            const table = getFirstTable(section);
            assert.ok(table.headers.includes('Debug Config Name'));
            assert.strictEqual(table.rows.length, 4);
            // Raw HTML wrapper lines must never surface as content.
            const hasHtmlArtifacts = section.content.some(
                (c) => (c.type === 'paragraph' || c.type === 'blockquote') && /<\/?(details|summary)/i.test(c.text),
            );
            assert.strictEqual(hasHtmlArtifacts, false);
        });

        test('captures blockquote callouts (proxy detected / action required)', () => {
            const debug = getSection(parsedPlan, 'Debug Configurations');
            const proxyQuote = debug.content.some((c) => c.type === 'blockquote' && /proxy detected/i.test(c.text));
            assert.ok(proxyQuote, 'expected a "proxy detected" blockquote');

            const prereq = getSection(parsedPlan, 'Prerequisites');
            const actionQuote = prereq.content.some((c) => c.type === 'blockquote' && /action required/i.test(c.text));
            assert.ok(actionQuote, 'expected an "action required" blockquote');
        });

        test('parses the mermaid architecture diagram as a code block', () => {
            const section = getSection(parsedPlan, 'Architecture');
            const codeBlock = section.content.find((c) => c.type === 'codeBlock');
            assert.ok(codeBlock && codeBlock.type === 'codeBlock');
            assert.strictEqual(codeBlock.language, 'mermaid');
            assert.ok(codeBlock.code.includes('graph LR'), codeBlock.code);
        });

        test('records source ranges for navigable blocks', () => {
            const table = getFirstTable(getSection(parsedPlan, 'Emulators'));
            assert.ok(table.lineStart >= 0);
            assert.ok(table.lineEnd >= table.lineStart);
            // One recorded source line per data row (excludes header + separator).
            assert.strictEqual(table.rowLines.length, table.rows.length);
        });
    });

    suite('attendance local debug plan', () => {
        let parsedPlan: LocalPlanData;

        suiteSetup(() => {
            parsedPlan = loadPlan(attendanceProjectFolder);
        });

        test('parses the document header', () => {
            assert.strictEqual(parsedPlan.title, 'Azure Debug Plan');
            assert.strictEqual(parsedPlan.status, 'Implemented');
            assert.strictEqual(parsedPlan.executionMode, 'Auto');
        });

        test('includes the extra Pre-Flight and Checklist sections', () => {
            assert.deepStrictEqual(
                parsedPlan.sections.map((s) => s.title),
                [
                    'Prerequisites',
                    'Debug Configurations',
                    'Orchestrator',
                    'Emulators',
                    'Architecture Diagram',
                    'Migrations',
                    'API Test Collections',
                    'Convenience Scripts',
                    'Pre-Flight Resolution Notes',
                    'Debug Configuration Checklist',
                ],
            );
        });

        test('parses the Debug Configurations table (2 services + 1 compound)', () => {
            const section = getSection(parsedPlan, 'Debug Configurations');
            const table = getFirstTable(section);
            assert.strictEqual(table.rows.length, 3);
            assert.ok(table.rows.some((row) => row.some((cell) => /compound\s+config/i.test(cell))));
        });
    });

    suite('edge cases', () => {
        test('empty markdown yields safe header defaults and no sections', () => {
            const plan = parseLocalDebugPlanMarkdown('');
            assert.strictEqual(plan.title, 'Local Development Plan');
            assert.strictEqual(plan.status, 'Unknown');
            assert.strictEqual(plan.executionMode, 'Unknown');
            assert.strictEqual(plan.headerNote, '');
            assert.deepStrictEqual(plan.sections, []);
        });

        test('normalizes CRLF line endings', () => {
            const plan = parseLocalDebugPlanMarkdown('# Title\r\n\r\n## Section\r\n\r\nBody\r\n');
            assert.strictEqual(plan.title, 'Title');
            assert.strictEqual(plan.sections.length, 1);
            assert.strictEqual(plan.sections[0].title, 'Section');
        });
    });
});

suite('parseLocalDebugPlanMarkdown query helpers', () => {
    const md = [
        '## Prerequisites',
        '',
        '| Tool | Installed |',
        '|---|---|',
        '| Node | ✅ |',
        '',
        '## Debug Configurations',
        '',
        '### Nested Services',
        '',
        '| Generate | Debug Config Name |',
        '|---|---|',
        '| [x] | API |',
        '| [ ] | Web |',
    ].join('\n');
    const plan = parseLocalDebugPlanMarkdown(md);

    test('findSection matches a case-insensitive title fragment, or returns undefined', () => {
        assert.strictEqual(findSection(plan, 'prereq')?.title, 'Prerequisites');
        assert.strictEqual(findSection(plan, 'DEBUG')?.title, 'Debug Configurations');
        assert.strictEqual(findSection(plan, 'does-not-exist'), undefined);
    });

    test('firstTable returns the first table within a section', () => {
        const table = firstTable(getSection(plan, 'Prerequisites'));
        assert.deepStrictEqual(table?.headers, ['Tool', 'Installed']);
    });

    test('flattenContent descends into subsections so nested tables are reachable', () => {
        const section = getSection(plan, 'Debug Configurations');
        // The table lives inside a `###` subsection, so it is only visible once flattened.
        assert.strictEqual(section.content.some((c) => c.type === 'table'), false);
        assert.strictEqual(flattenContent(section.content).some((c) => c.type === 'table'), true);
    });

    test('findTable locates a nested table by its anchor headers', () => {
        const section = getSection(plan, 'Debug Configurations');
        const table = findTable(section, ['Debug Config Name']);
        assert.deepStrictEqual(table?.headers, ['Generate', 'Debug Config Name']);
        assert.strictEqual(findTable(section, ['Missing Header']), undefined);
    });

    test('findColumnIndex matches a case-insensitive substring by default', () => {
        assert.strictEqual(findColumnIndex(['Generate', 'Installed', 'Version'], 'install'), 1);
        assert.strictEqual(findColumnIndex(['Generate', 'Installed'], 'runtime'), -1);
    });

    test('isChecked recognizes a checked box but not an empty or missing one', () => {
        for (const checked of ['[x]', '[X]', '[ x ]']) {
            assert.strictEqual(isChecked(checked), true, checked);
        }
        for (const unchecked of ['[ ]', '[]', '', 'x']) {
            assert.strictEqual(isChecked(unchecked), false, unchecked);
        }
    });

    test('isDebugPlanImplemented tolerates markdown formatting around the status line', () => {
        for (const implemented of [
            '> **Status:** Implemented',
            'Status: Implemented',
            '**Status**: implemented',
            '# Azure Debug Plan\n\n> **Status:** IMPLEMENTED\n',
        ]) {
            assert.strictEqual(isDebugPlanImplemented(implemented), true, implemented);
        }
        for (const notImplemented of [
            '> **Status:** Approved',
            'Status: Planning',
            'The team implemented the feature',
            '',
        ]) {
            assert.strictEqual(isDebugPlanImplemented(notImplemented), false, notImplemented);
        }
    });
});

function loadPlan(workspaceFolderName: string): LocalPlanData {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(workspaceFolderName), 'vscode-debug-plan.md');
    const markdown = fs.readFileSync(fixtureUri.fsPath, 'utf8');
    return parseLocalDebugPlanMarkdown(markdown);
}

function getSection(plan: LocalPlanData, titleFragment: string): LocalPlanSection {
    const section = findSection(plan, titleFragment);
    assert.ok(section, `Expected a section matching "${titleFragment}"`);
    return section;
}

function getFirstTable(section: LocalPlanSection): LocalPlanTableContent {
    const table = firstTable(section);
    assert.ok(table, `Expected a table in section "${section.title}"`);
    return table;
}
