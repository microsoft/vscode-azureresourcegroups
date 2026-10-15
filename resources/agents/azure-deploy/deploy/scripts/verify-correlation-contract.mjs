#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const correlationHeader = "x-correlation-id";
const validCorrelationId = /^[A-Za-z0-9._:-]{1,128}$/;

function parseArguments(argv) {
    const allowed = new Set(["--self-test", "--success-url", "--error-url", "--origin", "--timeout-ms"]);
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

function validateUrl(value, label) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${label} must be an absolute URL`);
    }
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
        throw new Error(`${label} must use HTTPS (HTTP is allowed only for localhost self-tests)`);
    }
    return url.toString();
}

function requireCorrelationHeader(response, expected, label) {
    const actual = response.headers.get(correlationHeader);
    if (!actual) {
        throw new Error(`${label} omitted X-Correlation-ID`);
    }
    if (expected !== undefined && actual !== expected) {
        throw new Error(`${label} did not preserve the accepted correlation ID`);
    }
    if (!validCorrelationId.test(actual)) {
        throw new Error(`${label} returned an invalid correlation ID`);
    }
    return actual;
}

function requireCorsExposure(response, origin, label) {
    if (!origin) {
        return;
    }
    const allowOrigin = response.headers.get("access-control-allow-origin");
    if (allowOrigin !== origin) {
        throw new Error(`${label} did not allow the exact configured origin`);
    }
    const exposed = (response.headers.get("access-control-expose-headers") ?? "")
        .split(",")
        .map(value => value.trim().toLowerCase());
    if (!exposed.includes(correlationHeader)) {
        throw new Error(`${label} did not expose X-Correlation-ID through CORS`);
    }
}

async function request(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal, redirect: "error" });
    } catch (error) {
        throw new Error(`Correlation probe failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    } finally {
        clearTimeout(timer);
    }
}

export async function verifyCorrelationContract({
    successUrl,
    errorUrl,
    origin,
    timeoutMs = 30_000,
}) {
    const acceptedId = `cor-contract-${randomUUID()}`;
    const commonHeaders = origin ? { origin } : {};
    const accepted = await request(successUrl, {
        headers: { ...commonHeaders, [correlationHeader]: acceptedId },
    }, timeoutMs);
    if (!accepted.ok) {
        throw new Error(`Success probe returned HTTP ${accepted.status}`);
    }
    requireCorrelationHeader(accepted, acceptedId, "Success response");
    requireCorsExposure(accepted, origin, "Success response");

    const generated = await request(successUrl, { headers: commonHeaders }, timeoutMs);
    if (!generated.ok) {
        throw new Error(`Generated-ID probe returned HTTP ${generated.status}`);
    }
    const generatedId = requireCorrelationHeader(generated, undefined, "Generated-ID response");
    requireCorsExposure(generated, origin, "Generated-ID response");

    const invalidId = "x".repeat(160);
    const invalid = await request(successUrl, {
        headers: { ...commonHeaders, [correlationHeader]: invalidId },
    }, timeoutMs);
    if (!invalid.ok) {
        throw new Error(`Invalid-ID probe returned HTTP ${invalid.status}`);
    }
    const replacementId = requireCorrelationHeader(invalid, undefined, "Invalid-ID response");
    if (replacementId === invalidId) {
        throw new Error("Invalid incoming correlation ID was preserved instead of replaced");
    }
    requireCorsExposure(invalid, origin, "Invalid-ID response");

    const errorId = `cor-error-${randomUUID()}`;
    const invalidRequest = await request(errorUrl, {
        method: "POST",
        headers: {
            ...commonHeaders,
            [correlationHeader]: errorId,
            "content-type": "application/json",
        },
        body: "{}",
    }, timeoutMs);
    if (invalidRequest.status < 400 || invalidRequest.status >= 500) {
        throw new Error(`Validation-error probe must return 4xx; received HTTP ${invalidRequest.status}`);
    }
    requireCorrelationHeader(invalidRequest, errorId, "Validation-error response");
    requireCorsExposure(invalidRequest, origin, "Validation-error response");
    let errorBody;
    try {
        errorBody = await invalidRequest.json();
    } catch {
        throw new Error("Validation-error response was not JSON");
    }
    if (!errorBody || typeof errorBody !== "object"
        || !errorBody.error || typeof errorBody.error !== "object"
        || typeof errorBody.error.code !== "string"
        || typeof errorBody.error.message !== "string") {
        throw new Error("Validation-error response did not match the structured error contract");
    }

    return {
        passed: true,
        header: "X-Correlation-ID",
        acceptedIncomingId: true,
        generatedId,
        replacedInvalidId: true,
        successStatus: accepted.status,
        validationErrorStatus: invalidRequest.status,
        corsOrigin: origin,
        corsExposed: origin ? true : undefined,
    };
}

async function runSelfTest() {
    const origin = "https://frontend.example.test";
    const server = createServer((request, response) => {
        const incoming = request.headers[correlationHeader];
        const correlationId = typeof incoming === "string" && validCorrelationId.test(incoming)
            ? incoming
            : randomUUID();
        response.setHeader("x-correlation-id", correlationId);
        response.setHeader("access-control-allow-origin", origin);
        response.setHeader("access-control-expose-headers", "X-Correlation-ID");
        response.setHeader("content-type", "application/json");
        if (request.method === "POST") {
            response.statusCode = 422;
            response.end(JSON.stringify({ error: { code: "INVALID_INPUT", message: "Invalid input" } }));
        } else {
            response.statusCode = 200;
            response.end(JSON.stringify({ status: "healthy" }));
        }
    });
    await new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolvePromise);
    });
    try {
        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("Self-test server did not expose a TCP address");
        }
        return await verifyCorrelationContract({
            successUrl: `http://127.0.0.1:${address.port}/api/health`,
            errorUrl: `http://127.0.0.1:${address.port}/api/items`,
            origin,
            timeoutMs: 5_000,
        });
    } finally {
        await new Promise(resolvePromise => server.close(resolvePromise));
    }
}

async function main() {
    const values = parseArguments(process.argv.slice(2));
    if (values.has("--self-test")) {
        console.log(JSON.stringify(await runSelfTest()));
        return;
    }
    const successUrl = validateUrl(requiredArgument(values, "--success-url"), "--success-url");
    const errorUrl = validateUrl(requiredArgument(values, "--error-url"), "--error-url");
    const origin = values.get("--origin");
    if (origin) {
        validateUrl(origin, "--origin");
    }
    const timeoutMs = values.has("--timeout-ms") ? Number(values.get("--timeout-ms")) : 30_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
        throw new Error("--timeout-ms must be an integer from 1000 to 120000");
    }
    const result = await verifyCorrelationContract({ successUrl, errorUrl, origin, timeoutMs });
    console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
