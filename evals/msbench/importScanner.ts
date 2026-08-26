/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Find the import specifiers in a TypeScript source file.
 *
 * ## Why this exists
 *
 * `stage-graders.ts` walks the grader import graph so a moved file or a bare
 * specifier is caught in milliseconds on a laptop rather than four minutes into
 * a paid run. It used to find imports with one regex:
 *
 *     /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g
 *
 * run over raw source. That regex does not know what a comment is, so when a
 * doc comment in `graderHarness.ts` said *turns a red from "mysterious failure"
 * into "known gap"*, the scanner read `from "mysterious failure"` as an import
 * of a package by that name, could not find it in `node_modules`, and failed the
 * build. **A prose sentence broke `feat/CoR` for everyone.**
 *
 * The judgement was right and the detector was naive: refusing to stage a tree
 * that would die inside the container is exactly what this guard is for. So the
 * fix keeps the refusal and replaces the detection.
 *
 * ## Why this is hand-written rather than `ts.preProcessFile`
 *
 * The TypeScript compiler ships precisely this scanner, and it was the first
 * choice. It cannot be used here, for a reason worth writing down so nobody
 * spends the afternoon rediscovering it:
 *
 * `run.sh` stages graders on **every** invocation, including `--skip-build` —
 * deliberately, because they are read straight off the working tree and a stale
 * copy would grade the wrong contract. But `--skip-build` skips the root
 * `npm install`, and the MSBench `eval` job runs exactly that path: checkout,
 * setup-node, download the VSIX artifact, `run.sh --skip-build`. **There is no
 * `node_modules` on that host at all** — not at the repo root, not in `evals/`.
 * `typescript` is not even a declared dependency of the root manifest; it is
 * hoisted transitively from `api-extractor` and `typescript-eslint`, so relying
 * on it would mean relying on npm's hoisting of somebody else's dev dependency.
 *
 * `stage-graders.ts` imports `node:` builtins and nothing else, and `run.sh`
 * promises "a clean machine with `az login` already done should be able to
 * execute this unmodified". That property is load-bearing, and importing a
 * third-party module would quietly delete it — breaking the paid run path, which
 * is the one place a failure costs money.
 *
 * So: a small tokenizer, no dependencies. It handles the cases the regex could
 * not — comments, string literals, template literals and regex literals — which
 * is the difference between narrowing the category error and closing it.
 *
 * Run `node importScanner.ts --self-test` to execute the cases below.
 */

type Token =
    | { kind: 'word'; value: string }
    | { kind: 'punct'; value: string }
    /** `static` is false for a template with a `${}` hole, which no import can use. */
    | { kind: 'string'; value: string; static: boolean };

/**
 * Keywords that may introduce a module specifier.
 *
 * `require` is deliberately absent: the graders are ESM, the previous regex
 * never matched it, and widening the guard in a bug fix would risk newly
 * refusing to stage a tree that stages fine today.
 */
const SPECIFIER_KEYWORDS = new Set(['from', 'import']);

/**
 * One import, and whether it is loaded eagerly.
 *
 * The distinction is load-bearing for the clean-machine check. A **static**
 * import runs on every invocation of the module, so a script `run.sh` calls on a
 * host with no `node_modules` cannot have one reaching a third-party package. A
 * **dynamic** `import()` runs only when that code path is taken, which is how
 * `build-config.ts` offers `--stack` without making the stimulus path — the one
 * every current run uses — depend on anything.
 */
export interface ImportReference {
    specifier: string;
    dynamic: boolean;
    /**
     * `import type { T } from './x.ts'` — erased before the code runs.
     *
     * The module is never loaded, so a type-only import cannot bring a runtime
     * dependency with it. That distinction is invisible to a regex and matters:
     * without it the clean-machine check reports `build-config.ts` as depending
     * on `yaml` because it imports a *type* from a module that parses YAML,
     * which is a false failure — and a check that cries wolf gets switched off.
     *
     * Only statement-level `import type` / `export type` counts. An inline
     * `import { type A, b }` still loads the module.
     */
    typeOnly: boolean;
}

