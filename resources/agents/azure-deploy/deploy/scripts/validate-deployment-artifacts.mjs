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
import { basename, dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sessionFileLimit = 4 * 1024 * 1024;
const infraFileLimit = 4 * 1024 * 1024;
const infraTotalLimit = 64 * 1024 * 1024;
const infraFileCountLimit = 5_000;
const textExtensions = new Set([".bicep", ".json", ".tf", ".tfvars"]);

function parseArguments(argv) {
    const allowed = new Set([
        "--self-test",
        "--session-path",
        "--infra-path",
        "--subscription",
        "--tenant",
        "--resource-group",
        "--region",
    ]);
    const values = new Map();
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (!allowed.has(token)) {
            throw new Error(`Unknown argument: ${token}`);
        }
        if (token === "--self-test") {
            values.set(token, "true");
            continue;
        }
        const value = argv[++index];
        if (!value || value.startsWith("--")) {
            throw new Error(`Missing value for ${token}`);
        }
        if (values.has(token)) {
            throw new Error(`Duplicate argument: ${token}`);
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
    if (!existsSync(path) || !statSync(path).isFile()) {
        throw new Error(`${label} is missing`);
    }
    if (statSync(path).size > sessionFileLimit) {
        throw new Error(`${label} exceeds the 4 MiB safety limit`);
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

function string(value, label) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function equal(actual, expected, label) {
    if (actual.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(`${label} does not match the locked target`);
    }
}

function optionValues(command, option) {
    const pattern = new RegExp(
        `(?:^|\\s)${option.replace("-", "\\-")}(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|([^\\s]+))`,
        "gi",
    );
    return [...command.matchAll(pattern)].map(match => match[1] ?? match[2] ?? match[3]);
}

function assertCommandTarget(command, subscriptionId, resourceGroup, iacFormat) {
    if (/\baz\s+account\s+set\b/i.test(command)) {
        throw new Error("scaffold-manifest.json.deployCommand must not call az account set");
    }
    if (iacFormat === "terraform") {
        if (!/\bterraform\s+(?:plan|apply)\b/i.test(command)) {
            throw new Error("Terraform scaffold deployCommand must invoke terraform plan or apply");
        }
        return;
    }
    const subscriptions = optionValues(command, "--subscription");
    if (subscriptions.length === 0) {
        throw new Error("scaffold-manifest.json.deployCommand must include --subscription");
    }
    for (const subscription of subscriptions) {
        equal(subscription, subscriptionId, "deployCommand --subscription");
    }
    for (const group of [
        ...optionValues(command, "--resource-group"),
        ...optionValues(command, "-g"),
    ]) {
        equal(group, resourceGroup, "deployCommand resource group");
    }
}

function extension(path) {
    const index = path.lastIndexOf(".");
    return index < 0 ? "" : path.slice(index).toLowerCase();
}

function collectInfraFiles(root) {
    const files = [];
    let totalBytes = 0;
    const visit = directory => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink() || entry.name === ".git" || entry.name === "node_modules") {
                continue;
            }
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                visit(path);
                continue;
            }
            if (!entry.isFile() || !textExtensions.has(extension(entry.name))) {
                continue;
            }
            const size = statSync(path).size;
            if (size > infraFileLimit) {
                throw new Error(`Infrastructure file exceeds the 4 MiB safety limit: ${relative(root, path)}`);
            }
            totalBytes += size;
            if (files.length >= infraFileCountLimit || totalBytes > infraTotalLimit) {
                throw new Error("Infrastructure exceeds the bounded scan limit");
            }
            files.push({ path: relative(root, path), text: readFileSync(path, "utf8") });
        }
    };
    visit(root);
    return files;
}

