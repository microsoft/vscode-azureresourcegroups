/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
    isUpdateRecommended,
    parseAzdVersion,
    parseAzVersion,
    parseSemver,
    statusForVersion,
} from '../../src/commands/copilotOnRails/cliVersionUtils';
import {
    cliVersionForTelemetry,
    getCliPrerequisiteTelemetry,
    UNKNOWN_CLI_VERSION,
} from '../../src/commands/copilotOnRails/deploymentCliPrerequisites';
import { type CliPrerequisite } from '../../src/webviews/copilotOnRails/views/utils/deploymentPlanTypes';

suite('cliVersionUtils', () => {
    suite('parseSemver', () => {
        test('extracts the first major.minor.patch triple', () => {
            assert.deepStrictEqual(parseSemver('azd version 1.20.1 (commit abc)'), { major: 1, minor: 20, patch: 1 });
        });

        test('returns undefined when no version is present', () => {
            assert.strictEqual(parseSemver('no version here'), undefined);
            assert.strictEqual(parseSemver(undefined), undefined);
            assert.strictEqual(parseSemver(''), undefined);
        });
    });

    suite('parseAzdVersion', () => {
        test('parses the standard azd version banner', () => {
            assert.strictEqual(
                parseAzdVersion('azd version 1.20.1 (commit 0000000000000000000000000000000000000000)'),
                '1.20.1',
            );
        });

        test('parses a release tag form', () => {
            assert.strictEqual(parseAzdVersion('azure-dev-cli_1.29.0'), '1.29.0');
        });

        test('returns undefined for unconfirmable output', () => {
            assert.strictEqual(parseAzdVersion('command not found: azd'), undefined);
            assert.strictEqual(parseAzdVersion(undefined), undefined);
        });
    });

    suite('parseAzVersion', () => {
        test('parses the default JSON output', () => {
            const json = JSON.stringify({ 'azure-cli': '2.89.0', 'azure-cli-core': '2.89.0', extensions: {} });
            assert.strictEqual(parseAzVersion(json), '2.89.0');
        });

        test('parses the legacy text output', () => {
            assert.strictEqual(parseAzVersion('azure-cli                         2.50.0 *\ncore 2.50.0'), '2.50.0');
        });

        test('returns undefined when azure-cli is absent', () => {
            assert.strictEqual(parseAzVersion('{"other":"1.2.3"}'), undefined);
            assert.strictEqual(parseAzVersion('nonsense'), undefined);
            assert.strictEqual(parseAzVersion(undefined), undefined);
        });
    });

    suite('statusForVersion (Installed / Unknown only)', () => {
        test('a confirmed version is installed', () => {
            assert.strictEqual(statusForVersion('1.2.3'), 'installed');
        });

        test('an unconfirmed version is unknown, never missing', () => {
            assert.strictEqual(statusForVersion(undefined), 'unknown');
            assert.strictEqual(statusForVersion(''), 'unknown');
        });

        test('only ever yields installed or unknown', () => {
            for (const input of ['3.0.0', undefined, '', '0.0.0']) {
                assert.ok(['installed', 'unknown'].includes(statusForVersion(input)));
            }
        });
    });

    suite('isUpdateRecommended (>= 2 minor tolerance)', () => {
        test('flags when two or more minor versions behind', () => {
            assert.strictEqual(isUpdateRecommended('2.87.0', '2.89.0'), true);
            assert.strictEqual(isUpdateRecommended('1.20.0', '1.29.5'), true);
        });

        test('tolerates the most recent minor (one behind)', () => {
            assert.strictEqual(isUpdateRecommended('2.88.0', '2.89.0'), false);
        });

        test('tolerates patch drift on the same minor', () => {
            assert.strictEqual(isUpdateRecommended('2.89.0', '2.89.7'), false);
            assert.strictEqual(isUpdateRecommended('2.89.7', '2.89.0'), false);
        });

        test('flags a whole major version behind', () => {
            assert.strictEqual(isUpdateRecommended('1.29.0', '2.0.0'), true);
        });

        test('does not flag a dev build ahead of latest stable', () => {
            assert.strictEqual(isUpdateRecommended('2.90.0', '2.89.0'), false);
            assert.strictEqual(isUpdateRecommended('2.0.0', '1.29.0'), false);
        });

        test('degrades gracefully when latest-stable lookup fails (undefined latest)', () => {
            assert.strictEqual(isUpdateRecommended('2.10.0', undefined), false);
        });

        test('does not flag when the installed version is unparseable', () => {
            assert.strictEqual(isUpdateRecommended(undefined, '2.89.0'), false);
            assert.strictEqual(isUpdateRecommended('', '2.89.0'), false);
        });
    });

    suite('telemetry helpers', () => {
        test('cliVersionForTelemetry uses a clearly-empty value when unknown', () => {
            assert.strictEqual(cliVersionForTelemetry('1.2.3'), '1.2.3');
            assert.strictEqual(cliVersionForTelemetry(undefined), UNKNOWN_CLI_VERSION);
            assert.strictEqual(UNKNOWN_CLI_VERSION, '');
        });

        test('getCliPrerequisiteTelemetry records versions and update flags for both CLIs', () => {
            const prerequisites: CliPrerequisite[] = [
                {
                    id: 'azd',
                    name: 'Azure Developer CLI (azd)',
                    status: 'installed',
                    version: '1.20.0',
                    latestVersion: '1.29.0',
                    updateRecommended: true,
                    install: { intro: '', commands: [] },
                },
                {
                    id: 'az',
                    name: 'Azure CLI (az)',
                    status: 'unknown',
                    updateRecommended: false,
                    install: { intro: '', commands: [] },
                },
            ];

            assert.deepStrictEqual(getCliPrerequisiteTelemetry(prerequisites), {
                azdVersion: '1.20.0',
                azdUpdateRecommended: true,
                azVersion: '',
                azUpdateRecommended: false,
            });
        });

        test('getCliPrerequisiteTelemetry never crashes on undefined input', () => {
            assert.deepStrictEqual(getCliPrerequisiteTelemetry(undefined), {
                azdVersion: '',
                azdUpdateRecommended: false,
                azVersion: '',
                azUpdateRecommended: false,
            });
        });
    });
});
