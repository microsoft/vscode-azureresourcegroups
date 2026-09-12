/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The canonical text of the assertion comments that more than one stimulus shares.
 *
 * This module exists because the previous arrangement — a literal in
 * `check-stimulus-comments.ts` and a second copy in `build-config.ts` — was
 * itself an instance of the failure the checker exists to prevent.
 *
 * `comment` is the only stable identifier a SQL assertion carries into stored run
 * results; there is no grader filename to fall back on the way an `exec:`
 * assertion has. So rewording one does not annotate a gate, it forks that gate
 * into a second identity with no history, silently, while the original appears to
 * stop being evaluated. The checker was written to make that impossible.
 *
 * It could not see `build-config.ts`, which *generates* stack stimuli and carried
 * its own copy of the sentinel string. That copy had already drifted to the
 * pre-canonicalisation wording, so every generated stack stimulus was forking the
 * sentinel gate — in the one code path that creates new stimuli, guarded by a
 * checker that only read the hand-written ones.
 *
 * Hence a single exported constant rather than a rule that the two literals be
 * kept equal. A rule needs enforcing; a shared import cannot drift.
 */

/**
 * The liveness sentinel, pinned.
 *
 * Turn attribution is deliberately NOT encoded, even though the multi-turn
 * stimuli carry one per turn and the earlier wordings named the turn. The
 * `assertions` table stores a `stepIndex` column alongside the comment, so which
 * turn a sentinel belongs to is already recorded and recoverable. Encoding it
 * here as well would fork the gate into one history per turn index — precisely
 * the failure this constant exists to prevent.
 *
 * "this turn" rather than "session data must exist" because the implied
 * `stepIndex` filter means a sentinel only ever sees its own turn. The
 * session-scoped phrasing was the more common of the two variants and was wrong
 * in six of the thirteen places it appeared.
 */
export const SENTINEL_COMMENT = 'Sentinel; this turn must have produced a response or its checks are vacuous';

/** Recognises a sentinel by what it *does*, so a paraphrased comment cannot hide one. */
export const SENTINEL_QUERY = /^SELECT\s+COUNT\(\*\)\s*>\s*0\s+FROM\s+llm_responses$/i;

/**
 * A whole-conversation constraint is duplicated once per turn precisely so the
 * failing assertion names the turn that misbehaved, so `(turn N)` is meaningful
 * rather than noise. It is stripped before comparison: an identity scheme can
 * strip a fixed trailing pattern, where it cannot un-paraphrase free text.
 */
export const TURN_SUFFIX = / \(turn \d+\)$/;

/**
 * The non-asserting environment fingerprint every stimulus carries last.
 *
 * Shared between the hand-written stimuli and the generated ones, so it belongs
 * here for the same reason the sentinel does. The *command* deliberately varies —
 * each stimulus lists the directories that matter to it — but the comment is the
 * label a reader greps for when a grader goes red, and one label is worth more
 * than an accurate-per-stimulus one.
 */
export const FINGERPRINT_COMMENT = 'Environment fingerprint for triage';

/**
 * The paired `test -f` that accompanies every `files`-table assertion.
 *
 * `files` holds what the *agent* wrote through the tracked channel during a step,
 * so a file written by an extension, a `script:` preamble or the container is
 * invisible to it however plainly it exists on disk. This records the disk answer
 * next to the table answer: present-on-disk-but-absent-from-`files` is the
 * wrong-channel signature, and it is the difference between a ten-minute forensic
 * pass and reading one row.
 */
export const DISK_TRIAGE_COMMENT = 'Triage; is the file on disk at all?';
