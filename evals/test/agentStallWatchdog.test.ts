/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { agentStallMessagePrefix, createStallWatchdog } from '../src/CopilotSdkAgentExecutor';

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
