/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { agentStallMessagePrefix, createStallWatchdog, stallTimeoutMs } from '../src/CopilotSdkAgentExecutor';

void test('a silent session is reported as stalled once the silence budget elapses', async () => {
    const watchdog = createStallWatchdog(50);
    try {
        const outcome = await Promise.race([
            watchdog.stalled.then(() => 'stalled'),
            delay(500).then(() => 'never-fired'),
        ]);
        assert.equal(outcome, 'stalled');
        assert.ok(watchdog.describe().startsWith(agentStallMessagePrefix));
    } finally {
        watchdog.dispose();
    }
});

void test('a session that keeps emitting events is never reported as stalled', async () => {
    // The watchdog measures silence, not elapsed time: a long-running turn that streams
    // progress must not be aborted just because it exceeds the silence budget overall.
    const watchdog = createStallWatchdog(80);
    const heartbeat = setInterval(() => watchdog.recordActivity(), 20);
    try {
        const outcome = await Promise.race([
            watchdog.stalled.then(() => 'stalled'),
            delay(400).then(() => 'still-working'),
        ]);
        assert.equal(outcome, 'still-working');
    } finally {
        clearInterval(heartbeat);
        watchdog.dispose();
    }
});

void test('activity that stops mid-run still trips the watchdog', async () => {
    const watchdog = createStallWatchdog(60);
    try {
        watchdog.recordActivity();
        await delay(30);
        watchdog.recordActivity();
        const outcome = await Promise.race([
            watchdog.stalled.then(() => 'stalled'),
            delay(600).then(() => 'never-fired'),
        ]);
        assert.equal(outcome, 'stalled');
    } finally {
        watchdog.dispose();
    }
});

void test('a disposed watchdog does not report a stall afterwards', async () => {
    const watchdog = createStallWatchdog(30);
    watchdog.dispose();
    const outcome = await Promise.race([
        watchdog.stalled.then(() => 'stalled'),
        delay(200).then(() => 'quiet'),
    ]);
    assert.equal(outcome, 'quiet');
});

void test('the stall threshold scales with concurrency instead of being hardcoded', () => {
    // Raising workers slows individual turns, so a budget tuned for one worker would report
    // healthy-but-slow turns as stalls at eight. Keep the safe default when unset.
    const previous = process.env.COR_EVAL_STALL_TIMEOUT_MS;
    try {
        delete process.env.COR_EVAL_STALL_TIMEOUT_MS;
        assert.equal(stallTimeoutMs(), 90 * 1000);

        process.env.COR_EVAL_STALL_TIMEOUT_MS = '180000';
        assert.equal(stallTimeoutMs(), 180 * 1000);

        // A malformed or nonsensical value must not silently disable stall detection.
        for (const value of ['not-a-number', '0', '-5', '']) {
            process.env.COR_EVAL_STALL_TIMEOUT_MS = value;
            assert.equal(stallTimeoutMs(), 90 * 1000, `"${value}" should fall back to the default`);
        }
    } finally {
        if (previous === undefined) {
            delete process.env.COR_EVAL_STALL_TIMEOUT_MS;
        } else {
            process.env.COR_EVAL_STALL_TIMEOUT_MS = previous;
        }
    }
});
