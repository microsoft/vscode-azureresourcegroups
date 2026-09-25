#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from "node:child_process";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const baselineFileName = "deployment-inventory-baseline.json";
const captureFileName = "deployment-inventory-capture.json";

export function normalizeResourceId(id) {
    return id.trim().replace(/\/+$/, "").toLowerCase();
}

export function parseResourceGroupFromId(id) {
    return /\/resourceGroups\/([^/]+)/i.exec(id)?.[1];
}

export function computeDeploymentInventory(
    baseline,
    post,
    deploymentTargets,
    expectedResourceGroup,
    targetsUnavailable = false,
) {
    const baselineIds = new Set(baseline.map(normalizeResourceId));
    const targetsById = new Map();
    for (const target of deploymentTargets) {
        if (target.id) {
            targetsById.set(normalizeResourceId(target.id), target);
        }
    }

    const expected = expectedResourceGroup?.toLowerCase();
    const seen = new Set();
    const createdResources = [];
    const orphanGroups = new Map();

    for (const resource of post) {
        if (!resource.id) {
            continue;
        }
        const normalizedId = normalizeResourceId(resource.id);
        if (baselineIds.has(normalizedId) || seen.has(normalizedId)) {
            continue;
        }
        seen.add(normalizedId);

        const resourceGroup = parseResourceGroupFromId(resource.id);
        const target = targetsById.get(normalizedId);
        const provisioningState = target?.provisioningState;
        const inExpectedGroup = expected === undefined || resourceGroup?.toLowerCase() === expected;

        let classification;
        if (targetsUnavailable) {
            classification = "unverified";
        } else if (!inExpectedGroup || !target) {
            classification = "orphaned";
        } else if (provisioningState?.toLowerCase() === "succeeded") {
            classification = "expected";
        } else {
            classification = "failed";
        }

        createdResources.push({
            id: resource.id,
            ...(resource.name ? { name: resource.name } : {}),
            ...(resource.type ? { type: resource.type } : {}),
            ...(resourceGroup ? { resourceGroup } : {}),
            ...(provisioningState ? { provisioningState } : {}),
            classification,
        });

        if (resourceGroup && !inExpectedGroup && !targetsUnavailable) {
            const key = resourceGroup.toLowerCase();
            const current = orphanGroups.get(key);
            orphanGroups.set(key, {
                name: current?.name ?? resourceGroup,
                resourceCount: (current?.resourceCount ?? 0) + 1,
            });
        }
    }

    return {
        baselineCount: baselineIds.size,
        postCount: new Set(post.filter(resource => resource.id).map(resource => normalizeResourceId(resource.id))).size,
        ...(expectedResourceGroup ? { expectedResourceGroup } : {}),
        createdResources,
        orphanedResourceGroups: [...orphanGroups.values()].sort((a, b) => a.name.localeCompare(b.name)),
        hasCleanupConcerns: !targetsUnavailable
            && createdResources.some(resource => resource.classification !== "expected"),
        ...(targetsUnavailable ? { targetsUnavailable: true } : {}),
    };
}

function parseArguments(argv) {
    const allowed = new Set([
        "--self-test",
        "--phase",
        "--session-path",
        "--subscription",
        "--expected-resource-group",
        "--deployment-name",
        "--resource-group",
    ]);
    const values = new Map();
    const repeated = new Map();
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index];
        if (!token.startsWith("--")) {
            throw new Error(`Unexpected positional argument: ${token}`);
        }
        if (!allowed.has(token)) {
            throw new Error(`Unknown argument: ${token}`);
        }
        if (token === "--self-test") {
            values.set(token, "true");
            continue;
        }
        const value = argv[++index];
        if (value === undefined || value.startsWith("--")) {
            throw new Error(`Missing value for ${token}`);
        }
        if (token === "--deployment-name" || token === "--resource-group") {
            const entries = repeated.get(token) ?? [];
            entries.push(value);
            repeated.set(token, entries);
        } else if (values.has(token)) {
            throw new Error(`Duplicate argument: ${token}`);
        } else {
            values.set(token, value);
        }
    }
    return { values, repeated };
}

