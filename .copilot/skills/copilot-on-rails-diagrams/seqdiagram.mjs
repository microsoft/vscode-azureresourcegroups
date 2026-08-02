#!/usr/bin/env node
/*
 * Generate an interactive UML-style sequence diagram from a Copilot on Rails
 * diagnostics.txt (JSON with a `diagnosticEvents` array).
 *
 * - Collapses each start/success PAIR into one occurrence, but preserves every
 *   distinct trigger (a name that fires twice yields two arrows).
 * - Draws one message per occurrence, routed between fixed lifelines by type.
 * - Derives a `<name>/execute` arrow after each mcpTool call (diagnostics has no
 *   explicit execute events; telemetry does - see seqtelemetry.mjs).
 * - Emits a self-contained full-page HTML via the shared renderer.
 *
 * Dependency-free. Usage: node seqdiagram.mjs <diagnostics.txt> [out.html]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { LANES, ROUTING, buildHtml } from "./render.mjs";

// Collapse each start/success PAIR into a single occurrence, but preserve every
// distinct trigger in temporal order. A recurring name (e.g. two separate
// open_local_next_steps_view triggers) yields separate steps; only the
// redundant success half of one occurrence is folded away.
function collapseOccurrences(events) {
  const out = [];
  const open = new Map();
  const isClose = (s) => ["success", "complete", "completed", "end"].includes(s);
  for (const e of events) {
    const name = e.name ?? "";
    const status = String(e.status ?? "").toLowerCase();
    if (isClose(status) && open.has(name)) {
      open.get(name).occurrences.push(e);
      open.delete(name);
    } else {
      const occ = { name, type: e.type ?? "", occurrences: [e] };
      out.push(occ);
      if (!isClose(status)) open.set(name, occ);
    }
  }
  return orderByStart(out);
}

// Defensive ordering: sort occurrences by their first event's timestamp when
// BOTH neighbours have one, so the diagram reflects true invocation order rather
// than relying on the source emitting `start` events in order. Diagnostics logs
// an explicit `start` at invocation time, so this is normally a no-op here - but
// it makes the generator robust to any emit/completion-order quirk (the same
// completion-order reversal that telemetry hits; see seqtelemetry.mjs).
function orderByStart(items) {
  const t = (it) => {
    const ts = it.occurrences[0]?.timestamp;
    return ts ? Date.parse(ts) : null;
  };
  const out = items.map((it, i) => ({ it, i }));
  let swapped = true;
  while (swapped) {
    swapped = false;
    for (let k = 0; k < out.length - 1; k++) {
      const a = t(out[k].it);
      const b = t(out[k + 1].it);
      if (a !== null && b !== null && (a > b || (a === b && out[k].i > out[k + 1].i))) {
        [out[k], out[k + 1]] = [out[k + 1], out[k]];
        swapped = true;
      }
    }
  }
  return out.map((o) => o.it);
}

// Strip the noisy `copilotOnRails.` prefix from event names for display.
const cleanName = (s) => String(s).replace(/^copilotOnRails\./, "");

// The action variant recorded in an occurrence's properties (e.g. debug next
// steps -> "apiTests" | "deploy" | "integrate"); appended to the label.
function eventAction(item) {
  for (const o of item.occurrences || [])
    if (o.properties && o.properties.action) return String(o.properties.action);
  return null;
}

// Expand collapsed events into rendered steps. Every mcpTool call is followed by
// a derived `<name>/execute` arrow from MCP Server to Webview - or to Extension
// when the next step is an extensionCommand.
function buildSteps(items) {
  const steps = [];
  items.forEach((it, i) => {
    let [src, tgt] = ROUTING[it.type] ?? [LANES[0], LANES[LANES.length - 1]];
    const action = eventAction(it);
    if (it.type === "webviewAction" && action === "deploy") tgt = "Extension";
    steps.push({
      src,
      tgt,
      type: it.type,
      label: cleanName(it.name) + (action ? "." + action : ""),
      refIdx: i,
      execute: false,
    });
    if (it.type === "mcpTool") {
      const next = items[i + 1];
      const target = next && next.type === "extensionCommand" ? "Extension" : "Webview";
      steps.push({
        src: "MCP Server",
        tgt: target,
        type: "mcpTool",
        label: cleanName(it.name) + "/execute",
        refIdx: i,
        execute: true,
      });
    }
  });
  return steps;
}

const srcPath = process.argv[2] || "diagnostics.txt";
const outPath = process.argv[3] || "diagnostics.html";
const raw = JSON.parse(readFileSync(srcPath, "utf8"));
const items = collapseOccurrences(raw.diagnosticEvents || []);
const steps = buildSteps(items);
writeFileSync(outPath, buildHtml(steps, "Copilot on Rails - Diagnostics Flow"));
console.log(`wrote ${outPath}: ${items.length} events, ${steps.length} arrows`);
for (const st of steps)
  console.log(`  ${String(st.src).padEnd(12)} -> ${String(st.tgt).padEnd(12)} ${st.label}`);