export function findImportReferences(source: string): ImportReference[] {
    const tokens = tokenize(source);
    const references: ImportReference[] = [];

    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (token.kind !== 'string' || !token.static) {
            continue;
        }
        const previous = tokens[index - 1];
        if (!previous) {
            continue;
        }
        // `import x from './y.ts'`, `export { a } from './y.ts'`, `import './y.ts'`.
        if (previous.kind === 'word' && SPECIFIER_KEYWORDS.has(previous.value)) {
            references.push({ specifier: token.value, dynamic: false, typeOnly: isTypeOnlyStatement(tokens, index) });
            continue;
        }
        // `await import('./y.ts')` — the specifier sits behind the parenthesis.
        if (previous.kind === 'punct' && previous.value === '(') {
            const beforeParen = tokens[index - 2];
            if (beforeParen?.kind === 'word' && beforeParen.value === 'import') {
                references.push({ specifier: token.value, dynamic: true, typeOnly: false });
            }
        }
    }
    return references;
}

/**
 * Walk back to the statement's `import`/`export` keyword and ask whether `type`
 * follows it.
 *
 * Bounded rather than unbounded: a malformed file should cost one wrong answer,
 * not a scan of everything before it. An import clause long enough to exceed
 * this is not something this repository contains.
 */
function isTypeOnlyStatement(tokens: Token[], specifierIndex: number): boolean {
    const limit = Math.max(0, specifierIndex - 128);
    for (let index = specifierIndex - 1; index >= limit; index--) {
        const token = tokens[index];
        if (token.kind !== 'word') {
            continue;
        }
        if (token.value === 'import' || token.value === 'export') {
            const next = tokens[index + 1];
            return next?.kind === 'word' && next.value === 'type';
        }
    }
    return false;
}

/** Specifiers only. `stage-graders.ts` stages every reachable file, eager or not. */
export function findImportSpecifiers(source: string): string[] {
    return findImportReferences(source).map(reference => reference.specifier);
}

function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let index = 0;

    while (index < source.length) {
        const char = source[index];

        if (/\s/.test(char)) {
            index++;
            continue;
        }
        if (char === '/' && source[index + 1] === '/') {
            while (index < source.length && source[index] !== '\n') {
                index++;
            }
            continue;
        }
        if (char === '/' && source[index + 1] === '*') {
            index += 2;
            while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
                index++;
            }
            index += 2;
            continue;
        }
        // A regex literal can contain quotes — `/['"]([^'"]+)['"]/` appears in
        // this very repository — so misreading one as a string start would
        // swallow the rest of the file and lose every import after it.
        if (char === '/' && regexLiteralAllowedAfter(tokens)) {
            index = skipRegexLiteral(source, index);
            continue;
        }
        if (char === '"' || char === '\'') {
            const read = readQuoted(source, index, char);
            tokens.push({ kind: 'string', value: read.value, static: true });
            index = read.next;
            continue;
        }
        if (char === '`') {
            const read = readTemplate(source, index);
            tokens.push({ kind: 'string', value: read.value, static: read.static });
            index = read.next;
            continue;
        }
        if (/[A-Za-z_$]/.test(char)) {
            let end = index;
            while (end < source.length && /[A-Za-z0-9_$]/.test(source[end])) {
                end++;
            }
            tokens.push({ kind: 'word', value: source.slice(index, end) });
            index = end;
            continue;
        }
        if (/[0-9]/.test(char)) {
            let end = index;
            while (end < source.length && /[0-9A-Za-z._]/.test(source[end])) {
                end++;
            }
            // Collapsed to a single placeholder: the value never matters, but the
            // presence of a numeric literal does, for the regex-or-division test.
            tokens.push({ kind: 'punct', value: '0' });
            index = end;
            continue;
        }
        tokens.push({ kind: 'punct', value: char });
        index++;
    }
    return tokens;
}

/**
 * The classic ambiguity: `/` begins a regex literal unless the previous token
 * could end an expression, in which case it is division. The heuristic is the
 * standard one and is more than sufficient here — a false "division" reading
 * only costs us one token of resynchronisation, and neither reading can invent
 * an import that is not there.
 */
