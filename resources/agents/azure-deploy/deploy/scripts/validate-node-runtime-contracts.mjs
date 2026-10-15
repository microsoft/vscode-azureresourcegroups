#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const sourceExtensions = new Set([".js", ".cjs", ".mjs", ".ts", ".tsx"]);
const skippedDirectories = new Set([
    ".azure",
    ".copilot-azure",
    ".git",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
]);
const maxFiles = 10_000;
const maxFileBytes = 2 * 1024 * 1024;
const maxTotalBytes = 64 * 1024 * 1024;

function parseArguments(argv) {
    const flags = new Set([
        "--self-test",
        "--require-correlation",
        "--require-postgres-mi",
        "--require-migration-probe",
    ]);
    const values = new Map();
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (flags.has(token)) {
            values.set(token, "true");
            continue;
        }
        if (token !== "--root") {
            throw new Error(`Unknown argument: ${token}`);
        }
        const value = argv[++index];
        if (!value || value.startsWith("--")) {
            throw new Error("Missing value for --root");
        }
        values.set(token, value);
    }
    return values;
}

function pathsEqual(left, right) {
    return process.platform === "win32"
        ? left.toLowerCase() === right.toLowerCase()
        : left === right;
}

function resolveConfinedRoot(input, workspaceRoot = process.cwd()) {
    const requested = resolve(workspaceRoot, input);
    if (!existsSync(requested) || !statSync(requested).isDirectory()) {
        throw new Error(`Runtime root does not exist: ${requested}`);
    }
    const realWorkspace = realpathSync(workspaceRoot);
    const realRoot = realpathSync(requested);
    const relation = relative(realWorkspace, realRoot);
    if (relation === ".." || relation.startsWith(`..${sep}`) || (!relation && !pathsEqual(realRoot, realWorkspace))) {
        throw new Error("--root must stay inside the workspace");
    }
    return realRoot;
}

function extension(path) {
    const index = path.lastIndexOf(".");
    return index < 0 ? "" : path.slice(index).toLowerCase();
}

function isTestFile(path) {
    return /(^|[\\/])(?:__tests__|tests?)([\\/]|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/i.test(path);
}

function collectFiles(root) {
    const files = [];
    let totalBytes = 0;

    const visit = directory => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) {
                continue;
            }
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                if (!skippedDirectories.has(entry.name)) {
                    visit(path);
                }
                continue;
            }
            if (!entry.isFile() || !sourceExtensions.has(extension(entry.name))) {
                continue;
            }
            const size = statSync(path).size;
            if (size > maxFileBytes) {
                throw new Error(`Runtime source exceeds the 2 MiB per-file limit: ${relative(root, path)}`);
            }
            totalBytes += size;
            if (totalBytes > maxTotalBytes || files.length >= maxFiles) {
                throw new Error("Runtime source exceeds the bounded scan limit");
            }
            files.push({
                path: relative(root, path),
                text: readFileSync(path, "utf8"),
                test: isTestFile(path),
            });
        }
    };

    visit(root);
    return files;
}

