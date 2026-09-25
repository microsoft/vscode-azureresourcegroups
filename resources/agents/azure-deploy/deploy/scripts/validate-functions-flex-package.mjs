#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

const maxEntries = 100_000;
const maxExpandedBytes = 1024 * 1024 * 1024;
const maxEntryBytes = 512 * 1024 * 1024;

function assertObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be a JSON object`);
    }
    return value;
}

export function validateZipEntryName(name) {
    if (!name || name.includes("\0") || name.includes("\\")) {
        throw new Error(`Unsafe ZIP entry name: ${JSON.stringify(name)}`);
    }
    if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
        throw new Error(`Absolute ZIP entry path is forbidden: ${name}`);
    }
    const withoutPrefix = name.replace(/^(?:\.\/)+/, "");
    const segments = withoutPrefix.split("/");
    if (!withoutPrefix || segments.includes("..")) {
        throw new Error(`ZIP traversal entry is forbidden: ${name}`);
    }
    const normalized = posix.normalize(withoutPrefix);
    if (normalized === ".." || normalized.startsWith("../")) {
        throw new Error(`ZIP traversal entry is forbidden: ${name}`);
    }
    return normalized;
}

function findEndOfCentralDirectory(buffer) {
    const minimum = Math.max(0, buffer.length - 65_557);
    for (let offset = buffer.length - 22; offset >= minimum; offset--) {
        if (buffer.readUInt32LE(offset) === 0x06054b50) {
            return offset;
        }
    }
    throw new Error("ZIP end-of-central-directory record not found");
}

function readZipEntries(buffer) {
    const eocd = findEndOfCentralDirectory(buffer);
    const diskNumber = buffer.readUInt16LE(eocd + 4);
    const centralDisk = buffer.readUInt16LE(eocd + 6);
    const diskEntries = buffer.readUInt16LE(eocd + 8);
    const entryCount = buffer.readUInt16LE(eocd + 10);
    const centralSize = buffer.readUInt32LE(eocd + 12);
    const centralOffset = buffer.readUInt32LE(eocd + 16);
    if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
        throw new Error("Multi-disk ZIP packages are unsupported");
    }
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
        throw new Error("ZIP64 packages are unsupported; split or reduce the Functions package");
    }
    if (entryCount > maxEntries || centralOffset + centralSize > buffer.length) {
        throw new Error("ZIP central directory exceeds safety limits");
    }

    const entries = [];
    const names = new Set();
    let expandedBytes = 0;
    let offset = centralOffset;
    for (let index = 0; index < entryCount; index++) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
            throw new Error(`Invalid ZIP central-directory entry ${index}`);
        }
        const flags = buffer.readUInt16LE(offset + 8);
        const method = buffer.readUInt16LE(offset + 10);
        const checksum = buffer.readUInt32LE(offset + 16);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const externalAttributes = buffer.readUInt32LE(offset + 38);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        const end = offset + 46 + nameLength + extraLength + commentLength;
        if (end > buffer.length) {
            throw new Error(`Truncated ZIP central-directory entry ${index}`);
        }
        const name = validateZipEntryName(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
        if (names.has(name)) {
            throw new Error(`Duplicate ZIP entry: ${name}`);
        }
        names.add(name);
        if ((flags & 0x1) !== 0) {
            throw new Error(`Encrypted ZIP entry is unsupported: ${name}`);
        }
        if (method !== 0 && method !== 8) {
            throw new Error(`Unsupported ZIP compression method ${method}: ${name}`);
        }
        if (((externalAttributes >>> 16) & 0xf000) === 0xa000) {
            throw new Error(`Symbolic-link ZIP entry is forbidden: ${name}`);
        }
        if (uncompressedSize > maxEntryBytes || expandedBytes + uncompressedSize > maxExpandedBytes) {
            throw new Error(`ZIP expansion exceeds safety limits at: ${name}`);
        }
        expandedBytes += uncompressedSize;
        entries.push({
            name,
            isDirectory: name.endsWith("/"),
            method,
            checksum,
            compressedSize,
            uncompressedSize,
            localHeaderOffset,
        });
        offset = end;
    }
    return entries;
}

function extractZip(buffer, entries, destination) {
    const destinationPrefix = `${resolve(destination)}${sep}`;
    for (const entry of entries) {
        const outputPath = resolve(destination, ...entry.name.split("/"));
        if (outputPath !== resolve(destination) && !outputPath.startsWith(destinationPrefix)) {
            throw new Error(`ZIP entry escaped extraction root: ${entry.name}`);
        }
        if (entry.isDirectory) {
            mkdirSync(outputPath, { recursive: true });
            continue;
        }
        const offset = entry.localHeaderOffset;
        if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
            throw new Error(`Invalid ZIP local header: ${entry.name}`);
        }
        const localNameLength = buffer.readUInt16LE(offset + 26);
        const localExtraLength = buffer.readUInt16LE(offset + 28);
        const dataOffset = offset + 30 + localNameLength + localExtraLength;
        const dataEnd = dataOffset + entry.compressedSize;
        if (dataEnd > buffer.length) {
            throw new Error(`Truncated ZIP data: ${entry.name}`);
        }
        const compressed = buffer.subarray(dataOffset, dataEnd);
        const contents = entry.method === 0
            ? compressed
            : inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 });
        if (contents.length !== entry.uncompressedSize) {
            throw new Error(`ZIP size mismatch: ${entry.name}`);
        }
        if (crc32(contents) !== entry.checksum) {
            throw new Error(`ZIP CRC mismatch: ${entry.name}`);
        }
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, contents);
    }
}

function listFiles(root) {
    const files = [];
    const visit = directory => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const fullPath = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                visit(fullPath);
            } else if (entry.isFile()) {
                files.push(fullPath);
            } else {
                throw new Error(`Unsupported package entry type: ${fullPath}`);
            }
        }
    };
    visit(root);
    return files;
}

function globToRegExp(pattern) {
    const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
    let expression = "^";
    for (let index = 0; index < normalized.length; index++) {
        const character = normalized[index];
        if (character === "*" && normalized[index + 1] === "*") {
            expression += ".*";
            index++;
        } else if (character === "*") {
            expression += "[^/]*";
        } else if (character === "?") {
            expression += "[^/]";
        } else {
            expression += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`${expression}$`);
}

export function supportsNodeMajor(range, major) {
    if (typeof range !== "string" || !range.trim()) {
        return false;
    }
    const text = range.trim();
    const lowerBounds = [...text.matchAll(/>=?\s*(\d+)/g)].map(match => Number(match[1]));
    const upperBounds = [...text.matchAll(/<\s*(\d+)/g)].map(match => Number(match[1]));
    if (lowerBounds.length > 0 || upperBounds.length > 0) {
        const minimum = lowerBounds.length > 0 ? Math.max(...lowerBounds) : 0;
        const maximumExclusive = upperBounds.length > 0 ? Math.min(...upperBounds) : Number.POSITIVE_INFINITY;
        return major >= minimum && major < maximumExclusive;
    }
    return new RegExp(`(?:^|[^0-9])(?:\\^|~)?${major}(?:\\.|\\.x|\\s|$)`).test(text);
}

function resolveRelativeImport(packageRoot, sourceFile, specifier) {
    const base = resolve(dirname(sourceFile), specifier);
    const root = resolve(packageRoot);
    const rootPrefix = `${root}${sep}`;
    if (base !== root && !base.startsWith(rootPrefix)) {
        throw new Error(`Compiled import escapes package root: ${relative(root, sourceFile)} -> ${specifier}`);
    }
    const candidates = [
        base,
        `${base}.js`,
        `${base}.json`,
        `${base}.node`,
        resolve(base, "index.js"),
        resolve(base, "index.json"),
    ];
    if (!candidates.some(candidate => existsSync(candidate) && statSync(candidate).isFile())) {
        throw new Error(`Compiled relative import is missing: ${relative(root, sourceFile)} -> ${specifier}`);
    }
}

export function validatePackageRoot(packageRoot, expectedFunctions, nodeMajor) {
    const root = resolve(packageRoot);
    if (!existsSync(root) || !statSync(root).isDirectory()) {
        throw new Error(`Package root does not exist: ${root}`);
    }
    for (const required of ["host.json", "package.json"]) {
        if (!existsSync(resolve(root, required))) {
            throw new Error(`Package root is missing ${required}`);
        }
    }
    if (!["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].some(file => existsSync(resolve(root, file)))) {
        throw new Error("Package root is missing a dependency lockfile");
    }

    let packageJson;
    try {
        packageJson = assertObject(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")), "package.json");
    } catch (error) {
        throw new Error(`Invalid package.json: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const engines = assertObject(packageJson.engines, "package.json.engines");
    if (!supportsNodeMajor(engines.node, nodeMajor)) {
        throw new Error(`package.json engines.node does not support the Function runtime Node ${nodeMajor}: ${String(engines.node)}`);
    }
    if (typeof packageJson.main !== "string" || !packageJson.main.trim()) {
        throw new Error("package.json.main must name the compiled Function module glob");
    }

    const files = listFiles(root);
    const relativeFiles = files.map(file => relative(root, file).replaceAll("\\", "/"));
    const mainPattern = globToRegExp(packageJson.main);
    const compiledFunctions = relativeFiles
        .filter(file => extname(file) === ".js" && mainPattern.test(file))
        .map(file => basename(file, ".js"))
        .sort();
    const expected = [...new Set(expectedFunctions)].sort();
    if (expected.length === 0) {
        throw new Error("At least one expected Function name is required");
    }
    if (JSON.stringify(compiledFunctions) !== JSON.stringify(expected)) {
        throw new Error(`Compiled Function set mismatch. Expected ${expected.join(", ")}; found ${compiledFunctions.join(", ") || "(none)"}`);
    }

    const dependencies = packageJson.dependencies === undefined
        ? {}
        : assertObject(packageJson.dependencies, "package.json.dependencies");
    for (const dependency of Object.keys(dependencies)) {
        const segments = dependency.startsWith("@") ? dependency.split("/") : [dependency];
        const dependencyRoot = resolve(root, "node_modules", ...segments);
        if (!existsSync(resolve(dependencyRoot, "package.json"))) {
            throw new Error(`Production dependency is missing from node_modules: ${dependency}`);
        }
    }

    const compiledFiles = files.filter(file => {
        const packageRelative = relative(root, file).replaceAll("\\", "/");
        return packageRelative.startsWith("dist/") && extname(file) === ".js";
    });
    const relativeImportPattern = /(?:require\s*\(\s*|from\s+|import\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+)["']/g;
    for (const file of compiledFiles) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(relativeImportPattern)) {
            resolveRelativeImport(root, file, match[1]);
        }
    }

    return {
        nodeMajor,
        main: packageJson.main,
        compiledFunctionModules: compiledFunctions,
        compiledJavaScriptModules: compiledFiles.length,
        productionDependencies: Object.keys(dependencies).sort(),
    };
}

