#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Assembles the `--agent-assets` directory for one MSBench suite.
 *
 * Everything under the staged directory is copied to `/agent/assets` in the container,
 * so this is the only channel for getting anything in there. A suite needs three things
 * beyond the VSIX:
 *
 *   1. `user-overrides.yaml` — the suite's config, staged at the root because that is
 *      where run-agent.sh looks for the last of its three config layers.
 *   2. `graders/*.mjs` — the eval graders, bundled (see below).
 *   3. `workspace-seed/` — for the scaffold suites, the `.azure/` a planner run produced.
 *      The scaffold agent's first action is reading `.azure/project-plan.md`, and nothing
 *      in the container puts one there.
 *
 * Graders are *bundled* rather than copied. Run directly they are `.ts` files that import
 * across `evals/src/`, which needs both a matching directory layout and a Node new enough
 * to strip types (>=22.18). Bundling collapses each grader to one dependency-free `.mjs`,
 * so the container only needs a Node that can run ESM, and there is no import graph to
 * reproduce. The bundle is built from the same sources `graderCertification` certifies,
 * so the certified path and the MSBench path stay the same code.
 *
 * Staging into `.staged/` keeps `assets/` pristine: it is checked in, and rewriting
 * `assets/user-overrides.yaml` per suite would leave the tree dirty after every run.
 *
 * Usage:
 *   node evals/msbench/stage.mjs <suite>     # default: project-plan
 *   node evals/msbench/stage.mjs --list
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { assertSeedFresh } from "./harvest-seed.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const msbenchDir = __dirname;
const evalsDir = path.resolve(msbenchDir, "..");
const repoRoot = path.resolve(evalsDir, "..");
const stagedDir = path.join(msbenchDir, ".staged");
const suitesDir = path.join(msbenchDir, "suites");

/**
 * `seed` names a directory under `evals/.generated/scaffold-input/`, harvested from a
 * `seed-plan-*` run by evals/msbench/harvest-seed.mjs. Suites with no seed start from the
 * empty container workspace.
 *
 * Exported so validate-suites.mjs can check this map against suites/ in CI.
 */
export const SUITES = {
    "project-plan": {
        config: path.join(msbenchDir, "assets", "user-overrides.yaml"),
        seed: undefined,
    },
    // Produce the scaffold seed by running the real planner in real VS Code. Unseeded by
    // definition: these are what generate the seed everything else consumes.
    "seed-plan-fullstack": {
        config: path.join(suitesDir, "seed-plan-fullstack.yaml"),
        seed: undefined,
    },
    "seed-plan-api-only": {
        config: path.join(suitesDir, "seed-plan-api-only.yaml"),
        seed: undefined,
    },
    "scaffold-missing-plan": {
        config: path.join(suitesDir, "scaffold-missing-plan.yaml"),
        // Deliberately unseeded: the stimulus is "no plan on disk".
        seed: undefined,
    },
    "scaffold-unapproved-plan": {
        config: path.join(suitesDir, "scaffold-unapproved-plan.yaml"),
        seed: "unapproved-plan",
    },
    "scaffold-fullstack": {
        config: path.join(suitesDir, "scaffold-fullstack.yaml"),
        seed: "approved-fullstack",
    },
    "scaffold-api-only": {
        config: path.join(suitesDir, "scaffold-api-only.yaml"),
        seed: "approved-api-only",
    },
    "scaffold-autopilot": {
        config: path.join(suitesDir, "scaffold-autopilot.yaml"),
        seed: "approved-fullstack",
    },
};

function die(message) {
    process.stderr.write(`ERROR: ${message}\n`);
    process.exit(1);
}

function copyDirectory(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dest = path.join(to, entry.name);
        if (entry.isDirectory()) {
            copyDirectory(src, dest);
        } else if (entry.isFile()) {
            fs.copyFileSync(src, dest);
        }
    }
}

/**
 * Bundle every grader to a standalone ESM file. `--target=node18` keeps the output
 * conservative: the container's Node version is not something this repo controls, and a
 * grader that fails to parse there is indistinguishable from a failing agent.
 */