function inspectTargetText(text, label, expected) {
    const checks = [
        {
            pattern: /\/subscriptions\/([0-9a-f-]{36})(?:\/|$)/gi,
            expected: expected.subscriptionId,
            name: "subscription",
        },
        {
            pattern: /\/resourceGroups\/([^/'"\s]+)/gi,
            expected: expected.resourceGroup,
            name: "resource group",
        },
        {
            pattern: /(?:--subscription)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/gi,
            expected: expected.subscriptionId,
            name: "subscription argument",
        },
        {
            pattern: /(?:--resource-group|-g)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/gi,
            expected: expected.resourceGroup,
            name: "resource-group argument",
        },
        {
            pattern: /(?:subscription_id|subscriptionId)\s*[:=]\s*["']([0-9a-f-]{36})["']/gi,
            expected: expected.subscriptionId,
            name: "subscription field",
        },
        {
            pattern: /(?:resource_group_name|resourceGroupName)\s*[:=]\s*["']([^"']+)["']/gi,
            expected: expected.resourceGroup,
            name: "resource-group field",
        },
    ];
    for (const check of checks) {
        for (const match of text.matchAll(check.pattern)) {
            const value = match[1] ?? match[2] ?? match[3];
            if (value.toLowerCase() !== check.expected.toLowerCase()) {
                throw new Error(`${label} contains a stale ${check.name}: ${value}`);
            }
        }
    }

    for (const match of text.matchAll(/['"](rg-[A-Za-z0-9_.()-]+)['"]/gi)) {
        if (match[1].toLowerCase() !== expected.resourceGroup.toLowerCase()) {
            throw new Error(`${label} contains a stale resource-group literal: ${match[1]}`);
        }
    }

    const resourceGroupBlocks =
        /resource\s+\w+\s+['"]Microsoft\.Resources\/resourceGroups@[^'"]+['"]([\s\S]{0,1500}?)(?=\n\s*resource\s|$)/gi;
    for (const match of text.matchAll(resourceGroupBlocks)) {
        const name = /name\s*:\s*['"]([^'"]+)['"]/i.exec(match[1])?.[1];
        if (name && name.toLowerCase() !== expected.resourceGroup.toLowerCase()) {
            throw new Error(`${label} contains a stale resource group declaration: ${name}`);
        }
        const location = /location\s*:\s*['"]([^'"]+)['"]/i.exec(match[1])?.[1];
        if (location && location.toLowerCase() !== expected.region.toLowerCase()) {
            throw new Error(`${label} contains a stale resource group location: ${location}`);
        }
    }
}

function inspectJsonTargets(value, label, expected, path = "$", depth = 0) {
    if (depth > 64) {
        throw new Error(`${label} exceeds the maximum JSON nesting depth`);
    }
    if (Array.isArray(value)) {
        value.forEach((entry, index) =>
            inspectJsonTargets(entry, label, expected, `${path}[${index}]`, depth + 1));
        return;
    }
    if (!value || typeof value !== "object") {
        return;
    }
    for (const [key, entry] of Object.entries(value)) {
        const entryPath = `${path}.${key}`;
        const normalized = key.toLowerCase();
        if (typeof entry === "string") {
            if (normalized === "subscriptionid") {
                equal(entry, expected.subscriptionId, `${label} ${entryPath}`);
            } else if (normalized === "tenantid" && expected.tenantId) {
                equal(entry, expected.tenantId, `${label} ${entryPath}`);
            } else if (normalized === "resourcegroup" || normalized === "resourcegroupname") {
                equal(entry, expected.resourceGroup, `${label} ${entryPath}`);
            }
        } else if ((normalized === "subscriptionid"
            || normalized === "tenantid"
            || normalized === "resourcegroup"
            || normalized === "resourcegroupname")
            && entry && typeof entry === "object" && !Array.isArray(entry)
            && typeof entry.value === "string") {
            const expectedValue = normalized === "subscriptionid"
                ? expected.subscriptionId
                : normalized === "tenantid"
                    ? expected.tenantId
                    : expected.resourceGroup;
            if (expectedValue) {
                equal(entry.value, expectedValue, `${label} ${entryPath}.value`);
            }
        }
        inspectJsonTargets(entry, label, expected, entryPath, depth + 1);
    }
}

function validate(values, workspaceRoot = process.cwd()) {
    const subscriptionId = required(values, "--subscription");
    const tenantId = values.get("--tenant");
    const resourceGroup = required(values, "--resource-group");
    const region = required(values, "--region");
    if (!guidPattern.test(subscriptionId) || (tenantId && !guidPattern.test(tenantId))) {
        throw new Error("--subscription and --tenant must be Azure GUIDs");
    }
    const { sessionPath, sessionId } = validateSessionPath(
        required(values, "--session-path"),
        workspaceRoot,
    );
    const infraPath = resolveConfinedDirectory(
        required(values, "--infra-path"),
        workspaceRoot,
        "Infrastructure path",
    );

    const context = readJsonObject(resolve(sessionPath, "context.json"), "context.json");
    const prepare = readJsonObject(resolve(sessionPath, "prepare-plan.json"), "prepare-plan.json");
    const scaffold = readJsonObject(resolve(sessionPath, "scaffold-manifest.json"), "scaffold-manifest.json");
    const azure = object(context.azure, "context.json.azure");
    const deploymentVariables = object(
        prepare.deploymentVariables,
        "prepare-plan.json.deploymentVariables",
    );

    equal(string(azure.subscriptionId, "context.json.azure.subscriptionId"), subscriptionId, "context subscription");
    equal(string(azure.resourceGroup, "context.json.azure.resourceGroup"), resourceGroup, "context resource group");
    equal(string(azure.region, "context.json.azure.region"), region, "context region");
    if (tenantId) {
        equal(string(azure.tenantId, "context.json.azure.tenantId"), tenantId, "context tenant");
    }
    equal(
        string(deploymentVariables.subscriptionId, "deploymentVariables.subscriptionId"),
        subscriptionId,
        "prepare-plan subscription",
    );
    equal(
        string(deploymentVariables.resourceGroup, "deploymentVariables.resourceGroup"),
        resourceGroup,
        "prepare-plan resource group",
    );
    equal(
        string(deploymentVariables.location, "deploymentVariables.location"),
        region,
        "prepare-plan region",
    );
    if (tenantId) {
        equal(
            string(deploymentVariables.tenantId, "deploymentVariables.tenantId"),
            tenantId,
            "prepare-plan tenant",
        );
    }
    equal(string(context.sessionId, "context.json.sessionId"), sessionId, "context session");
    equal(string(scaffold.sessionId, "scaffold-manifest.json.sessionId"), sessionId, "scaffold session");
    const lockedFields = Array.isArray(azure.lockedFields)
        ? azure.lockedFields.filter(field => typeof field === "string")
        : [];
    const requiredLockedFields = ["subscriptionId", "resourceGroup", "region", ...(tenantId ? ["tenantId"] : [])];
    if (!requiredLockedFields.every(field => lockedFields.includes(field))) {
        throw new Error("context.json.azure.lockedFields does not lock the complete deployment target");
    }
    const validationResult = object(
        scaffold.validationResult,
        "scaffold-manifest.json.validationResult",
    );
    if (validationResult.status !== "Validated") {
        throw new Error("scaffold-manifest.json.validationResult.status must be Validated");
    }
    const conformance = object(scaffold.conformance, "scaffold-manifest.json.conformance");
    const iacFormat = string(scaffold.iacFormat, "scaffold-manifest.json.iacFormat");
    const conformanceSource = conformance.source;
    if ((iacFormat !== "bicep" && iacFormat !== "terraform")
        || conformance.passed !== true
        || (conformanceSource !== "script" && conformanceSource !== "manual")
        || (iacFormat === "bicep" && conformanceSource !== "script")) {
        throw new Error("scaffold-manifest.json must record passing format-appropriate conformance");
    }
    assertCommandTarget(
        string(scaffold.deployCommand, "scaffold-manifest.json.deployCommand"),
        subscriptionId,
        resourceGroup,
        iacFormat,
    );

    const expected = { subscriptionId, tenantId, resourceGroup, region };
    inspectJsonTargets(context, "context.json", expected);
    inspectJsonTargets(prepare, "prepare-plan.json", expected);
    inspectJsonTargets(scaffold, "scaffold-manifest.json", expected);

    const infraFiles = collectInfraFiles(infraPath);
    if (infraFiles.length === 0) {
        throw new Error("Infrastructure path contains no Bicep, Terraform, or JSON artifacts");
    }
    let resourceGroupReferenceFound = false;
    let subscriptionReferenceFound = scaffold.deployCommand.toLowerCase().includes(subscriptionId.toLowerCase());
    for (const file of infraFiles) {
        inspectTargetText(file.text, `infra/${file.path}`, expected);
        if (file.text.toLowerCase().includes(resourceGroup.toLowerCase())) {
            resourceGroupReferenceFound = true;
        }
        if (file.text.toLowerCase().includes(subscriptionId.toLowerCase())) {
            subscriptionReferenceFound = true;
        }
        if (extension(file.path) === ".json") {
            try {
                inspectJsonTargets(JSON.parse(file.text), `infra/${file.path}`, expected);
            } catch (error) {
                if (error instanceof SyntaxError) {
                    throw new Error(`infra/${file.path} is invalid JSON: ${error.message}`, { cause: error });
                }
                throw error;
            }
        }
    }
    if (!resourceGroupReferenceFound) {
        throw new Error("Infrastructure artifacts do not bind the locked resource group");
    }
    if (!subscriptionReferenceFound) {
        throw new Error("Deployment artifacts do not bind the locked subscription");
    }

    return {
        schemaVersion: 1,
        passed: true,
        sessionId,
        target: {
            subscriptionId: subscriptionId.toLowerCase(),
            ...(tenantId ? { tenantId: tenantId.toLowerCase() } : {}),
            resourceGroup,
            region,
        },
        infraFilesScanned: infraFiles.length,
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

function writeFixture(root, stale = false) {
    const sessionId = "11111111-2222-4333-8444-555555555555";
    const subscriptionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const tenantId = "11111111-aaaa-4bbb-8ccc-222222222222";
    const resourceGroup = "rg-locked";
    const sessionPath = resolve(root, ".copilot-azure", "sessions", sessionId);
    const infraPath = resolve(root, "infra");
    mkdirSync(sessionPath, { recursive: true });
    mkdirSync(infraPath, { recursive: true });
    writeFileSync(resolve(sessionPath, "context.json"), JSON.stringify({
        sessionId,
        azure: {
            subscriptionId,
            tenantId,
            resourceGroup,
            region: "westus2",
            lockedFields: ["subscriptionId", "tenantId", "resourceGroup", "region"],
        },
    }));
    writeFileSync(resolve(sessionPath, "prepare-plan.json"), JSON.stringify({
        deploymentVariables: {
            subscriptionId,
            tenantId,
            resourceGroup,
            location: "westus2",
        },
    }));
    writeFileSync(resolve(sessionPath, "scaffold-manifest.json"), JSON.stringify({
        sessionId,
        iacFormat: "bicep",
        deployCommand: `az deployment sub create --subscription ${subscriptionId}`,
        validationResult: { status: "Validated", checks: [] },
        conformance: { passed: true, failures: [], source: "script" },
    }));
    writeFileSync(resolve(infraPath, "main.bicep"), `
targetScope = 'subscription'
resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: '${stale ? "rg-stale" : resourceGroup}'
  location: 'westus2'
}
`);
    return {
        values: new Map([
            ["--session-path", relative(root, sessionPath)],
            ["--infra-path", "infra"],
            ["--subscription", subscriptionId],
            ["--tenant", tenantId],
            ["--resource-group", resourceGroup],
            ["--region", "westus2"],
        ]),
    };
}

function runSelfTest() {
    const root = mkdtempSync(resolve(tmpdir(), "cor-deployment-artifacts-"));
    try {
        const fixture = writeFixture(root);
        const result = validate(fixture.values, root);
        if (!result.passed || result.infraFilesScanned !== 1) {
            throw new Error("Self-test failed: valid target");
        }
        writeFileSync(resolve(root, "infra", "legacy.bicep"), "var previousResourceGroup = 'rg-stale'");
        expectFailure(() => validate(fixture.values, root), "stale resource group rejection");

        const terraformRoot = resolve(root, "terraform-fixture");
        mkdirSync(terraformRoot);
        const terraformFixture = writeFixture(terraformRoot);
        const terraformSession = resolve(
            terraformRoot,
            terraformFixture.values.get("--session-path"),
        );
        const scaffold = readJsonObject(
            resolve(terraformSession, "scaffold-manifest.json"),
            "terraform scaffold fixture",
        );
        scaffold.iacFormat = "terraform";
        scaffold.deployCommand = "terraform plan -out=tfplan";
        scaffold.conformance.source = "manual";
        writeFileSync(resolve(terraformSession, "scaffold-manifest.json"), JSON.stringify(scaffold));
        rmSync(resolve(terraformRoot, "infra"), { recursive: true, force: true });
        mkdirSync(resolve(terraformRoot, "infra"));
        writeFileSync(resolve(terraformRoot, "infra", "main.tf"), `
provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}
resource "azurerm_resource_group" "main" {
  name = var.resource_group_name
  location = "westus2"
}
`);
        writeFileSync(resolve(terraformRoot, "infra", "terraform.tfvars"), `
subscription_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
resource_group_name = "rg-locked"
`);
        if (!validate(terraformFixture.values, terraformRoot).passed) {
            throw new Error("Self-test failed: Terraform target binding");
        }
        expectFailure(
            () => resolveConfinedDirectory(dirname(root), root, "test path"),
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
