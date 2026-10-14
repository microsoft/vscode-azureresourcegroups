#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sessionFileLimit = 1024 * 1024;
const fingerprintPattern = /^[a-z0-9][a-z0-9._:/-]{2,127}$/;
const gateIds = [
    "artifact-target-binding",
    "iac-conformance",
    "component-build",
    "component-tests",
    "runtime-contracts",
    "package-integrity",
    "what-if",
    "inventory-baseline",
    "infrastructure",
    "code-deployment",
    "migration",
    "application-health",
    "dependency-access",
    "correlation",
];
const gateStatuses = new Set(["passed", "failed", "not-run", "not-applicable"]);
const healthStatuses = new Set(["healthy", "degraded", "unreachable", "unknown"]);
const failureClassifications = new Set([
    "CONTRACT_ERROR",
    "IAC_ERROR",
    "APPLICATION_ERROR",
    "INFRA_TRANSIENT",
    "ENVIRONMENT_BLOCKING",
    "UNKNOWN",
]);
const failedStages = new Set([
    "preflight",
    "what-if",
    "infrastructure",
    "code-deployment",
    "migration",
    "acceptance",
]);

function parseArguments(argv) {
    const allowed = new Set(["--self-test", "--session-path"]);
    const values = new Map();
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (!allowed.has(token)) {
            throw new Error(`Unknown argument: ${token}`);
        }
        if (values.has(token)) {
            throw new Error(`Duplicate argument: ${token}`);
        }
        if (token === "--self-test") {
            values.set(token, "true");
            continue;
        }
        const value = argv[++index];
        if (!value || value.startsWith("--")) {
            throw new Error(`Missing value for ${token}`);
        }
        values.set(token, value);
    }
    return values;
}

function required(values, name) {
    const value = values.get(name);
    if (!value) {
        throw new Error(`Missing required argument: ${name}`);
    }
    return value;
}

function pathsEqual(left, right) {
    return process.platform === "win32"
        ? left.toLowerCase() === right.toLowerCase()
        : left === right;
}

function resolveConfinedDirectory(input, workspaceRoot, label) {
    const path = resolve(workspaceRoot, input);
    if (!existsSync(path) || !statSync(path).isDirectory()) {
        throw new Error(`${label} does not exist: ${path}`);
    }
    const realWorkspace = realpathSync(workspaceRoot);
    const realPath = realpathSync(path);
    const relation = relative(realWorkspace, realPath);
    if (relation === ".." || relation.startsWith(`..${sep}`) || (!relation && !pathsEqual(realPath, realWorkspace))) {
        throw new Error(`${label} must stay inside the workspace`);
    }
    return realPath;
}

function validateSessionPath(input, workspaceRoot) {
    const sessionPath = resolveConfinedDirectory(input, workspaceRoot, "Session path");
    const sessionId = basename(sessionPath);
    if (!guidPattern.test(sessionId)
        || basename(dirname(sessionPath)).toLowerCase() !== "sessions"
        || basename(dirname(dirname(sessionPath))).toLowerCase() !== ".copilot-azure") {
        throw new Error("--session-path must be .copilot-azure/sessions/{uuid}");
    }
    return { sessionPath, sessionId };
}

function readJsonObject(path, label) {
    if (!existsSync(path) || !statSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
        throw new Error(`${label} is missing or is not a regular file`);
    }
    if (statSync(path).size > sessionFileLimit) {
        throw new Error(`${label} exceeds the 1 MiB safety limit`);
    }
    let value;
    try {
        value = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
        throw new Error(
            `${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        );
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be a JSON object`);
    }
    return value;
}

function object(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value;
}

function array(value, label) {
    if (!Array.isArray(value)) {
        throw new Error(`${label} must be an array`);
    }
    return value;
}

function string(value, label, maximum = 1024) {
    if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
        throw new Error(`${label} must be a non-empty string no longer than ${maximum} characters`);
    }
    return value;
}

function exact(value, expected, label) {
    if (value !== expected) {
        throw new Error(`${label} must be ${JSON.stringify(expected)}`);
    }
}

function canonicalJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map(key =>
            `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function jsonSha256(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function equal(actual, expected, label) {
    if (actual.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(`${label} does not match the locked target`);
    }
}

function evidencePath(input, workspaceRoot, sessionPath, label) {
    const value = string(input, label, 512);
    if (value.includes("\0") || isAbsolute(value)) {
        throw new Error(`${label} must be a workspace-relative path without null bytes`);
    }
    const path = resolve(workspaceRoot, value);
    if (!existsSync(path) || !statSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
        throw new Error(`${label} must name an existing regular file`);
    }
    const realWorkspace = realpathSync(workspaceRoot);
    const realPath = realpathSync(path);
    const relation = relative(realWorkspace, realPath);
    if (relation === ".." || relation.startsWith(`..${sep}`)) {
        throw new Error(`${label} must stay inside the workspace`);
    }
    const pendingPath = resolve(sessionPath, "first-pass-outcome.pending.json");
    const finalPath = resolve(sessionPath, "first-pass-outcome.json");
    if (pathsEqual(realPath, pendingPath) || pathsEqual(realPath, finalPath)) {
        throw new Error(`${label} cannot point at the first-pass input or output`);
    }
    return relation.replaceAll("\\", "/");
}

function validateTarget(context, scaffold, validation) {
    const azure = object(context.azure, "context.json.azure");
    const contract = object(scaffold.deploymentContract, "scaffold-manifest.json.deploymentContract");
    exact(scaffold.schemaVersion, 2, "scaffold-manifest.json.schemaVersion");
    exact(contract.schemaVersion, 1, "deploymentContract.schemaVersion");
    const target = object(contract.target, "deploymentContract.target");
    const subscriptionId = string(azure.subscriptionId, "context.json.azure.subscriptionId");
    const tenantId = typeof azure.tenantId === "string" && azure.tenantId.length > 0
        ? azure.tenantId
        : undefined;
    const resourceGroup = string(azure.resourceGroup, "context.json.azure.resourceGroup");
    const region = string(azure.region, "context.json.azure.region");
    equal(string(target.subscriptionId, "deploymentContract.target.subscriptionId"),
        subscriptionId, "deployment contract subscription");
    equal(string(target.resourceGroup, "deploymentContract.target.resourceGroup"),
        resourceGroup, "deployment contract resource group");
    equal(string(target.region, "deploymentContract.target.region"),
        region, "deployment contract region");
    if (tenantId) {
        equal(string(target.tenantId, "deploymentContract.target.tenantId"),
            tenantId, "deployment contract tenant");
    }
    exact(validation.schemaVersion, 2, "deployment-artifact-validation.json.schemaVersion");
    exact(validation.passed, true, "deployment-artifact-validation.json.passed");
    const validationContract = object(
        validation.deploymentContract,
        "deployment-artifact-validation.json.deploymentContract",
    );
    exact(validationContract.contractSchemaVersion, 1,
        "deployment-artifact-validation.json.deploymentContract.contractSchemaVersion");
    const contractSha256 = jsonSha256(contract);
    exact(
        string(validationContract.sha256,
            "deployment-artifact-validation.json.deploymentContract.sha256", 64),
        contractSha256,
        "deployment artifact contract SHA-256",
    );
    const validationTarget = object(
        validation.target,
        "deployment-artifact-validation.json.target",
    );
    equal(string(validationTarget.subscriptionId, "deployment artifact subscription"),
        subscriptionId, "deployment artifact subscription");
    equal(string(validationTarget.resourceGroup, "deployment artifact resource group"),
        resourceGroup, "deployment artifact resource group");
    equal(string(validationTarget.region, "deployment artifact region"),
        region, "deployment artifact region");
    if (tenantId) {
        equal(string(validationTarget.tenantId, "deployment artifact tenant"),
            tenantId, "deployment artifact tenant");
    }
    return {
        contractSha256,
        target: {
            subscriptionId: subscriptionId.toLowerCase(),
            ...(tenantId ? { tenantId: tenantId.toLowerCase() } : {}),
            resourceGroup,
            region,
        },
    };
}

function validateFailure(value, workspaceRoot, sessionPath) {
    const failure = object(value, "first-pass failure");
    if (!failureClassifications.has(failure.classification)) {
        throw new Error("first-pass failure.classification is invalid");
    }
    const fingerprint = string(failure.fingerprint, "first-pass failure.fingerprint", 128);
    if (!fingerprintPattern.test(fingerprint)) {
        throw new Error("first-pass failure.fingerprint must be a stable lowercase key");
    }
    const evidencePaths = array(failure.evidencePaths, "first-pass failure.evidencePaths")
        .map((path, index) => evidencePath(
            path,
            workspaceRoot,
            sessionPath,
            `first-pass failure.evidencePaths[${index}]`,
        ));
    if (evidencePaths.length === 0) {
        throw new Error("first-pass failure.evidencePaths must contain evidence");
    }
    return {
        classification: failure.classification,
        fingerprint,
        summary: string(failure.summary, "first-pass failure.summary"),
        evidencePaths,
    };
}

function validateGates(value, contract, workspaceRoot, sessionPath) {
    const gates = array(value, "first-pass gates");
    if (gates.length !== gateIds.length) {
        throw new Error(`first-pass gates must contain exactly ${gateIds.length} outcomes`);
    }
    const seen = new Set();
    const normalized = gates.map((value, index) => {
        const gate = object(value, `first-pass gates[${index}]`);
        const id = string(gate.id, `first-pass gates[${index}].id`, 64);
        if (!gateIds.includes(id) || seen.has(id)) {
            throw new Error(`first-pass gates contains an invalid or duplicate id: ${id}`);
        }
        seen.add(id);
        if (!gateStatuses.has(gate.status)) {
            throw new Error(`first-pass gate ${id} has an invalid status`);
        }
        const evidencePaths = array(
            gate.evidencePaths,
            `first-pass gate ${id}.evidencePaths`,
        ).map((path, evidenceIndex) => evidencePath(
            path,
            workspaceRoot,
            sessionPath,
            `first-pass gate ${id}.evidencePaths[${evidenceIndex}]`,
        ));
        if ((gate.status === "passed" || gate.status === "failed") && evidencePaths.length === 0) {
            throw new Error(`first-pass gate ${id} requires evidence for ${gate.status}`);
        }
        const detail = gate.detail === undefined
            ? undefined
            : string(gate.detail, `first-pass gate ${id}.detail`);
        if ((gate.status === "not-run" || gate.status === "not-applicable") && !detail) {
            throw new Error(`first-pass gate ${id} requires detail for ${gate.status}`);
        }
        return {
            id,
            status: gate.status,
            evidencePaths,
            ...(detail ? { detail } : {}),
        };
    });

    const acceptance = object(contract.acceptance, "deploymentContract.acceptance");
    for (const id of ["migration", "correlation"]) {
        const expected = acceptance[id] === "required" ? "passed" : "not-applicable";
        const gate = normalized.find(outcome => outcome.id === id);
        if (gate.status === "not-applicable" && expected === "passed") {
            throw new Error(`first-pass gate ${id} cannot be not-applicable when the contract requires it`);
        }
        if (gate.status !== "not-applicable" && expected === "not-applicable") {
            throw new Error(`first-pass gate ${id} must be not-applicable for this contract`);
        }
    }
    return gateIds.map(id => normalized.find(gate => gate.id === id));
}

function record(values, workspaceRoot = process.cwd()) {
    const { sessionPath, sessionId } = validateSessionPath(
        required(values, "--session-path"),
        workspaceRoot,
    );
    const pendingPath = resolve(sessionPath, "first-pass-outcome.pending.json");
    const finalPath = resolve(sessionPath, "first-pass-outcome.json");
    if (existsSync(finalPath)) {
        throw new Error("first-pass-outcome.json already exists and is immutable");
    }
    const input = readJsonObject(pendingPath, "first-pass-outcome.pending.json");
    exact(input.schemaVersion, 1, "first-pass input.schemaVersion");
    exact(string(input.sessionId, "first-pass input.sessionId"), sessionId, "first-pass input.sessionId");
    if (input.status !== "succeeded" && input.status !== "failed") {
        throw new Error("first-pass input.status must be succeeded or failed");
    }
    if (!healthStatuses.has(input.healthStatus)) {
        throw new Error("first-pass input.healthStatus is invalid");
    }
    if (input.deploymentExitCode !== undefined
        && (!Number.isInteger(input.deploymentExitCode) || input.deploymentExitCode < 0)) {
        throw new Error("first-pass input.deploymentExitCode must be a non-negative integer");
    }

    const context = readJsonObject(resolve(sessionPath, "context.json"), "context.json");
    const scaffold = readJsonObject(
        resolve(sessionPath, "scaffold-manifest.json"),
        "scaffold-manifest.json",
    );
    const validation = readJsonObject(
        resolve(sessionPath, "deployment-artifact-validation.json"),
        "deployment-artifact-validation.json",
    );
    exact(string(context.sessionId, "context.json.sessionId"), sessionId, "context session");
    exact(string(scaffold.sessionId, "scaffold-manifest.json.sessionId"), sessionId, "scaffold session");
    exact(string(validation.sessionId, "deployment-artifact-validation.json.sessionId"),
        sessionId, "deployment artifact session");
    const { contractSha256, target } = validateTarget(context, scaffold, validation);
    const contract = object(scaffold.deploymentContract, "scaffold-manifest.json.deploymentContract");
    const gates = validateGates(input.gates, contract, workspaceRoot, sessionPath);
    const validationEvidencePath = relative(
        realpathSync(workspaceRoot),
        realpathSync(resolve(sessionPath, "deployment-artifact-validation.json")),
    ).replaceAll("\\", "/");
    const artifactGate = gates.find(gate => gate.id === "artifact-target-binding");
    if (artifactGate.status !== "passed"
        || !artifactGate.evidencePaths.includes(validationEvidencePath)) {
        throw new Error("artifact-target-binding must pass with deployment-artifact-validation.json evidence");
    }
    const failedGates = gates.filter(gate => gate.status === "failed");

    let failure;
    if (input.status === "succeeded") {
        if (input.failedStage !== undefined || input.failure !== undefined) {
            throw new Error("A succeeded first pass cannot contain failedStage or failure");
        }
        if (input.healthStatus !== "healthy") {
            throw new Error("A succeeded first pass must be healthy");
        }
        if (input.deploymentExitCode !== undefined && input.deploymentExitCode !== 0) {
            throw new Error("A succeeded first pass must have deploymentExitCode 0");
        }
        const incomplete = gates.filter(gate =>
            gate.status !== "passed" && gate.status !== "not-applicable");
        if (incomplete.length > 0) {
            throw new Error(`A succeeded first pass has incomplete gates: ${incomplete.map(gate => gate.id).join(", ")}`);
        }
    } else {
        if (!failedStages.has(input.failedStage)) {
            throw new Error("A failed first pass requires a valid failedStage");
        }
        failure = validateFailure(input.failure, workspaceRoot, sessionPath);
        if (failedGates.length === 0) {
            throw new Error("A failed first pass requires at least one failed gate");
        }
        const failedEvidence = new Set(failedGates.flatMap(gate => gate.evidencePaths));
        if (!failure.evidencePaths.some(path => failedEvidence.has(path))) {
            throw new Error("A failed first pass must link the typed failure to a failed gate evidence path");
        }
    }

    const outcome = {
        schemaVersion: 1,
        sessionId,
        recordedUtc: new Date().toISOString(),
        contractSha256,
        target,
        status: input.status,
        ...(input.failedStage ? { failedStage: input.failedStage } : {}),
        ...(input.deploymentExitCode !== undefined
            ? { deploymentExitCode: input.deploymentExitCode }
            : {}),
        healthStatus: input.healthStatus,
        gates,
        ...(failure ? { failure } : {}),
    };
    writeFileSync(finalPath, `${JSON.stringify(outcome, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
    });
    rmSync(pendingPath);
    return {
        schemaVersion: 1,
        passed: true,
        sessionId,
        status: outcome.status,
        evidencePath: relative(sessionPath, finalPath).replaceAll("\\", "/"),
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

function writeFixture(root, inputTransform) {
    const sessionId = "11111111-2222-4333-8444-555555555555";
    const subscriptionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const tenantId = "11111111-aaaa-4bbb-8ccc-222222222222";
    const sessionPath = resolve(root, ".copilot-azure", "sessions", sessionId);
    mkdirSync(sessionPath, { recursive: true });
    writeFileSync(resolve(root, "deploy-audit.log"), "deployment evidence\n");
    writeFileSync(resolve(root, "component-checks.json"), "{}\n");
    writeFileSync(resolve(sessionPath, "context.json"), JSON.stringify({
        sessionId,
        azure: {
            subscriptionId,
            tenantId,
            resourceGroup: "rg-locked",
            region: "westus2",
        },
    }));
    writeFileSync(resolve(sessionPath, "scaffold-manifest.json"), JSON.stringify({
        schemaVersion: 2,
        sessionId,
        deploymentContract: {
            schemaVersion: 1,
            target: {
                subscriptionId,
                tenantId,
                resourceGroup: "rg-locked",
                region: "westus2",
            },
            acceptance: {
                migration: "not-applicable",
                correlation: "required",
            },
        },
    }));
    const scaffold = readJsonObject(
        resolve(sessionPath, "scaffold-manifest.json"),
        "scaffold fixture",
    );
    writeFileSync(resolve(sessionPath, "deployment-artifact-validation.json"), JSON.stringify({
        schemaVersion: 2,
        passed: true,
        sessionId,
        target: {
            subscriptionId,
            tenantId,
            resourceGroup: "rg-locked",
            region: "westus2",
        },
        deploymentContract: {
            contractSchemaVersion: 1,
            sha256: jsonSha256(scaffold.deploymentContract),
        },
    }));
    const input = {
        schemaVersion: 1,
        sessionId,
        status: "succeeded",
        deploymentExitCode: 0,
        healthStatus: "healthy",
        gates: gateIds.map(id => ({
            id,
            status: id === "migration" ? "not-applicable" : "passed",
            evidencePaths: id === "migration"
                ? []
                : id === "artifact-target-binding"
                    ? [relative(root, resolve(sessionPath, "deployment-artifact-validation.json"))
                        .replaceAll("\\", "/")]
                    : ["deploy-audit.log"],
            ...(id === "migration" ? { detail: "No relational database or migration framework." } : {}),
        })),
    };
    inputTransform?.(input);
    writeFileSync(
        resolve(sessionPath, "first-pass-outcome.pending.json"),
        JSON.stringify(input),
    );
    return {
        sessionPath,
        values: new Map([["--session-path", relative(root, sessionPath)]]),
    };
}

function runSelfTest() {
    const root = mkdtempSync(resolve(tmpdir(), "cor-first-pass-"));
    try {
        const validRoot = resolve(root, "valid");
        mkdirSync(validRoot);
        const fixture = writeFixture(validRoot);
        const result = record(fixture.values, validRoot);
        if (!result.passed || result.status !== "succeeded") {
            throw new Error("Self-test failed: valid first-pass outcome");
        }
        const stored = readJsonObject(
            resolve(fixture.sessionPath, "first-pass-outcome.json"),
            "stored first-pass outcome",
        );
        if (stored.status !== "succeeded" || stored.gates.length !== gateIds.length) {
            throw new Error("Self-test failed: canonical first-pass output");
        }
        writeFileSync(
            resolve(fixture.sessionPath, "first-pass-outcome.pending.json"),
            JSON.stringify({}),
        );
        expectFailure(() => record(fixture.values, validRoot), "immutable overwrite rejection");

        const failedWithoutCauseRoot = resolve(root, "failed-without-cause");
        mkdirSync(failedWithoutCauseRoot);
        const failedWithoutCause = writeFixture(failedWithoutCauseRoot, input => {
            input.status = "failed";
            input.healthStatus = "degraded";
            input.failedStage = "acceptance";
            input.gates.find(gate => gate.id === "application-health").status = "failed";
        });
        expectFailure(
            () => record(failedWithoutCause.values, failedWithoutCauseRoot),
            "failed outcome without typed cause",
        );

        const invalidSuccessRoot = resolve(root, "invalid-success");
        mkdirSync(invalidSuccessRoot);
        const invalidSuccess = writeFixture(invalidSuccessRoot, input => {
            input.gates.find(gate => gate.id === "application-health").status = "failed";
        });
        expectFailure(
            () => record(invalidSuccess.values, invalidSuccessRoot),
            "success with failed gate",
        );

        const missingEvidenceRoot = resolve(root, "missing-evidence");
        mkdirSync(missingEvidenceRoot);
        const missingEvidence = writeFixture(missingEvidenceRoot, input => {
            input.gates.find(gate => gate.id === "what-if").evidencePaths = ["missing.json"];
        });
        expectFailure(
            () => record(missingEvidence.values, missingEvidenceRoot),
            "missing gate evidence",
        );

        const contractDriftRoot = resolve(root, "contract-drift");
        mkdirSync(contractDriftRoot);
        const contractDrift = writeFixture(contractDriftRoot);
        const driftedScaffold = readJsonObject(
            resolve(contractDrift.sessionPath, "scaffold-manifest.json"),
            "drifted scaffold fixture",
        );
        driftedScaffold.deploymentContract.acceptance.correlation = "not-applicable";
        writeFileSync(
            resolve(contractDrift.sessionPath, "scaffold-manifest.json"),
            JSON.stringify(driftedScaffold),
        );
        expectFailure(
            () => record(contractDrift.values, contractDriftRoot),
            "deployment contract changed after validation",
        );

        const validFailureRoot = resolve(root, "valid-failure");
        mkdirSync(validFailureRoot);
        const validFailure = writeFixture(validFailureRoot, input => {
            input.status = "failed";
            input.healthStatus = "degraded";
            input.failedStage = "acceptance";
            input.gates.find(gate => gate.id === "application-health").status = "failed";
            input.failure = {
                classification: "APPLICATION_ERROR",
                fingerprint: "acceptance.health.http-500",
                summary: "The dependency-backed health route returned HTTP 500.",
                evidencePaths: ["deploy-audit.log"],
            };
        });
        if (record(validFailure.values, validFailureRoot).status !== "failed") {
            throw new Error("Self-test failed: valid failed outcome");
        }
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
    console.log(JSON.stringify(record(values), null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