function bundleGraders(destination) {
    const graderDir = path.join(evalsDir, "graders");
    const graders = fs.readdirSync(graderDir)
        .filter(f => f.startsWith("validate-") && f.endsWith(".ts"));
    if (graders.length === 0) {
        die(`No graders found in ${graderDir}.`);
    }

    const esbuild = path.join(repoRoot, "node_modules", ".bin", "esbuild");
    if (!fs.existsSync(esbuild)) {
        die("esbuild not found. Run 'npm install' at the repo root first.");
    }

    fs.mkdirSync(destination, { recursive: true });
    for (const grader of graders) {
        const out = path.join(destination, grader.replace(/\.ts$/, ".mjs"));
        const result = spawnSync(esbuild, [
            path.join(graderDir, grader),
            "--bundle",
            "--platform=node",
            "--format=esm",
            "--target=node18",
            `--outfile=${out}`,
        ], { encoding: "utf8" });
        if (result.status !== 0) {
            process.stderr.write(result.stderr ?? "");
            die(`Failed to bundle ${grader}.`);
        }
    }
    return graders.length;
}

function stageSeed(seed, destination) {
    const source = path.join(evalsDir, ".generated", "scaffold-input", seed, ".azure");
    if (!fs.existsSync(source)) {
        die(
            `No harvested scaffold input at ${path.relative(repoRoot, source)}.\n`
            + `  The scaffold suites start from real planning-agent output rather than a stored\n`
            + `  plan, so it has to be produced by a seed run first:\n\n`
            + `      ./evals/msbench/run.sh --suite seed-plan-fullstack\n`
            + `      node evals/msbench/harvest-seed.mjs --run-id <id> --target fullstack\n`);
    }
    try {
        assertSeedFresh(seed);
    } catch (error) {
        die(error.message);
    }
    copyDirectory(source, path.join(destination, ".azure"));
}

function main() {
    const args = process.argv.slice(2).filter(a => a !== "--");
    if (args.includes("--list")) {
        process.stdout.write(`${Object.keys(SUITES).join("\n")}\n`);
        return;
    }

    const name = args[0] ?? "project-plan";
    const suite = SUITES[name];
    if (suite === undefined) {
        die(`Unknown suite '${name}'. Available:\n  - ${Object.keys(SUITES).join("\n  - ")}`);
    }
    if (!fs.existsSync(suite.config)) {
        die(`Suite config not found: ${path.relative(repoRoot, suite.config)}`);
    }

    // Rebuilt from scratch so a suite switch cannot leave the previous suite's seed
    // behind — a stale `.azure/` would silently turn "no plan on disk" into a pass.
    fs.rmSync(stagedDir, { recursive: true, force: true });
    fs.mkdirSync(stagedDir, { recursive: true });

    fs.copyFileSync(suite.config, path.join(stagedDir, "user-overrides.yaml"));

    // run.sh writes the VSIX here; carry over an already-built one so --skip-build works.
    const extensions = path.join(stagedDir, "extensions");
    fs.mkdirSync(extensions, { recursive: true });
    const existingVsix = path.join(msbenchDir, "assets", "extensions", "vscode-azureresourcegroups.vsix");
    if (fs.existsSync(existingVsix)) {
        fs.copyFileSync(existingVsix, path.join(extensions, "vscode-azureresourcegroups.vsix"));
    }

    const graderCount = bundleGraders(path.join(stagedDir, "graders"));

    if (suite.seed !== undefined) {
        stageSeed(suite.seed, path.join(stagedDir, "workspace-seed"));
    }

    process.stdout.write(
        `[stage] suite '${name}': ${graderCount} grader(s) bundled`
        + `${suite.seed ? `, seeded from '${suite.seed}'` : ", no workspace seed"}\n`);
    process.stdout.write(`[stage] ${path.relative(repoRoot, stagedDir)}\n`);
}

// Only stage when run directly; validate-suites.mjs imports this file for SUITES.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