function parseArguments(argv) {
    const allowed = new Set(["--self-test", "--root", "--zip", "--node-major", "--expected-functions"]);
    const values = new Map();
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (token === "--self-test") {
            values.set(token, "true");
            continue;
        }
        if (!token.startsWith("--")) {
            throw new Error(`Unexpected positional argument: ${token}`);
        }
        if (!allowed.has(token)) {
            throw new Error(`Unknown argument: ${token}`);
        }
        const value = argv[++index];
        if (value === undefined || value.startsWith("--")) {
            throw new Error(`Missing value for ${token}`);
        }
        if (values.has(token)) {
            throw new Error(`Duplicate argument: ${token}`);
        }
        values.set(token, value);
    }
    return values;
}

function requiredArgument(values, name) {
    const value = values.get(name);
    if (!value) {
        throw new Error(`Missing required argument: ${name}`);
    }
    return value;
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Self-test failed: ${message}`);
    }
}

function expectFailure(action, message) {
    try {
        action();
    } catch {
        return;
    }
    throw new Error(`Self-test failed: ${message}`);
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function writeStoredZip(packageRoot, zipPath) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const files = listFiles(packageRoot);
    for (const file of files) {
        const name = relative(packageRoot, file).replaceAll("\\", "/");
        const nameBuffer = Buffer.from(name, "utf8");
        const contents = readFileSync(file);
        const checksum = crc32(contents);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(contents.length, 18);
        localHeader.writeUInt32LE(contents.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localParts.push(localHeader, nameBuffer, contents);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(0x0314, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(contents.length, 20);
        centralHeader.writeUInt32LE(contents.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt32LE(localOffset, 42);
        centralParts.push(centralHeader, nameBuffer);
        localOffset += localHeader.length + nameBuffer.length + contents.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(localOffset, 16);
    writeFileSync(zipPath, Buffer.concat([...localParts, centralDirectory, end]));
    return files.length;
}

function runSelfTest() {
    const root = mkdtempSync(resolve(tmpdir(), "cor-flex-package-"));
    try {
        mkdirSync(resolve(root, "dist", "functions"), { recursive: true });
        mkdirSync(resolve(root, "dist", "shared"), { recursive: true });
        mkdirSync(resolve(root, "node_modules", "example"), { recursive: true });
        writeFileSync(resolve(root, "host.json"), "{}\n");
        writeFileSync(resolve(root, "package-lock.json"), "{}\n");
        writeFileSync(resolve(root, "package.json"), JSON.stringify({
            main: "dist/functions/*.js",
            engines: { node: "22.x" },
            dependencies: { example: "1.0.0" },
        }));
        writeFileSync(resolve(root, "node_modules", "example", "package.json"), '{"name":"example"}\n');
        writeFileSync(resolve(root, "dist", "shared", "utility.js"), "export const value = 1;\n");
        writeFileSync(resolve(root, "dist", "functions", "health.js"), "import { value } from '../shared/utility.js';\nexport { value };\n");

        const valid = validatePackageRoot(root, ["health"], 22);
        assert(valid.compiledFunctionModules[0] === "health", "valid package");
        const zipPath = resolve(root, "package-under-test.zip");
        const sourceFileCount = writeStoredZip(root, zipPath);
        const zipBuffer = readFileSync(zipPath);
        const zipEntries = readZipEntries(zipBuffer);
        assert(zipEntries.length === sourceFileCount, "ZIP central-directory validation");
        const corruptZip = Buffer.from(zipBuffer);
        const firstEntry = zipEntries[0];
        const localNameLength = corruptZip.readUInt16LE(firstEntry.localHeaderOffset + 26);
        const localExtraLength = corruptZip.readUInt16LE(firstEntry.localHeaderOffset + 28);
        const firstDataOffset = firstEntry.localHeaderOffset + 30 + localNameLength + localExtraLength;
        corruptZip[firstDataOffset] ^= 0xff;
        const corruptExtracted = mkdtempSync(resolve(tmpdir(), "cor-flex-corrupt-"));
        try {
            expectFailure(
                () => extractZip(corruptZip, zipEntries, corruptExtracted),
                "ZIP CRC rejection",
            );
        } finally {
            rmSync(corruptExtracted, { recursive: true, force: true });
        }
        const extracted = mkdtempSync(resolve(tmpdir(), "cor-flex-extracted-"));
        try {
            extractZip(zipBuffer, zipEntries, extracted);
            const zipValidation = validatePackageRoot(extracted, ["health"], 22);
            assert(zipValidation.compiledFunctionModules[0] === "health", "final ZIP package validation");
        } finally {
            rmSync(extracted, { recursive: true, force: true });
        }
        assert(supportsNodeMajor(">=22 <23", 22), "bounded Node engine");
        assert(!supportsNodeMajor("20.x", 22), "wrong Node engine");
        expectFailure(() => validateZipEntryName("../escape.js"), "ZIP traversal rejection");
        expectFailure(() => validateZipEntryName("dist\\health.js"), "ZIP backslash rejection");
        expectFailure(() => validatePackageRoot(root, ["missing"], 22), "Function set mismatch");

        writeFileSync(resolve(root, "dist", "functions", "health.js"), "import '../shared/missing.js';\n");
        expectFailure(() => validatePackageRoot(root, ["health"], 22), "relative import closure");
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
    return { passed: true };
}

async function main() {
    const values = parseArguments(process.argv.slice(2));
    if (values.has("--self-test")) {
        console.log(JSON.stringify(runSelfTest()));
        return;
    }
    const expectedFunctions = requiredArgument(values, "--expected-functions")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);
    const nodeMajor = Number(requiredArgument(values, "--node-major"));
    if (!Number.isInteger(nodeMajor) || nodeMajor < 18 || nodeMajor > 99) {
        throw new Error("--node-major must be an integer between 18 and 99");
    }
    const rootArgument = values.get("--root");
    const zipArgument = values.get("--zip");
    if ((rootArgument ? 1 : 0) + (zipArgument ? 1 : 0) !== 1) {
        throw new Error("Pass exactly one of --root or --zip");
    }

    let packageRoot;
    let temporaryRoot;
    let zipMetadata = {};
    try {
        if (zipArgument) {
            const zipPath = resolve(zipArgument);
            const buffer = readFileSync(zipPath);
            const entries = readZipEntries(buffer);
            temporaryRoot = mkdtempSync(resolve(tmpdir(), "cor-flex-zip-"));
            extractZip(buffer, entries, temporaryRoot);
            packageRoot = temporaryRoot;
            zipMetadata = {
                zipPath,
                zipBytes: buffer.length,
                zipSha256: createHash("sha256").update(buffer).digest("hex"),
                zipEntries: entries.length,
            };
        } else {
            packageRoot = resolve(rootArgument);
        }

        const validation = validatePackageRoot(packageRoot, expectedFunctions, nodeMajor);
        console.log(JSON.stringify({ passed: true, ...zipMetadata, ...validation }, null, 2));
    } finally {
        if (temporaryRoot) {
            rmSync(temporaryRoot, { recursive: true, force: true });
        }
    }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
