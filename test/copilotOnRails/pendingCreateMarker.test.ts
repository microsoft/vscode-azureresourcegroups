/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { parsePendingCreateMarker } from '../../src/webviews/copilotOnRails/extension/resumePendingCreateWithCopilot';

const projectId = '11111111-1111-4111-8111-111111111111';
const workflowRunId = '22222222-2222-4222-8222-222222222222';

suite('pending Create Project marker', () => {
    test('restores only privacy-safe workflow correlation across a folder handoff', () => {
        const marker = parsePendingCreateMarker(Buffer.from(JSON.stringify({
            createdAt: 1000,
            projectId,
            workflow: {
                schemaVersion: '2',
                workflowRunId,
                entryPoint: 'createProject',
                startedAt: 500,
                prompt: 'private prompt',
                path: 'C:\\private',
            },
            subscriptionId: 'private-subscription',
        })), 2000);

        assert.deepStrictEqual(marker, {
            createdAt: 1000,
            projectId,
            workflow: {
                schemaVersion: '2',
                workflowRunId,
                entryPoint: 'createProject',
                startedAt: 500,
            },
        });
    });

    test('rejects expired and future markers', () => {
        const marker = (createdAt: number) => Buffer.from(JSON.stringify({ createdAt }));
        assert.strictEqual(parsePendingCreateMarker(marker(1000), 1000 + (11 * 60 * 1000)), undefined);
        assert.strictEqual(parsePendingCreateMarker(marker(62_000), 1000), undefined);
    });
});
