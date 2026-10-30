/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';
import {
    COR_PROJECT_MARKER_PATH,
    createCorProjectMarker,
    parseCorProjectMarker,
    writeCorProjectMarker,
} from '../../src/utils/copilotOnRails/corProjectMarker';

const corProjectId = '11111111-1111-4111-8111-111111111111';
const expectedMarker = {
    schemaVersion: 1,
    source: 'copilot-on-rails',
    corProjectId,
};
const expectedContent = JSON.stringify(expectedMarker);

suite('CoR project marker', () => {
    test('uses the exact bounded privacy-safe payload', () => {
        const marker = createCorProjectMarker(corProjectId);

        assert.deepStrictEqual(marker, expectedMarker);
        assert.deepStrictEqual(Object.keys(marker), ['schemaVersion', 'source', 'corProjectId']);
        assert.strictEqual(JSON.stringify(marker), expectedContent);
        assert.doesNotMatch(
            JSON.stringify(marker),
            /prompt|path|azure|subscription|tenant|account|resource|workflow|phase|session|request/i,
        );
    });

    test('strictly validates the schema and UUID', () => {
        assert.deepStrictEqual(parseCorProjectMarker(expectedContent), expectedMarker);

        for (const invalid of [
            '',
            'not-json',
            'null',
            '[]',
            JSON.stringify({ ...expectedMarker, schemaVersion: '1' }),
            JSON.stringify({ ...expectedMarker, schemaVersion: 2 }),
            JSON.stringify({ ...expectedMarker, source: 1 }),
            JSON.stringify({ ...expectedMarker, source: 'create-project-with-copilot' }),
            JSON.stringify({ ...expectedMarker, corProjectId: 1 }),
            JSON.stringify({ ...expectedMarker, corProjectId: 'not-a-uuid' }),
            JSON.stringify({ ...expectedMarker, corProjectId: '11111111-1111-6111-8111-111111111111' }),
            JSON.stringify({ ...expectedMarker, prompt: 'private prompt' }),
            JSON.stringify({ schemaVersion: 1, source: 'copilot-on-rails' }),
        ]) {
            assert.strictEqual(parseCorProjectMarker(invalid), undefined, invalid);
        }

        assert.throws(() => createCorProjectMarker('not-a-uuid'), /valid UUID/);
    });

    test('writes idempotently and restores the authoritative payload', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'cor-project-marker-'));
        const markerPath = join(directory, ...COR_PROJECT_MARKER_PATH.split('/'));

        try {
            const folder = vscode.Uri.file(directory);
            await writeCorProjectMarker(folder, corProjectId);
            assert.strictEqual(await readFile(markerPath, 'utf-8'), expectedContent);

            await writeFile(markerPath, JSON.stringify({ ...expectedMarker, prompt: 'private prompt' }));
            await writeCorProjectMarker(folder, corProjectId);
            assert.strictEqual(await readFile(markerPath, 'utf-8'), expectedContent);

            await writeCorProjectMarker(folder, corProjectId);
            assert.strictEqual(await readFile(markerPath, 'utf-8'), expectedContent);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
