/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-floating-promises -- node:test registrations are intentionally top-level. */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepareAgentWorkspace } from '../src/agentAssets';

test('agent workspace matches the production pre-created Azure contract directory', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cor-agent-assets-'));
    try {
        await prepareAgentWorkspace(process.cwd(), workspace);
        assert.equal((await fs.stat(path.join(workspace, '.azure'))).isDirectory(), true);
        assert.equal(
            (await fs.stat(path.join(workspace, '.azure', '.preview-temp'))).isDirectory(),
            true,
        );
        assert.equal(
            (await fs.stat(path.join(
                workspace,
                '.github',
                'agents',
                'azure-project-plan',
                'instructions.md',
            ))).isFile(),
            true,
        );
    } finally {
        await fs.rm(workspace, { recursive: true, force: true });
    }
});
