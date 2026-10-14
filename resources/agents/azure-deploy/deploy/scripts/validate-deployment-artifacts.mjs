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
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sessionFileLimit = 4 * 1024 * 1024;
const infraFileLimit = 4 * 1024 * 1024;
const infraTotalLimit = 64 * 1024 * 1024;
const infraFileCountLimit = 5_000;
const textExtensions = new Set([".bicep", ".json", ".tf", ".tfvars"]);
const componentValidators = new Set([
    "build-or-syntax",
    "tests-or-no-tests-proof",
    "package-integrity",
    "node-runtime-contracts",
    "postgres-managed-identity",
    "migration-controller",
    "functions-flex-package",
    "container-image",
    "correlation",
]);
const baseComponentValidators = [
    "build-or-syntax",
    "tests-or-no-tests-proof",
    "package-integrity",
];

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

function array(value, label) {
    if (!Array.isArray(value)) {
        throw new Error(`${label} must be an array`);
    }
    return value;
}

function exact(value, expected, label) {
    if (value !== expected) {
        throw new Error(`${label} must be ${JSON.stringify(expected)}`);
    }
}

function exactKeys(value, expectedKeys, label) {
    const actualKeys = Object.keys(value).sort();
    const sortedExpected = [...expectedKeys].sort();
    if (actualKeys.length !== sortedExpected.length
        || actualKeys.some((key, index) => key !== sortedExpected[index])) {
        throw new Error(`${label} must contain exactly: ${sortedExpected.join(", ")}`);
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

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
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

function normalizedComponentPath(input, workspaceRoot, label) {
    const componentPath = resolveConfinedDirectory(input, workspaceRoot, label);
    return relative(realpathSync(workspaceRoot), componentPath).replaceAll("\\", "/") || ".";
}

function deploymentRequiresMigration(prepare, prereq) {
    if (typeof prepare.appDbName === "string" && prepare.appDbName.length > 0) {
        return true;
    }
    const initCommands = Array.isArray(prereq.initCommands) ? prereq.initCommands : [];
    if (initCommands.some(command =>
        command && typeof command === "object" && !Array.isArray(command)
        && command.required === true
        && typeof command.type === "string"
        && /\b(db-)?migrat(?:e|ion)\b/i.test(command.type))) {
        return true;
    }
    const services = Array.isArray(prepare.services) ? prepare.services : [];
    return services.some(service => {
        if (!service || typeof service !== "object" || Array.isArray(service)) {
            return false;
        }
        const text = [service.name, service.purpose, service.component]
            .filter(value => typeof value === "string")
            .join(" ");
        return /\b(postgresql|postgres|mysql|azure sql|sql server|relational)\b/i.test(text);
    });
}

function deploymentUsesPostgres(prepare) {
    const services = Array.isArray(prepare.services) ? prepare.services : [];
    return services.some(service => {
        if (!service || typeof service !== "object" || Array.isArray(service)) {
            return false;
        }
        const text = [service.name, service.purpose, service.component]
            .filter(value => typeof value === "string")
            .join(" ");
        return /\b(postgresql|postgres)\b/i.test(text);
    });
}

function deploymentUsesFlexFunctions(prepare) {
    const services = Array.isArray(prepare.services) ? prepare.services : [];
    return services.some(service => {
        if (!service || typeof service !== "object" || Array.isArray(service)) {
            return false;
        }
        const text = [service.name, service.sku, service.purpose]
            .filter(value => typeof value === "string")
            .join(" ");
        return /\b(function|function app|functions)\b/i.test(text)
            && /\b(flex|flex consumption|fc1)\b/i.test(text);
    });
}

function deploymentUsesContainerApps(prepare) {
    const services = Array.isArray(prepare.services) ? prepare.services : [];
    return services.some(service => {
        if (!service || typeof service !== "object" || Array.isArray(service)) {
            return false;
        }
        const text = [service.name, service.purpose]
            .filter(value => typeof value === "string")
            .join(" ");
        return /\bcontainer apps?\b/i.test(text);
    });
}

function componentLooksLikeApi(component) {
    const stack = component.stack && typeof component.stack === "object" && !Array.isArray(component.stack)
        ? component.stack
        : {};
    const text = [component.name, component.path, stack.language, stack.framework]
        .filter(value => typeof value === "string")
        .join(" ");
    return /\b(api|backend|function|express|fastify|nestjs|koa|hapi|fastapi|flask|django|rails|asp\.?net|spring)\b/i.test(text);
}

function deploymentRequiresCorrelation(context, prepare) {
    const components = Array.isArray(context.components) ? context.components : [];
    if (components.some(component =>
        component && typeof component === "object" && !Array.isArray(component)
        && componentLooksLikeApi(component))) {
        return true;
    }
    const services = Array.isArray(prepare.services) ? prepare.services : [];
    return services.some(service => {
        if (!service || typeof service !== "object" || Array.isArray(service)) {
            return false;
        }
        const text = [service.name, service.purpose, service.component]
            .filter(value => typeof value === "string")
            .join(" ");
        return /\b(api|backend|function)\b/i.test(text);
    });
}

function validateDeploymentContract(scaffold, context, prereq, prepare, expected, workspaceRoot) {
    exact(scaffold.schemaVersion, 2, "scaffold-manifest.json.schemaVersion");
    const contract = object(
        scaffold.deploymentContract,
        "scaffold-manifest.json.deploymentContract",
    );
    exactKeys(
        contract,
        ["schemaVersion", "target", "components", "validators", "acceptance", "recoveryPolicy"],
        "scaffold-manifest.json.deploymentContract",
    );
    exact(contract.schemaVersion, 1, "deploymentContract.schemaVersion");

    const target = object(contract.target, "deploymentContract.target");
    exactKeys(
        target,
        ["subscriptionId", ...(expected.tenantId ? ["tenantId"] : []), "resourceGroup", "region"],
        "deploymentContract.target",
    );
    equal(string(target.subscriptionId, "deploymentContract.target.subscriptionId"),
        expected.subscriptionId, "deployment contract subscription");
    equal(string(target.resourceGroup, "deploymentContract.target.resourceGroup"),
        expected.resourceGroup, "deployment contract resource group");
    equal(string(target.region, "deploymentContract.target.region"),
        expected.region, "deployment contract region");
    if (expected.tenantId) {
        equal(string(target.tenantId, "deploymentContract.target.tenantId"),
            expected.tenantId, "deployment contract tenant");
    }

    const contextComponents = array(context.components, "context.json.components");
    if (contextComponents.length === 0) {
        throw new Error("context.json.components must contain at least one deployable component");
    }
    const expectedComponents = new Map();
    for (const [index, value] of contextComponents.entries()) {
        const component = object(value, `context.json.components[${index}]`);
        const stack = object(component.stack, `context.json.components[${index}].stack`);
        const path = normalizedComponentPath(
            string(component.path, `context.json.components[${index}].path`),
            workspaceRoot,
            `context.json.components[${index}].path`,
        );
        if (expectedComponents.has(path)) {
            throw new Error(`context.json.components contains duplicate path: ${path}`);
        }
        expectedComponents.set(path, {
            name: string(component.name, `context.json.components[${index}].name`),
            language: string(stack.language, `context.json.components[${index}].stack.language`),
            api: componentLooksLikeApi(component),
        });
    }

    const contractComponents = array(contract.components, "deploymentContract.components");
    if (contractComponents.length !== expectedComponents.size) {
        throw new Error("deploymentContract.components must cover every context.json component exactly once");
    }
    const seenComponents = new Set();
    const declaredValidators = new Set();
    let nodeApiComponentDeclared = false;
    let correlationValidatorOnApi = false;
    let postgresValidatorOnNodeApi = false;
    for (const [index, value] of contractComponents.entries()) {
        const component = object(value, `deploymentContract.components[${index}]`);
        exactKeys(
            component,
            ["name", "path", "language", "requiredValidators"],
            `deploymentContract.components[${index}]`,
        );
        const path = normalizedComponentPath(
            string(component.path, `deploymentContract.components[${index}].path`),
            workspaceRoot,
            `deploymentContract.components[${index}].path`,
        );
        if (seenComponents.has(path)) {
            throw new Error(`deploymentContract.components contains duplicate path: ${path}`);
        }
        seenComponents.add(path);
        const expectedComponent = expectedComponents.get(path);
        if (!expectedComponent) {
            throw new Error(`deploymentContract.components contains unknown path: ${path}`);
        }
        exact(string(component.name, `deploymentContract.components[${index}].name`),
            expectedComponent.name, `deploymentContract.components[${index}].name`);
        exact(string(component.language, `deploymentContract.components[${index}].language`),
            expectedComponent.language, `deploymentContract.components[${index}].language`);
        const requiredValidators = array(
            component.requiredValidators,
            `deploymentContract.components[${index}].requiredValidators`,
        );
        const seenValidators = new Set();
        for (const [validatorIndex, value] of requiredValidators.entries()) {
            const validator = string(
                value,
                `deploymentContract.components[${index}].requiredValidators[${validatorIndex}]`,
            );
            if (!componentValidators.has(validator) || seenValidators.has(validator)) {
                throw new Error(`deploymentContract component ${path} has an invalid or duplicate validator: ${validator}`);
            }
            seenValidators.add(validator);
            declaredValidators.add(validator);
        }
        for (const validator of baseComponentValidators) {
            if (!seenValidators.has(validator)) {
                throw new Error(`deploymentContract component ${path} is missing required validator: ${validator}`);
            }
        }
        if (/\b(java|type)script\b/i.test(expectedComponent.language)) {
            if (!seenValidators.has("node-runtime-contracts")) {
                throw new Error(`deploymentContract component ${path} must require node-runtime-contracts`);
            }
            if (expectedComponent.api) {
                nodeApiComponentDeclared = true;
                postgresValidatorOnNodeApi ||= seenValidators.has("postgres-managed-identity");
            }
        }
        correlationValidatorOnApi ||= expectedComponent.api && seenValidators.has("correlation");
    }

    const validators = object(contract.validators, "deploymentContract.validators");
    const validatorNames = [
        "artifactTargetBinding",
        "iacConformance",
        "componentBuild",
        "componentTests",
        "runtimeContracts",
        "packageIntegrity",
        "whatIf",
        "inventoryBaseline",
    ];
    exactKeys(validators, validatorNames, "deploymentContract.validators");
    for (const name of validatorNames) {
        exact(validators[name], true, `deploymentContract.validators.${name}`);
    }

    const acceptance = object(contract.acceptance, "deploymentContract.acceptance");
    exactKeys(
        acceptance,
        [
            "infrastructure",
            "codeDeployment",
            "migration",
            "applicationHealth",
            "dependencyAccess",
            "correlation",
        ],
        "deploymentContract.acceptance",
    );
    for (const name of [
        "infrastructure",
        "codeDeployment",
        "applicationHealth",
        "dependencyAccess",
    ]) {
        exact(acceptance[name], true, `deploymentContract.acceptance.${name}`);
    }
    if (acceptance.migration !== "required" && acceptance.migration !== "not-applicable") {
        throw new Error("deploymentContract.acceptance.migration must be required or not-applicable");
    }
    if (acceptance.correlation !== "required" && acceptance.correlation !== "not-applicable") {
        throw new Error("deploymentContract.acceptance.correlation must be required or not-applicable");
    }
    if (deploymentRequiresMigration(prepare, prereq) && acceptance.migration !== "required") {
        throw new Error("deploymentContract.acceptance.migration must be required for relational workloads");
    }
    if (deploymentRequiresCorrelation(context, prepare) && acceptance.correlation !== "required") {
        throw new Error("deploymentContract.acceptance.correlation must be required for API workloads");
    }
    if (acceptance.migration === "required" && !declaredValidators.has("migration-controller")) {
        throw new Error("deploymentContract must assign migration-controller to a component");
    }
    if (acceptance.correlation === "required" && !correlationValidatorOnApi) {
        throw new Error("deploymentContract must assign correlation to an API component");
    }
    if (deploymentUsesFlexFunctions(prepare) && !declaredValidators.has("functions-flex-package")) {
        throw new Error("deploymentContract must assign functions-flex-package for Flex Functions");
    }
    if (deploymentUsesContainerApps(prepare) && !declaredValidators.has("container-image")) {
        throw new Error("deploymentContract must assign container-image for Container Apps");
    }
    if (nodeApiComponentDeclared
        && deploymentUsesPostgres(prepare)
        && !postgresValidatorOnNodeApi) {
        throw new Error("deploymentContract must assign postgres-managed-identity to the Node API component");
    }

    const recoveryPolicy = object(contract.recoveryPolicy, "deploymentContract.recoveryPolicy");
    exactKeys(
        recoveryPolicy,
        [
            "maxAttempts",
            "unchangedRetry",
            "requireFailureFingerprint",
            "requireEvidencePaths",
            "requireChangedInputsForNonTransient",
        ],
        "deploymentContract.recoveryPolicy",
    );
    exact(recoveryPolicy.maxAttempts, 3, "deploymentContract.recoveryPolicy.maxAttempts");
    exact(recoveryPolicy.unchangedRetry, "proven-transient-only",
        "deploymentContract.recoveryPolicy.unchangedRetry");
    for (const name of [
        "requireFailureFingerprint",
        "requireEvidencePaths",
        "requireChangedInputsForNonTransient",
    ]) {
        exact(recoveryPolicy[name], true, `deploymentContract.recoveryPolicy.${name}`);
    }

    return {
        scaffoldSchemaVersion: 2,
        contractSchemaVersion: 1,
        sha256: jsonSha256(contract),
        componentCount: contractComponents.length,
        migration: acceptance.migration,
        correlation: acceptance.correlation,
        maxRecoveryAttempts: recoveryPolicy.maxAttempts,
    };
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
    const prereq = readJsonObject(resolve(sessionPath, "prereq-output.json"), "prereq-output.json");
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
    equal(
        string(deploymentVariables.sessionId, "deploymentVariables.sessionId"),
        sessionId,
        "prepare-plan session",
    );
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
    const deploymentContract = validateDeploymentContract(
        scaffold,
        context,
        prereq,
        prepare,
        expected,
        workspaceRoot,
    );
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
        schemaVersion: 2,
        passed: true,
        sessionId,
        target: {
            subscriptionId: subscriptionId.toLowerCase(),
            ...(tenantId ? { tenantId: tenantId.toLowerCase() } : {}),
            resourceGroup,
            region,
        },
        deploymentContract,
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
    const appPath = resolve(root, "app");
    mkdirSync(sessionPath, { recursive: true });
    mkdirSync(infraPath, { recursive: true });
    mkdirSync(appPath, { recursive: true });
    writeFileSync(resolve(appPath, "package.json"), JSON.stringify({
        name: "contract-fixture",
        scripts: { build: "echo build", test: "echo test" },
    }));
    writeFileSync(resolve(sessionPath, "context.json"), JSON.stringify({
        sessionId,
        components: [{
            name: "api",
            path: "app",
            stack: {
                language: "TypeScript",
                framework: "Express",
                version: "1",
            },
        }],
        azure: {
            subscriptionId,
            tenantId,
            resourceGroup,
            region: "westus2",
            lockedFields: ["subscriptionId", "tenantId", "resourceGroup", "region"],
        },
    }));
    writeFileSync(resolve(sessionPath, "prepare-plan.json"), JSON.stringify({
        services: [{
            name: "Azure Container Apps API",
            purpose: "backend API",
            component: "api",
        }],
        deploymentVariables: {
            subscriptionId,
            tenantId,
            resourceGroup,
            location: "westus2",
            sessionId,
        },
    }));
    writeFileSync(resolve(sessionPath, "prereq-output.json"), JSON.stringify({
        initCommands: [],
    }));
    writeFileSync(resolve(sessionPath, "scaffold-manifest.json"), JSON.stringify({
        schemaVersion: 2,
        sessionId,
        iacFormat: "bicep",
        deployCommand: `az deployment sub create --subscription ${subscriptionId}`,
        validationResult: { status: "Validated", checks: [] },
        conformance: { passed: true, failures: [], source: "script" },
        deploymentContract: {
            schemaVersion: 1,
            target: {
                subscriptionId,
                tenantId,
                resourceGroup,
                region: "westus2",
            },
            components: [{
                name: "api",
                path: "app",
                language: "TypeScript",
                requiredValidators: [
                    "build-or-syntax",
                    "tests-or-no-tests-proof",
                    "package-integrity",
                    "node-runtime-contracts",
                    "container-image",
                    "correlation",
                ],
            }],
            validators: {
                artifactTargetBinding: true,
                iacConformance: true,
                componentBuild: true,
                componentTests: true,
                runtimeContracts: true,
                packageIntegrity: true,
                whatIf: true,
                inventoryBaseline: true,
            },
            acceptance: {
                infrastructure: true,
                codeDeployment: true,
                migration: "not-applicable",
                applicationHealth: true,
                dependencyAccess: true,
                correlation: "required",
            },
            recoveryPolicy: {
                maxAttempts: 3,
                unchangedRetry: "proven-transient-only",
                requireFailureFingerprint: true,
                requireEvidencePaths: true,
                requireChangedInputsForNonTransient: true,
            },
        },
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
        if (!result.passed
            || result.schemaVersion !== 2
            || result.deploymentContract.contractSchemaVersion !== 1
            || !/^[0-9a-f]{64}$/.test(result.deploymentContract.sha256)
            || result.infraFilesScanned !== 1) {
            throw new Error("Self-test failed: valid target");
        }

        const sessionPath = resolve(root, fixture.values.get("--session-path"));
        const scaffoldPath = resolve(sessionPath, "scaffold-manifest.json");
        const originalScaffold = readJsonObject(scaffoldPath, "scaffold self-test fixture");

        const missingVersion = cloneJson(originalScaffold);
        delete missingVersion.schemaVersion;
        writeFileSync(scaffoldPath, JSON.stringify(missingVersion));
        expectFailure(() => validate(fixture.values, root), "missing scaffold contract version");

        const mismatchedTarget = cloneJson(originalScaffold);
        mismatchedTarget.deploymentContract.target.resourceGroup = "rg-other";
        writeFileSync(scaffoldPath, JSON.stringify(mismatchedTarget));
        expectFailure(() => validate(fixture.values, root), "deployment contract target mismatch");

        const missingComponent = cloneJson(originalScaffold);
        missingComponent.deploymentContract.components = [];
        writeFileSync(scaffoldPath, JSON.stringify(missingComponent));
        expectFailure(() => validate(fixture.values, root), "deployment contract component coverage");

        const disabledValidator = cloneJson(originalScaffold);
        disabledValidator.deploymentContract.validators.whatIf = false;
        writeFileSync(scaffoldPath, JSON.stringify(disabledValidator));
        expectFailure(() => validate(fixture.values, root), "disabled required validator");

        const missingRuntimeValidator = cloneJson(originalScaffold);
        missingRuntimeValidator.deploymentContract.components[0].requiredValidators =
            missingRuntimeValidator.deploymentContract.components[0].requiredValidators
                .filter(validator => validator !== "node-runtime-contracts");
        writeFileSync(scaffoldPath, JSON.stringify(missingRuntimeValidator));
        expectFailure(() => validate(fixture.values, root), "missing stack runtime validator");

        const missingAcceptanceValidator = cloneJson(originalScaffold);
        missingAcceptanceValidator.deploymentContract.components[0].requiredValidators =
            missingAcceptanceValidator.deploymentContract.components[0].requiredValidators
                .filter(validator => validator !== "correlation");
        writeFileSync(scaffoldPath, JSON.stringify(missingAcceptanceValidator));
        expectFailure(() => validate(fixture.values, root), "missing acceptance validator");

        const unsafePath = cloneJson(originalScaffold);
        unsafePath.deploymentContract.components[0].path = "..";
        writeFileSync(scaffoldPath, JSON.stringify(unsafePath));
        expectFailure(() => validate(fixture.values, root), "unsafe component path");

        writeFileSync(scaffoldPath, JSON.stringify(originalScaffold));
        const preparePath = resolve(sessionPath, "prepare-plan.json");
        const originalPrepare = readJsonObject(preparePath, "prepare self-test fixture");
        const relationalPrepare = cloneJson(originalPrepare);
        relationalPrepare.appDbName = "appdb";
        writeFileSync(preparePath, JSON.stringify(relationalPrepare));
        expectFailure(() => validate(fixture.values, root), "missing migration acceptance");
        writeFileSync(preparePath, JSON.stringify(originalPrepare));

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
