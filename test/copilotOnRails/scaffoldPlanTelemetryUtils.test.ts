/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { getScaffoldPlanTelemetry, SCAFFOLD_PLAN_TELEMETRY_PREFIX, ScaffoldPlanTelemetry } from '../../src/webviews/copilotOnRails/extension/utils/scaffoldPlanTelemetryUtils';
import { parseScaffoldPlanMarkdown } from '../../src/webviews/copilotOnRails/views/utils/parseScaffoldPlanMarkdown';
import { getWorkspaceFolderUri } from '../testUtils';
import { attendanceProjectFolder, scrapbookProjectFolder } from './parseScaffoldPlanMarkdown.test';

suite('scaffoldPlanTelemetryUtils', () => {
    suite('getScaffoldPlanTelemetry', () => {
        test('attendance project', () => {
            const telemetry = loadScaffoldPlanTelemetry(attendanceProjectFolder);

            const expected: ScaffoldPlanTelemetry = {
                planParsedOk: true,
                planExecutionMode: 'auto',
                planMode: 'new',
                planSectionCount: 9,
                planSectionTitles: 'project overview,attendance compliance api — azure functions,attendance compliance web app — web app,services required,prerequisites,design system & ui,project structure,route definitions,next steps',
                appType: 'spa + api',

                serviceCount: 2,
                serviceLanguages: 'typescript',
                serviceRuntimes: 'node',
                serviceFrameworks: 'react + vite',
                servicePackageManagers: 'npm',
                serviceTestRunners: 'vitest',

                azureServiceCount: 3,
                azureServiceTypes: 'blob storage,microsoft entra id,postgresql',
                hasDatabase: true,

                runPrereqTotalCount: 3,
                runPrereqInstalledCount: 3,
                runPrereqUnknownCount: 0,
                debugPrereqTotalCount: 4,
                debugPrereqInstalledCount: 3,
                debugPrereqUnknownCount: 1,
                debugPrereqExtensionCount: 1,
                debugPrereqExtensionIds: 'ms-azuretools.vscode-azurefunctions',

                componentLibrary: 'fluent ui v9',
                pageCount: 3,

                routeCount: 10,
                routeMethods: 'delete,get,post,put',
                authenticatedRouteCount: 9,
            };

            assert.deepStrictEqual(telemetry, expected);
        });

        test('scrapbook project', () => {
            const telemetry = loadScaffoldPlanTelemetry(scrapbookProjectFolder);

            const expected: ScaffoldPlanTelemetry = {
                planParsedOk: true,
                planExecutionMode: 'unknown',
                planMode: 'new',
                planSectionCount: 10,
                planSectionTitles: 'project overview,backend — scrapbook api,frontend — scrapbook web,worker — cleanup worker,services required,prerequisites,design system & ui,project structure,route definitions,next steps',
                appType: 'spa + api',

                serviceCount: 3,
                serviceLanguages: 'typescript',
                serviceRuntimes: 'node',
                serviceFrameworks: 'react + vite',
                servicePackageManagers: 'npm',
                serviceTestRunners: 'vitest',

                azureServiceCount: 2,
                azureServiceTypes: 'blob storage,postgresql',
                hasDatabase: true,

                runPrereqTotalCount: 3,
                runPrereqInstalledCount: 3,
                runPrereqUnknownCount: 0,
                debugPrereqTotalCount: 4,
                debugPrereqInstalledCount: 2,
                debugPrereqUnknownCount: 2,
                debugPrereqExtensionCount: 1,
                debugPrereqExtensionIds: 'ms-azuretools.vscode-azurefunctions',

                componentLibrary: 'fluent ui v9',
                pageCount: 4,

                routeCount: 11,
                routeMethods: 'delete,get,patch,post',
                authenticatedRouteCount: 10,
            };

            assert.deepStrictEqual(telemetry, expected);
        });

        test('empty markdown yields safe defaults', () => {
            const telemetry = getScaffoldPlanTelemetry(parseScaffoldPlanMarkdown(''));

            assert.strictEqual(telemetry.planParsedOk, true);
            assert.strictEqual(telemetry.planExecutionMode, 'unknown');
            assert.strictEqual(telemetry.planMode, 'unknown');
            assert.strictEqual(telemetry.planSectionCount, 0);
            assert.strictEqual(telemetry.planSectionTitles, '');
            assert.strictEqual(telemetry.appType, 'unknown');
            assert.strictEqual(telemetry.serviceCount, 0);
            assert.strictEqual(telemetry.serviceLanguages, '');
            assert.strictEqual(telemetry.azureServiceCount, 0);
            assert.strictEqual(telemetry.hasDatabase, false);
            assert.strictEqual(telemetry.runPrereqTotalCount, 0);
            assert.strictEqual(telemetry.debugPrereqTotalCount, 0);
            assert.strictEqual(telemetry.componentLibrary, 'none');
            assert.strictEqual(telemetry.pageCount, 0);
            assert.strictEqual(telemetry.routeCount, 0);
            assert.strictEqual(telemetry.routeMethods, '');
        });

        test('reports parse errors via planParsedOk', () => {
            const telemetry = getScaffoldPlanTelemetry({
                status: 'Unknown',
                created: 'Unknown',
                mode: 'Unknown',
                executionMode: 'Unknown',
                sections: [],
                parseError: { message: 'could not parse' },
            });

            assert.strictEqual(telemetry.planParsedOk, false);
        });

        test('classifies debug prerequisites and extensions', () => {
            const markdown = [
                '# Project Plan',
                '**Status**: Planning',
                '',
                '## 1. Prerequisites',
                '',
                '### Debug',
                '',
                '| Tool / Extension | Category | Installed | Version |',
                '|---|---|---|---|',
                '| Docker | Container runtime | ✅ | 29 |',
                '| Docker Compose | Orchestrator | ❓ | — |',
                '| `ms-azuretools.vscode-azurefunctions` | VS Code extension | ✅ | 1.22.0 |',
            ].join('\n');

            const telemetry = getScaffoldPlanTelemetry(parseScaffoldPlanMarkdown(markdown));

            assert.strictEqual(telemetry.debugPrereqTotalCount, 3);
            assert.strictEqual(telemetry.debugPrereqInstalledCount, 2);
            assert.strictEqual(telemetry.debugPrereqUnknownCount, 1);
            assert.strictEqual(telemetry.debugPrereqExtensionCount, 1);
            assert.strictEqual(telemetry.debugPrereqExtensionIds, 'ms-azuretools.vscode-azurefunctions');
        });

        test('validates extension ids and strips trailing text', () => {
            const markdown = [
                '# Project Plan',
                '**Status**: Planning',
                '',
                '## 1. Prerequisites',
                '',
                '### Debug',
                '',
                '| Tool / Extension | Category | Installed | Version |',
                '|---|---|---|---|',
                '| `v1.22.0` | Runtime version | ✅ | — |',
                '| `ms-azuretools.vscode-docker` (recommended) | VS Code extension | ❓ | — |',
            ].join('\n');

            const telemetry = getScaffoldPlanTelemetry(parseScaffoldPlanMarkdown(markdown));

            // `v1.22.0` is backticked and dotted but is not a `publisher.name`, so it is not counted.
            // The real id is validated and emitted without the trailing "(recommended)" text.
            assert.strictEqual(telemetry.debugPrereqExtensionCount, 1);
            assert.strictEqual(telemetry.debugPrereqExtensionIds, 'ms-azuretools.vscode-docker');
        });

        test('captures a category-confirmed extension id even without backticks', () => {
            const markdown = [
                '# Project Plan',
                '**Status**: Planning',
                '',
                '## 1. Prerequisites',
                '',
                '### Debug',
                '',
                '| Tool / Extension | Category | Installed | Version |',
                '|---|---|---|---|',
                '| Node.js | Runtime | ✅ | 20 |',
                '| ms-azuretools.vscode-azurefunctions | VS Code extension | ✅ | 1.22.0 |',
            ].join('\n');

            const telemetry = getScaffoldPlanTelemetry(parseScaffoldPlanMarkdown(markdown));

            // `Node.js` is dotted but its category is "Runtime", so it is never treated as an extension.
            // The extension row's Category vouches for it, so its id is captured despite the missing backticks.
            assert.strictEqual(telemetry.debugPrereqExtensionCount, 1);
            assert.strictEqual(telemetry.debugPrereqExtensionIds, 'ms-azuretools.vscode-azurefunctions');
        });

        test('caps and de-duplicates emitted section titles', () => {
            const lines = ['# Project Plan', '**Status**: Planning', ''];
            for (let i = 1; i <= 20; i++) {
                lines.push(`## ${i}. Section ${i}`, '');
            }
            const markdown = lines.join('\n');

            const telemetry = getScaffoldPlanTelemetry(parseScaffoldPlanMarkdown(markdown));

            assert.strictEqual(telemetry.planSectionCount, 20);
            // planSectionTitles is capped at MAX_SECTION_TITLES (15) to bound telemetry length.
            assert.strictEqual(telemetry.planSectionTitles.split(',').length, 15);
        });

        test('exposes a namespaced telemetry prefix', () => {
            assert.strictEqual(SCAFFOLD_PLAN_TELEMETRY_PREFIX, 'projectScaffoldPlan.');
        });
    });
});

function loadScaffoldPlanTelemetry(workspaceFolderName: string): ScaffoldPlanTelemetry {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(workspaceFolderName), 'project-plan.md');
    const markdown = fs.readFileSync(fixtureUri.fsPath, 'utf8');
    return getScaffoldPlanTelemetry(parseScaffoldPlanMarkdown(markdown));
}
