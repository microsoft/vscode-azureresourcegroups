#!/usr/bin/env node
/*
 * Generate an interactive UML-style sequence diagram from a Copilot on Rails
 * telemetry log (line-based `** TELEMETRY("<product>/<name>", <ver>) properties={...}`).
 *
 * Telemetry differs from the diagnostics JSON:
 *  - TYPE is encoded in the name path (mcpTool/<x>, mcpTool/<x>/execute,
 *    copilotOnRails.<x>), not a field.
 *  - `/execute` events are EXPLICIT (not derived).
 *  - Each line is a complete event (result + start/end timestamp), so there is
 *    no start/success pair to collapse - one line == one arrow.
 *  - The full name after the `<product>/` prefix is shown verbatim, and a
 *    next-step `action` is shown in parentheses, e.g. `... (deploy)`.
 *
 * Dependency-free. Usage: node seqtelemetry.mjs <telemetry.txt> [out.html]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { LANES, ROUTING, buildHtml } from "./render.mjs";

// copilotOnRails.<base> names that are extension commands rather than webview
// actions (telemetry does not label this, so it is a small known set).
const EXTENSION_COMMANDS = new Set(["startDebugConfiguration", "startDeployment"]);

// Extract the `properties={...}` JSON object from a telemetry line, matching the
// outermost braces so trailing key=value segments are ignored.
function parseProps(line) {
  const i = line.indexOf("properties=");
  if (i < 0) return {};
  const s = line.slice(i + "properties=".length).trimStart();
  let depth = 0, inStr = false, escaped = false, end = -1;
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) return {};
  try { return JSON.parse(s.slice(0, end + 1)); } catch { return {}; }
}

// Parse each `** TELEMETRY(...)` line into an event. The `<product>/` prefix
// (first path segment) is stripped; the rest of the name is kept verbatim.
function parseTelemetry(text) {
  const events = [];
  for (const line of text.split("\n")) {
    const m = line.match(/TELEMETRY\("([^"]+)"/);
    if (!m) continue;
    const name = m[1].replace(/^[^/]+\//, "");
    const props = parseProps(line);
    events.push({ name, props, action: props.action || null });
  }
  return events;
}

// Telemetry logs each mcpTool `/execute` immediately BEFORE its matching call;
// swap each such adjacent pair so the call precedes its execute (the logical
// request-then-response order).
function reorderExecutes(events) {
  const out = [...events];
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i];
    if (a.name.endsWith("/execute")) {
      const base = a.name.slice(0, -"/execute".length);
      if (out[i + 1].name === base) {
        [out[i], out[i + 1]] = [out[i + 1], out[i]];
        i++;
      }
    }
  }
  return out;
}

// Reorder neighbours by invocation time, but ONLY when BOTH carry a
// startTimestamp. A telemetry event that calls another inside itself finishes -
// and logs - last, so completion order can be reversed (e.g. the
// debugNextStepsAction wrapper vs the startDeployment it triggers). Comparing
// startTimestamps recovers the true invocation order. Events without a
// startTimestamp (an mcpTool call, whose time lives on its /execute half) are
// never compared and act as barriers - a local pass, not a global sort.
function orderByStart(events) {
  const out = [...events];
  const t = (e) =>
    e.props && e.props.startTimestamp ? Date.parse(e.props.startTimestamp) : null;
  let swapped = true;
  while (swapped) {
    swapped = false;
    for (let i = 0; i < out.length - 1; i++) {
      const a = t(out[i]);
      const b = t(out[i + 1]);
      if (a !== null && b !== null && a > b) {
        [out[i], out[i + 1]] = [out[i + 1], out[i]];
        swapped = true;
      }
    }
  }
  return out;
}

function inferType(name) {
  if (name.startsWith("mcpTool/")) return "mcpTool";
  if (name.startsWith("copilotOnRails.")) {
    const base = name.slice("copilotOnRails.".length);
    return EXTENSION_COMMANDS.has(base) ? "extensionCommand" : "webviewAction";
  }
  return "webviewAction";
}

function buildSteps(events) {
  return events.map((e, i) => {
    const type = inferType(e.name);
    const execute = e.name.endsWith("/execute");
    let [src, tgt] = ROUTING[type] ?? [LANES[0], LANES[LANES.length - 1]];
    if (execute) { src = "MCP Server"; tgt = "Webview"; }
    if (type === "webviewAction" && e.action === "deploy") tgt = "Extension";
    const label = e.action ? `${e.name} (${e.action})` : e.name;
    return { src, tgt, type, label, execute, refIdx: i };
  });
}

const srcPath = process.argv[2] || "telemetry.txt";
const outPath = process.argv[3] || "telemetry.html";
const events = orderByStart(reorderExecutes(parseTelemetry(readFileSync(srcPath, "utf8"))));
const steps = buildSteps(events);
writeFileSync(outPath, buildHtml(steps, "Copilot on Rails - Telemetry Flow"));
console.log(`wrote ${outPath}: ${events.length} events, ${steps.length} arrows`);
for (const st of steps)
  console.log(`  ${String(st.src).padEnd(12)} -> ${String(st.tgt).padEnd(12)} ${st.label}`);
