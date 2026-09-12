/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A read of the scaffolded tree, shared by the fidelity validators.
 *
 * The fidelity gates ask "did the agent build what it planned", which means every one of
 * them needs the same three facts about the tree: which ecosystems are present, what each
 * manifest declares, and what the source actually imports. Gathering those once — and in
 * one place — is what stops each gate growing its own half-right notion of, say, whether
 * `psycopg2-binary` and `psycopg2` are the same package.
 *
 * ## Ecosystem coverage
 *
 * Analysed today: **Node/TypeScript** (`package.json`), **Python** (`requirements.txt`,
 * `pyproject.toml`, `Pipfile`) and **.NET** (`*.csproj`, `Directory.Packages.props`).
 *
 * Recognised-but-not-analysed: Go, Rust, Java, Ruby, PHP. These are listed explicitly
 * rather than ignored so a caller can tell "a stack we do not cover" apart from "no project
 * here at all" — the first is a coverage hole to report as not-applicable, the second is
 * very likely a workspace that was never staged. A gate that cannot tell those apart ends
 * up either silently passing every unsupported stack or blaming the agent for the harness.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type Ecosystem = 'node' | 'python' | 'dotnet';

/** Ecosystems recognised by their manifest but with no dependency analyser yet. */
export const UNSUPPORTED_MANIFESTS: Record<string, string> = {
    'go.mod': 'go',
    'cargo.toml': 'rust',
    'pom.xml': 'java',
    'build.gradle': 'java',
    'build.gradle.kts': 'java',
    gemfile: 'ruby',
    'composer.json': 'php',
};

const IGNORED_DIRECTORIES = new Set([
    'node_modules', 'dist', 'build', '.git', '.next', 'out', 'coverage',
    'bin', 'obj', '__pycache__', '.venv', 'venv', '.pytest_cache', '.azure',
]);

/**
 * Where a piece of evidence came from, which decides how much weight it carries.
 *
 * A driver imported only from a test file is not the application's datastore — an
 * in-memory SQLite in a test suite is normal on a PostgreSQL project — so the two are
 * kept apart rather than merged into one "the tree mentions sqlite" signal.
 */
export type EvidenceScope = 'runtime' | 'test';

export interface DeclaredDependency {
    name: string;
    ecosystem: Ecosystem;
    scope: EvidenceScope;
    manifest: string;
}

export interface ImportedModule {
    module: string;
    ecosystem: Ecosystem;
    scope: EvidenceScope;
    file: string;
}

export interface ScaffoldTree {
    root: string;
    /** Every non-ignored file, workspace-relative with `/` separators. */
    files: string[];
    ecosystems: Set<Ecosystem>;
    manifests: string[];
    /** Manifests for stacks with no analyser, mapped to a language id (`go`, `rust`, …). */
    unsupported: Array<{ file: string; language: string }>;
    dependencies: DeclaredDependency[];
    imports: ImportedModule[];
    /**
     * Text content of every readable text file, keyed by relative path. Cached because
     * several gates scan the same small tree for different strings, and re-reading it per
     * gate is both slower and a chance for two gates to disagree about what is in it.
     */
    fileContents: Map<string, string>;
}

const MANIFESTS: Array<{ match: (name: string) => boolean; ecosystem: Ecosystem }> = [
    { match: name => name === 'package.json', ecosystem: 'node' },
    { match: name => name === 'requirements.txt' || name === 'pyproject.toml' || name === 'pipfile', ecosystem: 'python' },
    { match: name => name.endsWith('.csproj') || name === 'directory.packages.props', ecosystem: 'dotnet' },
];

const SOURCE_ECOSYSTEMS: Record<string, Ecosystem> = {
    '.ts': 'node', '.tsx': 'node', '.js': 'node', '.jsx': 'node', '.mjs': 'node', '.cjs': 'node',
    '.py': 'python',
    '.cs': 'dotnet',
};

/** Extensions that identify a source language, for the plan's per-service `Language` row. */
export const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
    typescript: ['.ts', '.tsx'],
    javascript: ['.js', '.jsx', '.mjs', '.cjs'],
    python: ['.py'],
    'c#': ['.cs'],
    csharp: ['.cs'],
    go: ['.go'],
    java: ['.java'],
};

