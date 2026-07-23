/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import { Uri } from 'vscode';
import { getLocalDebugPlanTelemetry, LocalDebugPlanTelemetry, SupportedDebugProjectType, SupportedDebugRuntime } from '../../src/webviews/copilotOnRails/extension/utils/localDebugPlanTelemetryUtils';
import { parseLocalDebugPlanMarkdown } from '../../src/webviews/copilotOnRails/views/utils/parseLocalDebugPlanMarkdown';
import { getWorkspaceFolderUri } from '../testUtils';
import { attendanceProjectFolder, scrapbookProjectFolder } from './parseLocalDebugPlanMarkdown.test';

suite('localDebugPlanTelemetryUtils', () => {
    suite('getLocalDebugPlanTelemetry', () => {
        test('scrapbook project', () => {
            const telemetry = loadLocalDebugPlanTelemetry(scrapbookProjectFolder);

            const expected: LocalDebugPlanTelemetry = {
                planParsedOk: true,
                planExecutionMode: 'guided',
                planSectionCount: 8,

                prereqTotalCount: 7,
                prereqInstalledCount: 6,
                prereqUnknownCount: 1,
                prereqExtensionCount: 1,

                debugNonCompoundOfferedCount: 3,
                debugNonCompoundSelectedCount: 3,
                debugCompoundOfferedCount: 1,
                debugCompoundSelectedCount: 1,
                debugTotalOfferedCount: 4,
                debugTotalSelectedCount: 4,
                debugProjectTypes: [SupportedDebugProjectType.Functions, SupportedDebugProjectType.Functions, SupportedDebugProjectType.FrontendSpa].join(','),
                debugRuntimes: [SupportedDebugRuntime.NodeTS, SupportedDebugRuntime.NodeTS, SupportedDebugRuntime.NodeTS].join(','),
                debugAzureDependencies: 'azure storage|postgresql,azure storage|postgresql,none',
                proxyDetected: true,

                orchestrator: 'docker compose',

                emulatorCount: 2,
                emulatorTypes: 'azurite container,postgresql container',

                hasArchitectureDiagram: true,

                hasDatabase: true,
                hasMigrationSection: true,
                migrationOfferedCount: 1,
                migrationSelectedCount: 1,

                apiTestServiceOfferedCount: 2,
                apiTestServiceSelectedCount: 2,
                apiTestHttpEndpointCount: 12,
                apiTestTriggerCount: 1,
                apiTestTotalCount: 13,

                convenienceScriptOfferedCount: 4,
                convenienceScriptSelectedCount: 4,
            };

            assert.deepStrictEqual(telemetry, expected);
        });

        test('attendance project', () => {
            const telemetry = loadLocalDebugPlanTelemetry(attendanceProjectFolder);

            const expected: LocalDebugPlanTelemetry = {
                planParsedOk: true,
                planExecutionMode: 'auto',
                planSectionCount: 10,

                prereqTotalCount: 7,
                prereqInstalledCount: 6,
                prereqUnknownCount: 1,
                prereqExtensionCount: 1,

                debugNonCompoundOfferedCount: 2,
                debugNonCompoundSelectedCount: 2,
                debugCompoundOfferedCount: 1,
                debugCompoundSelectedCount: 1,
                debugTotalOfferedCount: 3,
                debugTotalSelectedCount: 3,
                debugProjectTypes: [SupportedDebugProjectType.Functions, SupportedDebugProjectType.FrontendSpa].join(','),
                debugRuntimes: [SupportedDebugRuntime.NodeTS, SupportedDebugRuntime.NodeTS].join(','),
                debugAzureDependencies: 'azure storage|postgresql,none',
                proxyDetected: true,

                orchestrator: 'docker compose',

                emulatorCount: 2,
                emulatorTypes: 'azurite container,postgresql container',

                hasArchitectureDiagram: true,

                hasDatabase: true,
                hasMigrationSection: true,
                migrationOfferedCount: 1,
                migrationSelectedCount: 1,

                apiTestServiceOfferedCount: 1,
                apiTestServiceSelectedCount: 1,
                apiTestHttpEndpointCount: 10,
                apiTestTriggerCount: 0,
                apiTestTotalCount: 10,

                convenienceScriptOfferedCount: 4,
                convenienceScriptSelectedCount: 4,
            };

            assert.deepStrictEqual(telemetry, expected);
        });

        test('empty markdown yields safe defaults', () => {
            const telemetry = getLocalDebugPlanTelemetry(parseLocalDebugPlanMarkdown(''));

            assert.strictEqual(telemetry.planParsedOk, true);
            assert.strictEqual(telemetry.planExecutionMode, 'unknown');
            assert.strictEqual(telemetry.planSectionCount, 0);
            assert.strictEqual(telemetry.prereqTotalCount, 0);
            assert.strictEqual(telemetry.debugNonCompoundOfferedCount, 0);
            assert.strictEqual(telemetry.debugTotalOfferedCount, 0);
            assert.strictEqual(telemetry.debugProjectTypes, '');
            assert.strictEqual(telemetry.orchestrator, 'none');
            assert.strictEqual(telemetry.emulatorCount, 0);
            assert.strictEqual(telemetry.hasArchitectureDiagram, false);
            assert.strictEqual(telemetry.hasDatabase, false);
            assert.strictEqual(telemetry.hasMigrationSection, false);
            assert.strictEqual(telemetry.apiTestTotalCount, 0);
        });

        test('reports parse errors via planParsedOk', () => {
            const telemetry = getLocalDebugPlanTelemetry({
                title: 'Local Development Plan',
                status: 'Unknown',
                executionMode: 'Unknown',
                headerNote: '',
                sections: [],
                parseError: { message: 'could not parse' },
            });

            assert.strictEqual(telemetry.planParsedOk, false);
        });

        test('classifies installed prerequisites and extensions', () => {
            const markdown = [
                '# Azure Debug Plan',
                '> **Status:** Implemented',
                '> **Execution Mode:** Auto',
                '',
                '## Prerequisites',
                '',
                '| Tool / Extension | Category | Installed | Version |',
                '|---|---|---|---|',
                '| Node.js | Runtime | ✅ | v24 |',
                '| `ms-azuretools.vscode-azurefunctions` | VS Code extension | ✅ | 1.22.0 |',
            ].join('\n');

            const telemetry = getLocalDebugPlanTelemetry(parseLocalDebugPlanMarkdown(markdown));

            assert.strictEqual(telemetry.prereqTotalCount, 2);
            assert.strictEqual(telemetry.prereqInstalledCount, 2);
            assert.strictEqual(telemetry.prereqUnknownCount, 0);
            assert.strictEqual(telemetry.prereqExtensionCount, 1);
        });

        test('treats both ❌ and ❓ prerequisites as unknown', () => {
            const markdown = [
                '## Prerequisites',
                '',
                '| Tool / Extension | Category | Installed |',
                '|---|---|---|',
                '| Node.js | Runtime | ✅ |',
                '| Docker | Container runtime | ❌ |',
                '| Docker Compose | Orchestrator | ❓ |',
            ].join('\n');

            const telemetry = getLocalDebugPlanTelemetry(parseLocalDebugPlanMarkdown(markdown));

            assert.strictEqual(telemetry.prereqInstalledCount, 1);
            assert.strictEqual(telemetry.prereqUnknownCount, 2);
        });

        test('records offered vs selected when only some rows are checked', () => {
            const markdown = [
                '## Convenience Scripts',
                '',
                '| Generate | Script | Description |',
                '|---|---|---|',
                '| [x] | emulators:start | Start emulators |',
                '| [ ] | emulators:clean | Fresh start |',
                '| [x] | db:migrate | Apply migrations |',
            ].join('\n');

            const telemetry = getLocalDebugPlanTelemetry(parseLocalDebugPlanMarkdown(markdown));

            assert.strictEqual(telemetry.convenienceScriptOfferedCount, 3);
            assert.strictEqual(telemetry.convenienceScriptSelectedCount, 2);
        });

        test('keeps debug attribute lists positionally aligned per service', () => {
            const markdown = [
                '## Debug Configurations',
                '',
                '| Generate | Debug Config Name | Project Type | Runtime | Azure Dependencies |',
                '|---|---|---|---|---|',
                '| [x] | API | functions | node-ts | Azure Storage, PostgreSQL |',
                '| [ ] | Web | frontend-spa | node-ts | — |',
                '| [x] | All | *Compound Config* | | |',
            ].join('\n');

            const telemetry = getLocalDebugPlanTelemetry(parseLocalDebugPlanMarkdown(markdown));

            // Compound row is excluded from the per-service lists but counted separately.
            assert.strictEqual(telemetry.debugProjectTypes, [SupportedDebugProjectType.Functions, SupportedDebugProjectType.FrontendSpa].join(','));
            assert.strictEqual(telemetry.debugRuntimes, [SupportedDebugRuntime.NodeTS, SupportedDebugRuntime.NodeTS].join(','));
            assert.strictEqual(telemetry.debugAzureDependencies, 'azure storage|postgresql,none');
            assert.strictEqual(telemetry.debugNonCompoundOfferedCount, 2);
            assert.strictEqual(telemetry.debugNonCompoundSelectedCount, 1);
            assert.strictEqual(telemetry.debugCompoundOfferedCount, 1);
            assert.strictEqual(telemetry.debugCompoundSelectedCount, 1);
            assert.strictEqual(telemetry.debugTotalOfferedCount, 3);
            assert.strictEqual(telemetry.debugTotalSelectedCount, 2);
            assert.strictEqual(telemetry.hasDatabase, true);
        });

        test('records unlisted project types and runtimes verbatim', () => {
            const markdown = [
                '## Debug Configurations',
                '',
                '| Generate | Debug Config Name | Project Type | Runtime | Azure Dependencies |',
                '|---|---|---|---|---|',
                '| [x] | Worker | background-worker | rust | — |',
                '| [x] | API | app-service | dotnet | — |',
            ].join('\n');

            const telemetry = getLocalDebugPlanTelemetry(parseLocalDebugPlanMarkdown(markdown));

            assert.strictEqual(telemetry.debugProjectTypes, 'background-worker,app-service');
            assert.strictEqual(telemetry.debugRuntimes, 'rust,dotnet');
        });
    });
});

function loadLocalDebugPlanTelemetry(workspaceFolderName: string): LocalDebugPlanTelemetry {
    const fixtureUri = Uri.joinPath(getWorkspaceFolderUri(workspaceFolderName), 'vscode-debug-plan.md');
    const markdown = fs.readFileSync(fixtureUri.fsPath, 'utf8');
    return getLocalDebugPlanTelemetry(parseLocalDebugPlanMarkdown(markdown));
}