function regexLiteralAllowedAfter(tokens: Token[]): boolean {
    const previous = tokens[tokens.length - 1];
    if (!previous) {
        return true;
    }
    if (previous.kind === 'string') {
        return false;
    }
    if (previous.kind === 'punct') {
        return !([')', ']', '0'].includes(previous.value));
    }
    // An identifier ends an expression, but a keyword like `return` or `typeof`
    // does not, and a regex may legitimately follow it.
    return ['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'instanceof', 'new', 'do', 'else', 'yield', 'await'].includes(previous.value);
}

function skipRegexLiteral(source: string, start: number): number {
    let index = start + 1;
    let inClass = false;
    while (index < source.length) {
        const char = source[index];
        if (char === '\\') {
            index += 2;
            continue;
        }
        if (char === '\n') {
            // Unterminated: this was division after all. Resynchronise rather
            // than consuming the rest of the file.
            return start + 1;
        }
        if (char === '[') {
            inClass = true;
        } else if (char === ']') {
            inClass = false;
        } else if (char === '/' && !inClass) {
            index++;
            while (index < source.length && /[a-z]/.test(source[index])) {
                index++;
            }
            return index;
        }
        index++;
    }
    return index;
}

function readQuoted(source: string, start: number, quote: string): { value: string; next: number } {
    let index = start + 1;
    let value = '';
    while (index < source.length) {
        const char = source[index];
        if (char === '\\') {
            value += source[index + 1] ?? '';
            index += 2;
            continue;
        }
        if (char === quote) {
            return { value, next: index + 1 };
        }
        // An unterminated literal is not valid TypeScript; stopping at the line
        // break keeps one malformed line from eating every import below it.
        if (char === '\n') {
            return { value, next: index };
        }
        value += char;
        index++;
    }
    return { value, next: index };
}

function readTemplate(source: string, start: number): { value: string; static: boolean; next: number } {
    let index = start + 1;
    let value = '';
    let isStatic = true;
    while (index < source.length) {
        const char = source[index];
        if (char === '\\') {
            value += source[index + 1] ?? '';
            index += 2;
            continue;
        }
        if (char === '`') {
            return { value, static: isStatic, next: index + 1 };
        }
        if (char === '$' && source[index + 1] === '{') {
            // A hole means the specifier is not statically known, so the whole
            // template is disqualified — but its contents still have to be
            // skipped correctly, because they may contain quotes or backticks.
            isStatic = false;
            index = skipTemplateHole(source, index + 2);
            continue;
        }
        value += char;
        index++;
    }
    return { value, static: isStatic, next: index };
}

function skipTemplateHole(source: string, start: number): number {
    let index = start;
    let depth = 1;
    while (index < source.length && depth > 0) {
        const char = source[index];
        if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;
        } else if (char === '"' || char === '\'') {
            index = readQuoted(source, index, char).next;
            continue;
        } else if (char === '`') {
            index = readTemplate(source, index).next;
            continue;
        }
        index++;
    }
    return index;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

interface ScannerCase {
    name: string;
    source: string;
    expected: string[];
    /** Optional stricter expectation over the full references, not just specifiers. */
    expectedReferences?: ImportReference[];
}

/**
 * The cases this scanner exists to get right.
 *
 * The first three are the non-negotiable set: a comment and a string literal
 * that look like imports must be ignored, and a genuine bare import must still
 * be found — because **the guard's entire value is its ability to fail.** The
 * rest are the traps found while writing it.
 */
const CASES: ScannerCase[] = [
    {
        name: 'block comment containing from "not-a-module" is ignored',
        source: '/* turns a red from "not-a-module" into a known gap */\nimport { a } from "./real.ts";',
        expected: ['./real.ts'],
    },
    {
        name: 'line comment containing from "not-a-module" is ignored',
        source: '// see: a red from "not-a-module" is a known gap\nimport { a } from "./real.ts";',
        expected: ['./real.ts'],
    },
    {
        name: 'string literal containing from "not-a-module" is ignored',
        source: 'const message = \'turns a red from "not-a-module" into a known gap\';\nimport { a } from "./real.ts";',
        expected: ['./real.ts'],
    },
    {
        name: 'a genuine bare import is still found — the guard must be able to fail',
        source: 'import x from \'lodash\';',
        expected: ['lodash'],
    },
    {
        name: 'template literal containing from "not-a-module" is ignored',
        source: 'const m = `a red from "not-a-module"`;\nimport "./side-effect.ts";',
        expected: ['./side-effect.ts'],
    },
    {
        name: 'template hole containing quotes does not desynchronise the scan',
        source: 'const m = `${x ? "from \'a\'" : `${y}`} tail`;\nimport a from "./after-hole.ts";',
        expected: ['./after-hole.ts'],
    },
    {
        name: 'regex literal containing quotes does not swallow later imports',
        source: 'const SPECIFIER = /(?:\\bfrom|\\bimport)\\s*\\(?\\s*[\'"]([^\'"]+)[\'"]/g;\nimport a from "./after-regex.ts";',
        expected: ['./after-regex.ts'],
    },
    {
        name: 'dynamic import is found',
        source: 'const m = await import(\'./dynamic.ts\');',
        expected: ['./dynamic.ts'],
    },
    {
        name: 're-export is found',
        source: 'export { a } from \'./reexport.ts\';',
        expected: ['./reexport.ts'],
    },
    {
        name: 'type-only import is found, and marked type-only',
        source: 'import type { T } from \'./types.ts\';',
        expected: ['./types.ts'],
        expectedReferences: [{ specifier: './types.ts', dynamic: false, typeOnly: true }],
    },
    {
        name: 'a value import is not marked type-only',
        source: 'import { a } from \'./values.ts\';',
        expected: ['./values.ts'],
        expectedReferences: [{ specifier: './values.ts', dynamic: false, typeOnly: false }],
    },
    {
        name: 'an inline type specifier still loads the module',
        source: 'import { type A, b } from \'./mixed.ts\';',
        expected: ['./mixed.ts'],
        expectedReferences: [{ specifier: './mixed.ts', dynamic: false, typeOnly: false }],
    },
    {
        name: 'export type is type-only too',
        source: 'export type { T } from \'./reexported-types.ts\';',
        expected: ['./reexported-types.ts'],
        expectedReferences: [{ specifier: './reexported-types.ts', dynamic: false, typeOnly: true }],
    },
    {
        name: 'a dynamic import is never type-only',
        source: 'const m = await import(\'./dyn2.ts\');',
        expected: ['./dyn2.ts'],
        expectedReferences: [{ specifier: './dyn2.ts', dynamic: true, typeOnly: false }],
    },
    {
        name: 'multi-line import statement is found',
        source: 'import {\n  a,\n  b,\n} from\n  \'./multiline.ts\';',
        expected: ['./multiline.ts'],
    },
    {
        name: 'templated dynamic import is not reported as a static specifier',
        source: 'const m = await import(`./${name}.ts`);',
        expected: [],
    },
    {
        name: 'division is not mistaken for a regex literal',
        source: 'const ratio = total / count;\nimport a from "./after-division.ts";',
        expected: ['./after-division.ts'],
    },
];

export function selfTest(): number {
    let failed = 0;
    for (const testCase of CASES) {
        const actual = findImportSpecifiers(testCase.source);
        let ok = JSON.stringify(actual) === JSON.stringify(testCase.expected);
        if (ok && testCase.expectedReferences) {
            ok = JSON.stringify(findImportReferences(testCase.source)) === JSON.stringify(testCase.expectedReferences);
        }
        if (ok) {
            console.error(`  ✔ ${testCase.name}`);
        } else {
            failed++;
            console.error(`  ✖ ${testCase.name}`);
            console.error(`      expected ${JSON.stringify(testCase.expected)}`);
            console.error(`      actual   ${JSON.stringify(actual)}`);
        }
    }
    console.error('');
    if (failed > 0) {
        console.error(`FAIL: ${failed} of ${CASES.length} scanner cases failed.`);
        return 1;
    }
    console.error(`PASS: ${CASES.length}/${CASES.length} scanner cases.`);
    return 0;
}

if (process.argv[2] === '--self-test') {
    console.error('Import scanner');
    process.exit(selfTest());
}
