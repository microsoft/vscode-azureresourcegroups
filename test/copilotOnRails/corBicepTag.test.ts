/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..');

suite('created-by-cor Bicep tag', () => {
    test('canonical tags merge preserves existing AppOnboard tags', () => {
        const patterns = fs.readFileSync(path.join(repoRoot, 'resources', 'agents', 'azure-deploy', 'scaffold', 'references', 'bicep-patterns.md'), 'utf8');
        const tagsBlock = patterns.match(/var tags = union\(existingTags, \{([\s\S]*?)\n\}\)/)?.[1] ?? '';

        for (const tag of ['app-onboard-skill', 'created-by-cor', 'app-onboard-session-id', 'created-at', 'environment', 'deployed-by']) {
            assert.match(tagsBlock, new RegExp(`['"]?${tag}['"]?\\s*:`));
        }
        assert.match(patterns, /union\(tags, resourceSpecificTags\)/);
        assert.match(patterns, /resource\s+types that do not expose a tags property/i);
    });

    test('both conformance gates reject missing created-by-cor tags', () => {
        const scripts = ['scaffold-conformance.ps1', 'scaffold-conformance.sh'];
        for (const script of scripts) {
            const content = fs.readFileSync(path.join(repoRoot, 'resources', 'agents', 'azure-deploy', 'scaffold', 'scripts', script), 'utf8');
            assert.match(content, /COR-TAG-MISSING/);
            assert.match(content, /created-by-cor/);
        }
    });
});
