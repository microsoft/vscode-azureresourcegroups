/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-template-curly-in-string */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ASSET_ROOT = path.resolve(__dirname, '..', '..', 'resources', 'agents');
const TEXT_FILE_PATTERN = /\.(md|json|jsonc|ya?ml|ts|js|py|cs)$/i;

/**
 * A concrete `scheme://user:password@host` literal. Secret-redaction filters rewrite this shape to
 * a run of asterisks before an agent ever reads it, so the agent copies the mask into generated
 * config. In YAML a leading `*` is an alias indicator, which makes the generated file unparseable.
 */
const CONCRETE_CREDENTIAL_URL = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^\s:/@"'`]+):([^\s:/@"'`]+)@/g;

/** Placeholder forms survive redaction untouched and are the required way to express these values. */
function isPlaceholder(value: string): boolean {
    return value.startsWith('${')
        || value.startsWith('<')
        || value.startsWith('$(')
        || /^%[^%]+%$/.test(value);
}

async function listTextFiles(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async entry => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return await listTextFiles(entryPath);
        }
        return TEXT_FILE_PATTERN.test(entry.name) ? [entryPath] : [];
    }));
    return nested.flat();
}

void test('agent reference assets contain no concrete credential URL literals', async () => {
    const files = await listTextFiles(ASSET_ROOT);
    assert.ok(files.length > 0, 'expected to find agent reference assets');

    const offenders: string[] = [];
    for (const filePath of files) {
        const content = await fs.readFile(filePath, 'utf8');
        content.split('\n').forEach((line, index) => {
            for (const match of line.matchAll(CONCRETE_CREDENTIAL_URL)) {
                if (isPlaceholder(match[1]) && isPlaceholder(match[2])) {
                    continue;
                }
                offenders.push(`${path.relative(ASSET_ROOT, filePath)}:${index + 1}`);
            }
        });
    }

    assert.deepEqual(
        offenders,
        [],
        'Agent assets must not embed concrete user:password@host URLs. A redaction filter masks them '
        + 'to asterisks before the agent reads them, and the agent then writes the mask into generated '
        + 'config. Use ${VAR} or <PLACEHOLDER> forms instead. Offending locations: '
        + offenders.join(', '),
    );
});

void test('agent reference assets contain no leaked redaction masks', async () => {
    const files = await listTextFiles(ASSET_ROOT);
    const offenders: string[] = [];
    for (const filePath of files) {
        const content = await fs.readFile(filePath, 'utf8');
        content.split('\n').forEach((line, index) => {
            if (/\*{4,}/.test(line) && !line.includes('*/') && !line.includes('/*')) {
                offenders.push(`${path.relative(ASSET_ROOT, filePath)}:${index + 1}`);
            }
        });
    }
    assert.deepEqual(offenders, [], `Redaction masks found in agent assets: ${offenders.join(', ')}`);
});