function requiredArgument(values, name) {
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

function validateSessionPath(input, workspaceRoot = process.cwd()) {
    const sessionPath = resolve(input);
    const sessionId = basename(sessionPath);
    if (!guidPattern.test(sessionId)
        || basename(dirname(sessionPath)).toLowerCase() !== "sessions"
        || basename(dirname(dirname(sessionPath))).toLowerCase() !== ".copilot-azure") {
        throw new Error("--session-path must be .copilot-azure/sessions/{uuid}");
    }
    if (!existsSync(sessionPath) || !statSync(sessionPath).isDirectory()) {
        throw new Error(`Session path does not exist: ${sessionPath}`);
    }
    const sessionsRoot = resolve(workspaceRoot, ".copilot-azure", "sessions");
    if (!existsSync(sessionsRoot) || !statSync(sessionsRoot).isDirectory()) {
        throw new Error("Workspace session root does not exist");
    }
    const realSessionPath = realpathSync(sessionPath);
    const realSessionsRoot = realpathSync(sessionsRoot);
    if (!pathsEqual(dirname(realSessionPath), realSessionsRoot)
        || !pathsEqual(basename(realSessionPath), sessionId)) {
        throw new Error("--session-path must be inside this workspace's .copilot-azure/sessions directory");
    }
    return { sessionPath: realSessionPath, sessionId };
}

function validateSubscriptionId(value) {
    if (!guidPattern.test(value)) {
        throw new Error("--subscription must be an Azure subscription GUID");
    }
    return value.toLowerCase();
}

function parseJsonArray(text, source) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`${source} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (!Array.isArray(parsed)) {
        throw new Error(`${source} returned a non-array JSON value`);
    }
    return parsed;
}

function findExecutableOnPath(name, environment = process.env, platform = process.platform) {
    const pathValue = environment.PATH ?? environment.Path ?? environment.path ?? "";
    const extensions = platform === "win32"
        ? (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
        : [""];
    const hasExtension = extname(name).length > 0;

    for (const rawDirectory of pathValue.split(delimiter)) {
        const directory = rawDirectory.trim().replace(/^"(.*)"$/, "$1");
        if (!directory) {
            continue;
        }
        const candidates = hasExtension
            ? [resolve(directory, name)]
            : extensions.map(extension => resolve(directory, `${name}${extension.toLowerCase()}`));
        for (const candidate of candidates) {
            if (existsSync(candidate) && statSync(candidate).isFile()) {
                return candidate;
            }
        }
    }
    return undefined;
}

function resolveAzureCli(environment = process.env, platform = process.platform) {
    const override = environment.AZURE_CLI_PATH;
    if (override) {
        if (!isAbsolute(override) || !existsSync(override) || !statSync(override).isFile()) {
            throw new Error("AZURE_CLI_PATH must name an existing absolute file");
        }
        return realpathSync(override);
    }
    const executable = findExecutableOnPath("az", environment, platform);
    if (!executable) {
        throw new Error("Azure CLI was not found on PATH");
    }
    return realpathSync(executable);
}

function quoteCmdArgument(value) {
    if (value.length === 0 || /[\0\r\n"%!&|<>^]/.test(value)) {
        throw new Error("Azure CLI argument contains characters that are unsafe for cmd.exe");
    }
    return `"${value}"`;
}

function executeAzureCli(executable, args, environment = process.env, platform = process.platform) {
    const options = {
        encoding: "utf8",
        env: environment,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
    };
    if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(executable)) {
        return spawnSync(executable, args, options);
    }

    const commandProcessor = environment.ComSpec ?? environment.COMSPEC;
    if (!commandProcessor || !isAbsolute(commandProcessor)) {
        throw new Error("ComSpec must name an absolute command processor for Azure CLI");
    }
    const commandLine = [executable, ...args].map(quoteCmdArgument).join(" ");
    return spawnSync(
        commandProcessor,
        ["/d", "/s", "/c", `"${commandLine}"`],
        { ...options, windowsVerbatimArguments: true },
    );
}

function runAz(args, allowFailure = false) {
    const executable = resolveAzureCli();
    const result = executeAzureCli(executable, args);
    if (result.error) {
        throw new Error(`Azure CLI could not run: ${result.error.message}`);
    }
    if (result.status !== 0 && !allowFailure) {
        throw new Error(`az ${args.slice(0, 4).join(" ")} failed (${result.status}): ${result.stderr.trim()}`);
    }
    return result;
}

function listResources(subscriptionId) {
    const result = runAz([
        "resource", "list",
        "--subscription", subscriptionId,
        "--query", "[].{id:id,name:name,type:type,location:location}",
        "--output", "json",
    ]);
    return parseJsonArray(result.stdout, "az resource list")
        .filter(item => item && typeof item === "object" && typeof item.id === "string")
        .map(item => ({
            id: item.id,
            ...(typeof item.name === "string" ? { name: item.name } : {}),
            ...(typeof item.type === "string" ? { type: item.type } : {}),
            ...(typeof item.location === "string" ? { location: item.location } : {}),
        }));
}

function failureReason(stderr) {
    const text = stderr.toLowerCase();
    if (text.includes("authorizationfailed") || text.includes("forbidden") || text.includes("(403)")) {
        return "forbidden";
    }
    if (text.includes("toomanyrequests") || text.includes("throttl") || text.includes("(429)")) {
        return "throttled";
    }
    return "error";
}

function isMissingDeployment(stderr) {
    return /deploymentnotfound|resourcenotfound|could not be found|\(404\)/i.test(stderr);
}

function collectDeploymentTargets(subscriptionId, deploymentNames, resourceGroups) {
    const targetsById = new Map();
    let unavailable;

    for (const deploymentName of deploymentNames) {
        let readAnyScope = false;
        let scopeFailure;
        const scopes = [
            ["deployment", "operation", "sub", "list", "--name", deploymentName],
            ...resourceGroups.map(resourceGroup => [
                "deployment", "operation", "group", "list",
                "--name", deploymentName,
                "--resource-group", resourceGroup,
            ]),
        ];

        for (const scopeArgs of scopes) {
            const result = runAz([...scopeArgs, "--subscription", subscriptionId, "--output", "json"], true);
            if (result.status !== 0) {
                if (!isMissingDeployment(result.stderr)) {
                    const reason = failureReason(result.stderr);
                    if (scopeFailure === undefined || reason === "forbidden") {
                        scopeFailure = reason;
                    }
                }
                continue;
            }

            readAnyScope = true;
            const operations = parseJsonArray(result.stdout, `az ${scopeArgs.join(" ")}`);
            for (const operation of operations) {
                const properties = operation && typeof operation === "object" ? operation.properties : undefined;
                const targetResource = properties && typeof properties === "object"
                    ? properties.targetResource
                    : undefined;
                const id = targetResource && typeof targetResource === "object"
                    ? targetResource.id
                    : undefined;
                if (typeof id !== "string" || !id) {
                    continue;
                }
                const provisioningState = typeof properties.provisioningState === "string"
                    ? properties.provisioningState
                    : undefined;
                const normalized = normalizeResourceId(id);
                if (!targetsById.has(normalized) || provisioningState?.toLowerCase() === "succeeded") {
                    targetsById.set(normalized, {
                        id,
                        ...(provisioningState ? { provisioningState } : {}),
                    });
                }
            }
        }

        if (!readAnyScope && scopeFailure && (unavailable === undefined || scopeFailure === "forbidden")) {
            unavailable = scopeFailure;
        }
    }

    return {
        targets: [...targetsById.values()],
        ...(unavailable ? { unavailable } : {}),
    };
}

function writeJsonAtomic(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        renameSync(tempPath, filePath);
    } finally {
        if (existsSync(tempPath)) {
            rmSync(tempPath, { force: true });
        }
    }
}

function readBaseline(filePath, sessionId, subscriptionId) {
    if (statSync(filePath).size > 64 * 1024 * 1024) {
        throw new Error("Inventory baseline exceeds the 64 MiB safety limit");
    }
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new Error(`Inventory baseline is unreadable: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (!parsed || typeof parsed !== "object"
        || parsed.schemaVersion !== 1
        || parsed.inventorySource !== "portable-cli"
        || parsed.phase !== "baseline"
        || parsed.sessionId !== sessionId
        || typeof parsed.subscriptionId !== "string"
        || parsed.subscriptionId.toLowerCase() !== subscriptionId
        || !Array.isArray(parsed.resourceIds)
        || parsed.resourceIds.length > 1_000_000
        || parsed.resourceIds.some(id => typeof id !== "string"
            || !normalizeResourceId(id).startsWith(`/subscriptions/${subscriptionId}/`))) {
        throw new Error("Inventory baseline failed schema/session/subscription validation");
    }
    return parsed.resourceIds;
}

