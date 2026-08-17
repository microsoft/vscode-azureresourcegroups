/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserProbeScript } from '../src/SandboxLocalRuntimeValidator';

/**
 * Accessibility is opt-out per scenario via `maxSeriousAccessibilityViolations: null`. The intent
 * is "keep collecting axe evidence, stop gating on it" — the evidence must survive so the data is
 * still chartable, and the opt-out must be explicit rather than a silent default.
 */
const build = (maxSeriousAccessibilityViolations: number | null | undefined): string =>
    createBrowserProbeScript('http://127.0.0.1:5173', {
        expectedText: 'ticket',
        maxSeriousAccessibilityViolations,
    } as never);

void test('a null threshold stops the probe failing on accessibility violations', () => {
    const script = build(null);

    assert.doesNotMatch(script, /Accessibility violations exceeded/);
});

void test('a null threshold still scans and reports accessibility evidence', () => {
    const script = build(null);

    // Dropping the scan would make the gate unfalsifiable later and destroy the historical signal.
    assert.match(script, /const seriousAccessibilityViolations = await scanAccessibility\(\);/);
    assert.match(script, /seriousAccessibilityViolations,/);
    assert.match(script, /accessibilityScanned,/);
});

void test('an omitted threshold still enforces zero violations', () => {
    const script = build(undefined);

    // The opt-out must be explicit; absence of configuration must not silently disable the gate.
    assert.match(script, /if \(seriousAccessibilityViolations\.length > 0\)/);
    assert.match(script, /process\.exitCode = 1/);
});

void test('a numeric threshold is enforced at its configured value', () => {
    const script = build(3);

    assert.match(script, /if \(seriousAccessibilityViolations\.length > 3\)/);
});