function requireCorrelationContract(files) {
    const production = files.filter(file => !file.test);
    const contractFile = production.find(file => {
        const text = file.text.toLowerCase();
        return text.includes("x-correlation-id") && text.includes("access-control-expose-headers");
    });
    if (!contractFile) {
        throw new Error(
            "Correlation contract missing: one production response helper must set both "
            + "X-Correlation-ID and Access-Control-Expose-Headers",
        );
    }

    const tests = files.filter(file => file.test).map(file => file.text.toLowerCase()).join("\n");
    if (!tests.includes("x-correlation-id")
        || !tests.includes("access-control-expose-headers")
        || !/(?:success|status\s*[:=]\s*2\d\d|toequal\s*\(\s*2\d\d)/i.test(tests)
        || !/(?:error|status\s*[:=]\s*[45]\d\d|toequal\s*\(\s*[45]\d\d)/i.test(tests)) {
        throw new Error(
            "Correlation tests must cover the response header and CORS exposure on success and error paths",
        );
    }
}

function poolConfigurationBlocks(text) {
    const blocks = [];
    const starts = text.matchAll(/\bnew\s+Pool\s*\(\s*\{/g);
    for (const start of starts) {
        const openingBrace = start.index + start[0].lastIndexOf("{");
        let depth = 0;
        let quote;
        let escaped = false;
        let lineComment = false;
        let blockComment = false;
        for (let index = openingBrace; index < text.length; index++) {
            const character = text[index];
            const next = text[index + 1];
            if (lineComment) {
                if (character === "\n") {
                    lineComment = false;
                }
                continue;
            }
            if (blockComment) {
                if (character === "*" && next === "/") {
                    blockComment = false;
                    index++;
                }
                continue;
            }
            if (quote) {
                if (escaped) {
                    escaped = false;
                } else if (character === "\\") {
                    escaped = true;
                } else if (character === quote) {
                    quote = undefined;
                }
                continue;
            }
            if (character === "/" && next === "/") {
                lineComment = true;
                index++;
                continue;
            }
            if (character === "/" && next === "*") {
                blockComment = true;
                index++;
                continue;
            }
            if (character === "'" || character === '"' || character === "`") {
                quote = character;
                continue;
            }
            if (character === "{") {
                depth++;
            } else if (character === "}" && --depth === 0) {
                blocks.push(text.slice(openingBrace, index + 1));
                break;
            }
        }
    }
    return blocks;
}

function requirePostgresManagedIdentityContract(files) {
    const productionFiles = files.filter(file => !file.test);
    const production = productionFiles.map(file => file.text).join("\n");
    const requiredPatterns = [
        [/\b(?:DefaultAzureCredential|ManagedIdentityCredential)\b/, "an Azure Identity credential"],
        [/https:\/\/ossrdbms-aad\.database\.windows\.net\/\.default/, "the OSS RDBMS token scope"],
        [/\bgetToken\s*\(/, "token acquisition"],
    ];

    for (const [pattern, description] of requiredPatterns) {
        if (!pattern.test(production)) {
            throw new Error(`PostgreSQL managed-identity contract missing ${description}`);
        }
    }

    const poolBlocks = productionFiles.flatMap(file => poolConfigurationBlocks(file.text));
    const passwordCallback =
        /\bpassword\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|\bpassword\s*:\s*async\s*\(/;
    if (poolBlocks.some(block => /\bconnectionString\s*:/.test(block) && passwordCallback.test(block))) {
        throw new Error("A pg.Pool configuration must not combine connectionString with a token callback");
    }
    const managedIdentityPool = poolBlocks.find(block =>
        /\bhost\s*:/.test(block)
        && /\bport\s*[:,]/.test(block)
        && /\bdatabase\s*:/.test(block)
        && /\buser\s*:/.test(block)
        && /\bssl\s*:/.test(block)
        && passwordCallback.test(block));
    if (!managedIdentityPool) {
        throw new Error(
            "PostgreSQL managed-identity Pool must contain explicit host, port, database, user, TLS, "
            + "and async password callback fields",
        );
    }
}

function requireMigrationProbeContract(files) {
    const productionFiles = files.filter(file => !file.test);
    const production = productionFiles.map(file => file.text).join("\n");
    if (!/\bparseMigrationProbeOnly\b/.test(production)
        || !/\bMIGRATION_PROBE_ONLY\b/.test(production)
        || !/normalized\s*===\s*["']true["']/.test(production)
        || !/normalized\s*===\s*["']false["']/.test(production)) {
        throw new Error(
            "Migration controller must use the canonical fail-closed parseMigrationProbeOnly contract",
        );
    }
    const controllerUsesParser = productionFiles.some(file =>
        !/(^|[\\/])migration-probe-mode\.mjs$/i.test(file.path)
        && (/\bparseMigrationProbeOnly\s*\(\s*process\.env\.MIGRATION_PROBE_ONLY\s*!?\s*\)/.test(file.text)
            || /\bresolveMigrationControllerMode\s*\(\s*(?:process\.env)?\s*\)/.test(file.text)));
    if (!controllerUsesParser) {
        throw new Error("Migration controller copies the probe parser but does not invoke it");
    }
}

function validate(values, workspaceRoot = process.cwd()) {
    const root = resolveConfinedRoot(values.get("--root") ?? ".", workspaceRoot);
    const requestedChecks = [
        "--require-correlation",
        "--require-postgres-mi",
        "--require-migration-probe",
    ].filter(flag => values.has(flag));
    if (requestedChecks.length === 0) {
        throw new Error("At least one runtime contract flag is required");
    }

    const files = collectFiles(root);
    if (files.length === 0) {
        throw new Error("No JavaScript or TypeScript runtime source found");
    }
    if (values.has("--require-correlation")) {
        requireCorrelationContract(files);
    }
    if (values.has("--require-postgres-mi")) {
        requirePostgresManagedIdentityContract(files);
    }
    if (values.has("--require-migration-probe")) {
        requireMigrationProbeContract(files);
    }

    return {
        passed: true,
        root,
        checks: requestedChecks.map(flag => flag.slice("--require-".length)),
        filesScanned: files.length,
    };
}

function expectFailure(action, message) {
    try {
        action();
    } catch {
        return;
    }
    throw new Error(`Self-test failed: ${message}`);
}

function writeFixture(root, valid = true) {
    mkdirSync(resolve(root, "src"), { recursive: true });
    mkdirSync(resolve(root, "tests"), { recursive: true });
    writeFileSync(resolve(root, "src", "contracts.ts"), `
import { DefaultAzureCredential } from "@azure/identity";
import { Pool } from "pg";
const credential = new DefaultAzureCredential();
export const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: 5432,
  database: process.env.POSTGRES_DATABASE,
  user: process.env.POSTGRES_USER,
  ssl: { rejectUnauthorized: true },
  password: async () => (await credential.getToken("https://ossrdbms-aad.database.windows.net/.default")).token,
});
export function parseMigrationProbeOnly(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("invalid");
}
const probe = parseMigrationProbeOnly(process.env.MIGRATION_PROBE_ONLY!);
export const headers = {
  "X-Correlation-ID": "id",
  ${valid ? '"Access-Control-Expose-Headers": "X-Correlation-ID",' : ""}
};
`);
    writeFileSync(resolve(root, "tests", "contracts.test.ts"), `
test("success response exposes X-Correlation-ID", () => {
  expect({ status: 200, "Access-Control-Expose-Headers": "X-Correlation-ID" }).toBeTruthy();
});
test("error response exposes X-Correlation-ID", () => {
  expect({ status: 400, "Access-Control-Expose-Headers": "X-Correlation-ID" }).toBeTruthy();
});
`);
}

function runSelfTest() {
    const root = mkdtempSync(resolve(tmpdir(), "cor-runtime-contracts-"));
    try {
        const valid = resolve(root, "valid");
        writeFixture(valid);
        const flags = new Map([
            ["--root", "valid"],
            ["--require-correlation", "true"],
            ["--require-postgres-mi", "true"],
            ["--require-migration-probe", "true"],
        ]);
        const result = validate(flags, root);
        if (!result.passed || result.checks.length !== 3) {
            throw new Error("Self-test failed: valid fixture");
        }
        const validSource = resolve(valid, "src", "contracts.ts");
        writeFileSync(
            validSource,
            readFileSync(validSource, "utf8").replace(
                "const probe = parseMigrationProbeOnly(process.env.MIGRATION_PROBE_ONLY!);",
                "",
            ),
        );
        expectFailure(() => validate(flags, root), "copied-but-unused migration parser rejection");

        const combined = resolve(root, "combined-pool");
        writeFixture(combined);
        const combinedSource = resolve(combined, "src", "contracts.ts");
        writeFileSync(
            combinedSource,
            readFileSync(combinedSource, "utf8").replace(
                "export const pool = new Pool({",
                "export const pool = new Pool({\n  connectionString: process.env.DATABASE_URL,",
            ),
        );
        flags.set("--root", "combined-pool");
        expectFailure(() => validate(flags, root), "connection string plus token callback rejection");

        const invalid = resolve(root, "invalid");
        writeFixture(invalid, false);
        flags.set("--root", "invalid");
        expectFailure(() => validate(flags, root), "missing correlation exposure rejection");
        expectFailure(
            () => resolveConfinedRoot(dirname(root), root),
            "workspace path confinement",
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
    return { passed: true };
}

async function main() {
    const values = parseArguments(process.argv.slice(2));
    if (values.has("--self-test")) {
        if (values.size !== 1) {
            throw new Error("--self-test cannot be combined with other arguments");
        }
        console.log(JSON.stringify(runSelfTest()));
        return;
    }
    console.log(JSON.stringify(validate(values), null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