function captureBaseline(sessionPath, sessionId, subscriptionId) {
    const resources = listResources(subscriptionId);
    const seen = new Set();
    const resourceIds = [];
    for (const resource of resources) {
        const normalized = normalizeResourceId(resource.id);
        if (!seen.has(normalized)) {
            seen.add(normalized);
            resourceIds.push(resource.id);
        }
    }
    const baselinePath = resolve(sessionPath, baselineFileName);
    const output = {
        schemaVersion: 1,
        inventorySource: "portable-cli",
        phase: "baseline",
        sessionId,
        subscriptionId,
        capturedUtc: new Date().toISOString(),
        resourceIds,
    };
    writeJsonAtomic(baselinePath, output);
    return {
        inventorySource: "portable-cli",
        phase: "baseline",
        baselineCount: resourceIds.length,
        baselinePath: baselineFileName,
    };
}

function captureAfterDeployment(
    sessionPath,
    sessionId,
    subscriptionId,
    expectedResourceGroup,
    deploymentNames,
    resourceGroups,
) {
    const baselinePath = resolve(sessionPath, baselineFileName);
    const baseline = existsSync(baselinePath)
        ? readBaseline(baselinePath, sessionId, subscriptionId)
        : undefined;
    const post = listResources(subscriptionId);
    const collected = collectDeploymentTargets(subscriptionId, deploymentNames, resourceGroups);
    const unavailable = collected.unavailable !== undefined;

    let inventoryPost = post;
    if (!baseline) {
        const targetIds = new Set(collected.targets.map(target => normalizeResourceId(target.id)));
        inventoryPost = post.filter(resource => targetIds.has(normalizeResourceId(resource.id)));
    }

    const computed = computeDeploymentInventory(
        baseline ?? [],
        inventoryPost,
        collected.targets,
        expectedResourceGroup,
        unavailable,
    );
    const output = {
        schemaVersion: 1,
        inventorySource: "portable-cli",
        phase: "capture",
        sessionId,
        subscriptionId,
        capturedUtc: new Date().toISOString(),
        baselineAvailable: baseline !== undefined,
        deploymentNames,
        resourceGroups,
        ...computed,
        ...(collected.unavailable ? {
            inventoryUnverified: true,
            inventoryUnverifiedReason: collected.unavailable,
            targetsUnavailableReason: collected.unavailable,
        } : {}),
    };
    const capturePath = resolve(sessionPath, captureFileName);
    writeJsonAtomic(capturePath, output);
    return { ...output, capturePath: captureFileName };
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

function runSelfTest() {
    const result = computeDeploymentInventory(
        ["/subscriptions/s/resourceGroups/rg-main/providers/Microsoft.X/old/a"],
        [
            { id: "/subscriptions/s/resourceGroups/rg-main/providers/Microsoft.X/old/a" },
            { id: "/subscriptions/s/resourceGroups/rg-main/providers/Microsoft.X/new/b" },
            { id: "/subscriptions/s/resourceGroups/rg-other/providers/Microsoft.X/new/c" },
        ],
        [
            {
                id: "/subscriptions/s/resourceGroups/rg-main/providers/Microsoft.X/new/b",
                provisioningState: "Succeeded",
            },
        ],
        "rg-main",
    );
    assert(result.createdResources.length === 2, "created resource diff");
    assert(result.createdResources[0].classification === "expected", "expected target classification");
    assert(result.createdResources[1].classification === "orphaned", "out-of-scope classification");
    assert(result.orphanedResourceGroups[0]?.name === "rg-other", "orphan group summary");

    const unavailable = computeDeploymentInventory(
        [],
        [{ id: "/subscriptions/s/resourceGroups/rg-main/providers/Microsoft.X/new/b" }],
        [],
        "rg-main",
        true,
    );
    assert(unavailable.createdResources[0].classification === "unverified", "unavailable attribution");
    assert(unavailable.hasCleanupConcerns === false, "unverified inventory never suggests cleanup");
    assert(unavailable.orphanedResourceGroups.length === 0, "unverified inventory has no orphan group");

    const root = mkdtempSync(resolve(tmpdir(), "cor-inventory-"));
    try {
        const sessionId = "11111111-2222-4333-8444-555555555555";
        const subscriptionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
        const sessionPath = resolve(root, ".copilot-azure", "sessions", sessionId);
        mkdirSync(sessionPath, { recursive: true });
        assert(validateSessionPath(sessionPath, root).sessionId === sessionId, "session path validation");
        const outsideSessionPath = resolve(root, "outside", ".copilot-azure", "sessions", sessionId);
        mkdirSync(outsideSessionPath, { recursive: true });
        expectFailure(
            () => validateSessionPath(outsideSessionPath, root),
            "workspace path confinement",
        );
        const baselinePath = resolve(sessionPath, baselineFileName);
        writeJsonAtomic(baselinePath, {
            schemaVersion: 1,
            inventorySource: "portable-cli",
            phase: "baseline",
            sessionId,
            subscriptionId,
            resourceIds: [`/subscriptions/${subscriptionId}/resourceGroups/rg/providers/Microsoft.X/y/z`],
        });
        assert(
            readBaseline(baselinePath, sessionId, subscriptionId).length === 1,
            "baseline schema validation",
        );
        assert(
            !readdirSync(sessionPath).some(file => file.endsWith(".tmp")),
            "atomic write temporary-file cleanup",
        );
        writeJsonAtomic(baselinePath, []);
        expectFailure(
            () => readBaseline(baselinePath, sessionId, subscriptionId),
            "non-object baseline rejection",
        );
        writeJsonAtomic(baselinePath, {
            schemaVersion: 1,
            inventorySource: "portable-cli",
            phase: "baseline",
            sessionId,
            subscriptionId,
            resourceIds: [42],
        });
        expectFailure(
            () => readBaseline(baselinePath, sessionId, subscriptionId),
            "wrong resource ID type rejection",
        );
        writeJsonAtomic(baselinePath, {
            schemaVersion: 1,
            inventorySource: "portable-cli",
            phase: "baseline",
            sessionId,
            subscriptionId,
            resourceIds: ["/subscriptions/ffffffff-ffff-4fff-8fff-ffffffffffff/resourceGroups/rg/providers/Microsoft.X/y/z"],
        });
        expectFailure(
            () => readBaseline(baselinePath, sessionId, subscriptionId),
            "cross-subscription baseline rejection",
        );

        const fakeCliDirectory = resolve(root, "fake-cli");
        mkdirSync(fakeCliDirectory);
        const fakeCliScript = resolve(fakeCliDirectory, "fake-az.mjs");
        writeFileSync(
            fakeCliScript,
            "console.log(JSON.stringify(process.argv.slice(2)));\n",
        );
        const fakeCli = process.platform === "win32"
            ? resolve(fakeCliDirectory, "az.cmd")
            : resolve(fakeCliDirectory, "az");
        if (process.platform === "win32") {
            writeFileSync(fakeCli, `@echo off\r\nnode "%~dp0fake-az.mjs" %*\r\n`);
        } else {
            writeFileSync(fakeCli, `#!/usr/bin/env node\n${readFileSync(fakeCliScript, "utf8")}`);
            chmodSync(fakeCli, 0o755);
        }
        const environment = {
            ...process.env,
            PATH: `${fakeCliDirectory}${delimiter}${process.env.PATH ?? ""}`,
        };
        const resolvedCli = resolveAzureCli(environment);
        assert(pathsEqual(resolvedCli, realpathSync(fakeCli)), "Azure CLI PATH resolution");
        const fakeResult = executeAzureCli(
            resolvedCli,
            ["resource", "list", "--query", "[].{id:id,name:name}"],
            environment,
        );
        assert(fakeResult.status === 0, "cross-platform Azure CLI launch");
        assert(
            JSON.parse(fakeResult.stdout).at(-1) === "[].{id:id,name:name}",
            "Azure CLI argument preservation",
        );
        if (process.platform === "win32") {
            expectFailure(
                () => executeAzureCli(resolvedCli, ["resource", "list", "unsafe&value"], environment),
                "cmd.exe metacharacter rejection",
            );
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }

    return { passed: true };
}

async function main() {
    const { values, repeated } = parseArguments(process.argv.slice(2));
    if (values.has("--self-test")) {
        console.log(JSON.stringify(runSelfTest()));
        return;
    }

    const phase = requiredArgument(values, "--phase");
    if (phase !== "baseline" && phase !== "capture") {
        throw new Error("--phase must be baseline or capture");
    }
    const { sessionPath, sessionId } = validateSessionPath(requiredArgument(values, "--session-path"));
    const subscriptionId = validateSubscriptionId(requiredArgument(values, "--subscription"));

    const output = phase === "baseline"
        ? captureBaseline(sessionPath, sessionId, subscriptionId)
        : captureAfterDeployment(
            sessionPath,
            sessionId,
            subscriptionId,
            values.get("--expected-resource-group"),
            repeated.get("--deployment-name") ?? [],
            repeated.get("--resource-group") ?? [],
        );
    console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
