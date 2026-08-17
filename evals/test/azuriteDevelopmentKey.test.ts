/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createBlobStorageEventScript, createQueueStorageEventScript } from '../src/SandboxLocalRuntimeValidator';

/**
 * The storage-event probe signs every Azurite request with a SharedKey HMAC. The account key was
 * corrupted to a 25-character value, so Azurite answered 403 AuthenticationFailed on the very first
 * request and the probe failed for every generated app — the `worker` gate recorded 16 failures and
 * zero passes across the entire history of the eval system before this was caught.
 *
 * That is a harness defect being charged to the product, which is the single worst failure mode an
 * evaluation system can have. These tests pin the key so it cannot silently regress.
 */

/** Azurite's published well-known development key. Not a secret. */
const CANONICAL_AZURITE_KEY =
    'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

const queueScript = (): string => createQueueStorageEventScript({
    name: 'billing event is routed',
    kind: 'queue',
    inputQueue: 'billing-events-in',
    outputQueue: 'billing-events-out',
    message: { id: 'evt-1' },
    expectedMessageIncludes: { id: 'evt-1' },
});

const blobScript = (): string => createBlobStorageEventScript({
    name: 'document is archived',
    kind: 'blob',
    sourceContainer: 'incoming',
    destinationContainer: 'archive',
    blobName: 'doc.txt',
    content: 'hello',
    metadata: {},
});

const extractKey = (script: string): string => {
    const match = /const accountKey = "([^"]+)";/u.exec(script);
    assert.ok(match, 'generated probe must declare an accountKey');
    return match[1];
};

for (const [label, build] of [['queue', queueScript], ['blob', blobScript]] as const) {
    void test(`the ${label} storage probe signs with the real Azurite key`, () => {
        const key = extractKey(build());
        assert.equal(key, CANONICAL_AZURITE_KEY);
    });

    void test(`the ${label} storage probe key is a valid 64-byte base64 secret`, () => {
        // A truncated key still base64-decodes, so length alone is the load-bearing assertion:
        // the corrupted value decoded to 17 bytes and produced a well-formed but rejected signature.
        const decoded = Buffer.from(extractKey(build()), 'base64');
        assert.equal(decoded.length, 64, 'Azurite keys are 64 bytes; a shorter key yields 403 on every request');
    });
}

void test('the probe signature matches an independently computed SharedKey HMAC', () => {
    // Recompute the signature the way Azurite does and confirm the probe's key reproduces it.
    // This fails if the key drifts even by one byte, without needing a live emulator.
    const stringToSign = 'GET\n\n\n\n\n\n\n\n\n\n\n\n/devstoreaccount1/probe';
    const expected = createHmac('sha256', Buffer.from(CANONICAL_AZURITE_KEY, 'base64'))
        .update(stringToSign)
        .digest('base64');
    const actual = createHmac('sha256', Buffer.from(extractKey(queueScript()), 'base64'))
        .update(stringToSign)
        .digest('base64');
    assert.equal(actual, expected);
});