export async function scanScaffoldTree(root: string): Promise<ScaffoldTree> {
    const files = await listFiles(root, root);
    const tree: ScaffoldTree = {
        root,
        files,
        ecosystems: new Set(),
        manifests: [],
        unsupported: [],
        dependencies: [],
        imports: [],
        fileContents: new Map(),
    };

    for (const file of files) {
        if (!isTextFile(file)) {
            continue;
        }
        const content = await readFileSafe(path.join(root, file));
        // Skip anything implausibly large for scaffolded source: a generated bundle or a
        // committed data dump would otherwise dominate every content scan.
        if (content !== undefined && content.length <= 512 * 1024) {
            tree.fileContents.set(file, content);
        }
    }

    for (const file of files) {
        const name = path.basename(file).toLowerCase();
        const unsupported = UNSUPPORTED_MANIFESTS[name];
        if (unsupported) {
            tree.unsupported.push({ file, language: unsupported });
            continue;
        }
        const manifest = MANIFESTS.find(candidate => candidate.match(name));
        if (!manifest) {
            continue;
        }
        tree.manifests.push(file);
        tree.ecosystems.add(manifest.ecosystem);
        tree.dependencies.push(...readDependencies(tree.fileContents.get(file), file, manifest.ecosystem));
    }

    for (const file of files) {
        const ecosystem = SOURCE_ECOSYSTEMS[path.extname(file).toLowerCase()];
        const content = ecosystem && tree.fileContents.get(file);
        if (ecosystem && content) {
            tree.imports.push(...readImports(file, content, ecosystem));
        }
    }

    return tree;
}

/** Binary-ish and lockfile paths that no gate reads for content. */
export function isTextFile(file: string): boolean {
    return !/\.(png|jpe?g|gif|ico|svg|webp|woff2?|ttf|eot|pdf|zip|gz|tgz)$/i.test(file)
        && !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock)$/i.test(file);
}

async function listFiles(root: string, directory: string): Promise<string[]> {
    const entries = await readDirectorySafe(directory);
    const files: string[] = [];
    for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env.example' && entry.name !== '.env') {
            continue;
        }
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) {
                files.push(...await listFiles(root, absolute));
            }
        } else if (entry.isFile()) {
            files.push(path.relative(root, absolute).split(path.sep).join('/'));
        }
    }
    return files;
}

/**
 * A file is test-scope when its path says so. Kept deliberately broad — a false "this is a
 * test" only weakens the *unplanned datastore* direction, whereas a false "this is runtime"
 * would report a test dependency as the application's datastore, which is a wrong failure
 * shown to a user rather than a missed one.
 */
export function scopeForFile(file: string): EvidenceScope {
    const lower = file.toLowerCase();
    return /(^|\/)(tests?|__tests__|spec|e2e)(\/|$)/.test(lower)
        || /\.(test|spec)\.[a-z]+$/.test(lower)
        || /(^|\/)conftest\.py$/.test(lower)
        || /_test\.py$/.test(lower)
        ? 'test'
        : 'runtime';
}

function readDependencies(content: string | undefined, file: string, ecosystem: Ecosystem): DeclaredDependency[] {
    if (content === undefined) {
        return [];
    }
    const record = (name: string, scope: EvidenceScope): DeclaredDependency =>
        ({ name: normalizePackageName(name, ecosystem), ecosystem, scope, manifest: file });

    if (ecosystem === 'node') {
        return readNodeDependencies(content, file, record);
    }
    if (ecosystem === 'dotnet') {
        return [...content.matchAll(/<PackageReference\s+Include\s*=\s*"([^"]+)"/gi)]
            .map(match => record(match[1], scopeForFile(file)));
    }
    return readPythonDependencies(content, file, record);
}

function readNodeDependencies(
    content: string,
    file: string,
    record: (name: string, scope: EvidenceScope) => DeclaredDependency,
): DeclaredDependency[] {
    let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
        parsed = JSON.parse(content);
    } catch {
        return [];
    }
    const fileScope = scopeForFile(file);
    return [
        ...Object.keys(parsed.dependencies ?? {}).map(name => record(name, fileScope)),
        // A driver in devDependencies is test tooling until proven otherwise.
        ...Object.keys(parsed.devDependencies ?? {}).map(name => record(name, 'test')),
    ];
}

