/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
    addRecentPrompt,
    pruneRecentPrompts,
    RECENT_PROMPT_MAX_AGE_MS,
    RECENT_PROMPT_MAX_COUNT,
    toPromptStrings,
    type RecentPrompt,
} from '../../src/webviews/copilotOnRails/extension/recentPrompts';

const NOW = 1_700_000_000_000;

suite('recentPrompts', () => {
    suite('addRecentPrompt', () => {
        test('records the newest prompt first', () => {
            let history: RecentPrompt[] = [];
            history = addRecentPrompt(history, 'first', NOW);
            history = addRecentPrompt(history, 'second', NOW + 1);

            assert.deepStrictEqual(toPromptStrings(history), ['second', 'first']);
        });

        test('trims the prompt before recording', () => {
            const history = addRecentPrompt([], '  padded  ', NOW);
            assert.strictEqual(history[0].prompt, 'padded');
        });

        test('ignores empty/whitespace-only prompts and returns existing unchanged', () => {
            const existing: RecentPrompt[] = [{ prompt: 'keep', ts: NOW }];
            assert.strictEqual(addRecentPrompt(existing, '', NOW), existing);
            assert.strictEqual(addRecentPrompt(existing, '   \n\t ', NOW), existing);
        });

        test('dedupes an identical trimmed prompt by moving it to the front', () => {
            let history: RecentPrompt[] = [];
            history = addRecentPrompt(history, 'a', NOW);
            history = addRecentPrompt(history, 'b', NOW + 1);
            history = addRecentPrompt(history, 'a', NOW + 2);

            assert.deepStrictEqual(toPromptStrings(history), ['a', 'b']);
            assert.strictEqual(history[0].ts, NOW + 2);
        });

        test('treats an untrimmed duplicate as the same entry', () => {
            let history: RecentPrompt[] = [];
            history = addRecentPrompt(history, 'dup', NOW);
            history = addRecentPrompt(history, '  dup  ', NOW + 1);

            assert.deepStrictEqual(toPromptStrings(history), ['dup']);
        });

        test('caps the history to the max count, newest-first', () => {
            let history: RecentPrompt[] = [];
            for (let i = 0; i < RECENT_PROMPT_MAX_COUNT + 5; i++) {
                history = addRecentPrompt(history, `prompt-${i}`, NOW + i);
            }

            assert.strictEqual(history.length, RECENT_PROMPT_MAX_COUNT);
            assert.strictEqual(history[0].prompt, `prompt-${RECENT_PROMPT_MAX_COUNT + 4}`);
            assert.strictEqual(history[history.length - 1].prompt, `prompt-5`);
        });

        test('prunes entries older than the retention window when adding', () => {
            const stale: RecentPrompt[] = [{ prompt: 'stale', ts: NOW - RECENT_PROMPT_MAX_AGE_MS - 1 }];
            const history = addRecentPrompt(stale, 'fresh', NOW);

            assert.deepStrictEqual(toPromptStrings(history), ['fresh']);
        });
    });

    suite('pruneRecentPrompts', () => {
        test('removes entries older than the retention window relative to now', () => {
            const existing: RecentPrompt[] = [
                { prompt: 'fresh', ts: NOW - 1000 },
                { prompt: 'edge', ts: NOW - RECENT_PROMPT_MAX_AGE_MS },
                { prompt: 'stale', ts: NOW - RECENT_PROMPT_MAX_AGE_MS - 1 },
            ];

            assert.deepStrictEqual(toPromptStrings(pruneRecentPrompts(existing, NOW)), ['fresh', 'edge']);
        });

        test('preserves newest-first ordering', () => {
            const existing: RecentPrompt[] = [
                { prompt: 'newest', ts: NOW },
                { prompt: 'older', ts: NOW - 1000 },
            ];

            assert.deepStrictEqual(toPromptStrings(pruneRecentPrompts(existing, NOW)), ['newest', 'older']);
        });
    });
});