function readPythonDependencies(
    content: string,
    file: string,
    record: (name: string, scope: EvidenceScope) => DeclaredDependency,
): DeclaredDependency[] {
    const dependencies: DeclaredDependency[] = [];
    for (const line of content.split('\n')) {
        const text = line.trim();
        if (!text || text.startsWith('#')) {
            continue;
        }
        // The distribution name may be terminated by a version specifier, a closing quote
        // (PEP 621 arrays), a comma, an environment marker, a comment or end of line.
        // Requiring a version operator silently dropped every unpinned dependency, which is
        // the normal shape of a generated `pyproject.toml` — and a dropped dependency reads
        // downstream as "the driver was never declared", failing a correct project.
        const match = /^["']?([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:[=<>!~^]|["',;#]|\s|$)/.exec(text);
        if (match) {
            dependencies.push(record(match[1], scopeForFile(file)));
        }
    }
    return dependencies;
}

/**
 * Normalise a package name so a manifest entry and an import can be compared.
 *
 * Python is the case that matters: PyPI treats `-`, `_` and `.` as equivalent and is
 * case-insensitive, so `psycopg2-binary`, `psycopg2_binary` and `Psycopg2-Binary` are one
 * package. Comparing raw strings makes a correctly-wired project look unwired.
 */
export function normalizePackageName(name: string, ecosystem: Ecosystem): string {
    const trimmed = name.trim();
    if (ecosystem === 'python') {
        return trimmed.toLowerCase().replace(/[._]/g, '-');
    }
    if (ecosystem === 'dotnet') {
        return trimmed.toLowerCase();
    }
    return trimmed.toLowerCase();
}

function readImports(file: string, content: string, ecosystem: Ecosystem): ImportedModule[] {
    const scope = scopeForFile(file);
    const modules = new Set<string>();

    if (ecosystem === 'node') {
        for (const match of content.matchAll(/(?:from\s+|require\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
            const specifier = match[1];
            if (specifier.startsWith('.') || specifier.startsWith('/')) {
                continue;
            }
            modules.add(nodePackageRoot(specifier));
        }
    } else if (ecosystem === 'python') {
        // Horizontal whitespace only in the character classes: a `\s` here matches newlines,
        // which makes `import os` swallow the rest of the file as one enormous module name.
        for (const match of content.matchAll(/^[ \t]*(?:from[ \t]+([A-Za-z0-9_.]+)[ \t]+import|import[ \t]+([A-Za-z0-9_.,\t ]+))/gm)) {
            for (const name of (match[1] ?? match[2] ?? '').split(',')) {
                // Splitting on whitespace-or-dot reduces `numpy as np` and `os.path` alike.
                const root = name.trim().split(/[\s.]/)[0];
                if (root) {
                    modules.add(normalizePackageName(root, 'python'));
                }
            }
        }
    } else {
        for (const match of content.matchAll(/^\s*(?:global\s+)?using\s+(?:static\s+)?([A-Za-z0-9_.]+)\s*;/gm)) {
            modules.add(match[1].toLowerCase());
        }
    }

    return [...modules].map(module => ({ module, ecosystem, scope, file }));
}

/**
 * Reduce an import specifier to the package that would appear in a manifest:
 * `@azure/storage-blob/foo` → `@azure/storage-blob`, `pg/lib/x` → `pg`. `node:` builtins
 * keep their prefix, because `node:sqlite` is a datastore that no manifest can declare.
 */
function nodePackageRoot(specifier: string): string {
    if (specifier.startsWith('node:')) {
        return specifier.toLowerCase();
    }
    const segments = specifier.split('/');
    const root = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
    return root.toLowerCase();
}

export async function readFileSafe(file: string): Promise<string | undefined> {
    try {
        return await fs.readFile(file, 'utf8');
    } catch {
        return undefined;
    }
}

export async function readDirectorySafe(directory: string): Promise<import('node:fs').Dirent[]> {
    try {
        return await fs.readdir(directory, { withFileTypes: true });
    } catch {
        return [];
    }
}
