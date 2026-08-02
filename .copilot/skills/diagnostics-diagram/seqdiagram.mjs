#!/usr/bin/env node
/*
 * Generate an interactive UML-style sequence-diagram from a Copilot on Rails
 * diagnostics.txt (JSON with `diagnosticEvents`).
 *
 * - Dedupes events by `name` (keeps first occurrence, preserves order).
 * - Draws one message per unique event, labelled `<type>: <name>`, routed
 *   between fixed lifelines by event type.
 * - Emits a single self-contained .html: inline SVG diagram + click-to-inspect
 *   panel showing every raw occurrence (status, timestamp, properties).
 *
 * Dependency-free. Reproducible by another agent (intended as a skill core).
 *
 * Usage: node seqdiagram.mjs <diagnostics.txt> [out.html]
 */
import { readFileSync, writeFileSync } from "node:fs";

// ---- configuration ---------------------------------------------------------

const LANES = ["Extension", "Webview", "MCP Server", "Copilot Chat"];

// type -> [source lane, target lane]; arrowhead is drawn at the target.
const ROUTING = {
  extensionCommand: ["Extension", "Copilot Chat"],
  mcpTool: ["Copilot Chat", "MCP Server"],
  webviewAction: ["Webview", "Copilot Chat"],
};

// type -> accent color.
const TYPE_COLOR = {
  extensionCommand: "#e8590c",
  mcpTool: "#3b5bdb",
  webviewAction: "#2f9e44",
};
const FALLBACK_COLOR = "#5c5f66";

// lane -> subtle role glyph shown in the header cell.
const LANE_GLYPH = {
  Extension: "\u{1F9E9}",
  Webview: "\u{1F5A5}",
  "MCP Server": "\u{1F50C}",
  "Copilot Chat": "\u{1F4AC}",
};

// layout
const LANE_W = 330;
const MARGIN_X = 120;
const BOX_W = 168;
const BOX_TOP = 26;
const HDR_H = 60;               // header cell height
const FIRST_ARROW_Y = BOX_TOP + HDR_H + 58;
const ROW_H = 58;
const GAP_AFTER_ARROWS = 40;    // gap between last arrow and footer cell

// ---- helpers ---------------------------------------------------------------

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Collapse each start/success PAIR into a single occurrence, but preserve every
// distinct trigger in temporal order. A recurring name (e.g. two separate
// open_local_next_steps_view triggers) yields separate steps; only the
// redundant success half of one occurrence is folded away.
function collapseOccurrences(events) {
  const out = [];
  const open = new Map(); // name -> most recent occurrence awaiting its success
  const isClose = (s) => ["success", "complete", "completed", "end"].includes(s);
  for (const e of events) {
    const name = e.name ?? "";
    const status = String(e.status ?? "").toLowerCase();
    if (isClose(status) && open.has(name)) {
      open.get(name).occurrences.push(e); // attach success to its start
      open.delete(name);
    } else {
      const occ = { name, type: e.type ?? "", occurrences: [e] };
      out.push(occ);
      if (!isClose(status)) open.set(name, occ);
    }
  }
  return out;
}

// ---- steps -----------------------------------------------------------------

// Strip the noisy `copilotOnRails.` prefix from event names for display.
const cleanName = (s) => String(s).replace(/^copilotOnRails\./, "");

// The action variant recorded in an occurrence's properties (e.g. debug next
// steps -> "apiTests" | "deploy" | "integrate"); appended to the label.
function eventAction(item) {
  for (const o of item.occurrences || [])
    if (o.properties && o.properties.action) return String(o.properties.action);
  return null;
}

// Expand collapsed events into rendered steps. Every mcpTool call is followed
// by a derived `<name>/execute` arrow from the MCP Server to the Webview - or to
// the Extension when the next step is an extensionCommand.
function buildSteps(items) {
  const steps = [];
  items.forEach((it, i) => {
    let [src, tgt] = ROUTING[it.type] ?? [LANES[0], LANES[LANES.length - 1]];
    const action = eventAction(it);
    // A "deploy" next-step action is a handoff to the extension command.
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

// ---- svg -------------------------------------------------------------------

function buildSvg(steps) {
  const laneX = Object.fromEntries(LANES.map((n, i) => [n, MARGIN_X + i * LANE_W]));
  const width = MARGIN_X * 2 + (LANES.length - 1) * LANE_W;

  const n = steps.length;
  const lastArrowY = FIRST_ARROW_Y + (n - 1) * ROW_H;
  const footerTop = lastArrowY + GAP_AFTER_ARROWS;
  const boxBottom = footerTop + HDR_H;
  const height = boxBottom + BOX_TOP;

  const p = [];
  p.push(
    `<svg id="diagram" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  );

  // defs: arrowhead markers per color + soft shadow for lane columns
  p.push("<defs>");
  for (const [t, c] of Object.entries({ ...TYPE_COLOR, _fallback: FALLBACK_COLOR })) {
    p.push(
      `<marker id="ari-${t}" markerWidth="12" markerHeight="12" refX="9" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,3.5 L0,7 Z" fill="${c}"/></marker>`
    );
  }
  p.push(
    '<filter id="laneShadow" x="-20%" y="-6%" width="140%" height="112%">' +
      '<feDropShadow dx="0" dy="1.5" stdDeviation="3" flood-color="#0b1a3a" flood-opacity="0.10"/></filter>'
  );
  p.push("</defs>");

  // zebra row bands (behind everything) for readability
  for (let i = 0; i < n; i++) {
    if (i % 2 === 1) continue;
    const y = FIRST_ARROW_Y + i * ROW_H;
    p.push(
      `<rect class="zebra" x="0" y="${y - ROW_H + 14}" width="${width}" height="${ROW_H}"/>`
    );
  }

  // lifeline columns with header + footer cells
  for (const name of LANES) {
    const cx = laneX[name];
    const x = cx - BOX_W / 2;
    const glyph = LANE_GLYPH[name] || "";
    p.push(`<g class="lane-col">`);
    p.push(
      `<rect x="${x}" y="${BOX_TOP}" width="${BOX_W}" height="${boxBottom - BOX_TOP}" rx="12" class="lane" filter="url(#laneShadow)"/>`
    );
    p.push(headerCell(x, BOX_TOP, BOX_W, HDR_H, "top"));
    p.push(headerCell(x, footerTop, BOX_W, HDR_H, "bottom"));
    for (const cellTop of [BOX_TOP, footerTop]) {
      const gy = cellTop + 25;
      p.push(`<text x="${cx}" y="${gy}" class="lane-glyph">${glyph}</text>`);
      p.push(`<text x="${cx}" y="${cellTop + 46}" class="lane-name">${esc(name)}</text>`);
    }
    p.push(`</g>`);
  }

  // messages (one arrow per step; color encodes the type, so no type label)
  steps.forEach((st, i) => {
    const color = TYPE_COLOR[st.type] ?? FALLBACK_COLOR;
    const marker = TYPE_COLOR[st.type] ? `ari-${st.type}` : "ari-_fallback";
    const x1 = laneX[st.src];
    const x2 = laneX[st.tgt];
    const y = FIRST_ARROW_Y + i * ROW_H;
    const mid = (x1 + x2) / 2;
    const dir = x2 >= x1 ? 1 : -1;

    p.push(`<g class="msg${st.execute ? " exec" : ""}" data-idx="${i}" data-ref="${st.refIdx}" tabindex="0">`);
    p.push(
      `<rect class="band" x="0" y="${y - ROW_H + 14}" width="${width}" height="${ROW_H}"/>`
    );
    p.push(
      `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="2" marker-end="url(#${marker})"/>`
    );
    p.push(
      `<circle class="seq-bg" cx="${x1 - dir * 17}" cy="${y}" r="10.5" style="stroke:${color}"/>` +
        `<text class="seq" x="${x1 - dir * 17}" y="${y + 4}" style="fill:${color}">${i + 1}</text>`
    );
    p.push(
      `<text class="mname" x="${mid}" y="${y - 10}" fill="${color}">${esc(st.label)}</text>`
    );
    p.push("</g>");
  });

  p.push("</svg>");
  return { svg: p.join("\n"), width, height };
}

// A rounded accent cell: rounded on the given side, straight on the other,
// so header/footer read as caps on the tall lane column.
function headerCell(x, y, w, h, side) {
  const r = 12;
  let d;
  if (side === "top") {
    d = `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
  } else {
    d = `M${x},${y} L${x + w},${y} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r} Z`;
  }
  return `<path d="${d}" class="lane-cap"/>`;
}

// ---- html shell ------------------------------------------------------------

function buildHtml(items, title) {
  const steps = buildSteps(items);
  const { svg } = buildSvg(steps);
  const legend = Object.entries(TYPE_COLOR)
    .map(
      ([t, c]) =>
        `<span class="lg"><span class="sw" style="background:${c}"></span>${esc(t)}</span>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<style>
  :root { --ink:#1b1f24; --muted:#6b7280; --line:#d7dbe0; --bg:#f6f7f9; --panel:#ffffff; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color:var(--ink); background:var(--bg); }
  header { padding:16px 22px; background:var(--panel); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:5; }
  header h1 { margin:0; font-size:17px; font-weight:650; }
  header .sub { color:var(--muted); font-size:12.5px; margin-top:3px; }
  .legend { margin-top:9px; display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
  .lg { font-size:12px; color:var(--muted); display:inline-flex; align-items:center; gap:6px; }
  .sw { width:12px; height:12px; border-radius:3px; display:inline-block; }
  .sw.dash { width:20px; height:0; border-radius:0; border-top:2px dashed #8a93a3; }
  .layout { display:flex; align-items:flex-start; }
  .canvas { flex:1; overflow:auto; padding:16px 20px 60px; }
  .canvas svg { width:100%; height:auto; display:block; }
  svg text { font-family: "Times New Roman", Times, serif; }
  .zebra { fill:#000000; opacity:.022; }
  .lane { fill:#ffffff; stroke:#d4dae2; stroke-width:1.2; }
  .lane-cap { fill:#eef2fb; stroke:none; }
  .lane-glyph { text-anchor:middle; font-size:19px; font-family:-apple-system,"Segoe UI",sans-serif; }
  .lane-name { text-anchor:middle; font-size:19px; fill:#1b1f24; font-weight:600; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; }
  .mtype, .mname { text-anchor:middle; font-size:16.5px; }
  .mtype { opacity:.82; }
  .seq-bg { fill:#ffffff; stroke-width:1.4; }
  .seq { text-anchor:middle; font-size:11.5px; font-weight:600; font-family:-apple-system,"Segoe UI",sans-serif; }
  .band { fill:transparent; }
  .msg { cursor:pointer; }
  .msg .band { transition:fill .08s ease; }
  .msg:hover .band { fill:rgba(59,91,219,.06); }
  .msg.sel .band { fill:rgba(59,91,219,.13); }
  .msg:focus { outline:none; }
  .msg:focus .band { fill:rgba(59,91,219,.10); }
  /* inspector */
  .inspector { width:360px; flex:0 0 360px; align-self:stretch; background:var(--panel); border-left:1px solid var(--line); padding:0; position:sticky; top:0; height:100vh; overflow:auto; }
  .inspector .ph { padding:26px 20px; color:var(--muted); font-size:13px; }
  .ins-head { padding:16px 20px 12px; border-bottom:1px solid var(--line); }
  .ins-head .t { font-size:11px; text-transform:uppercase; letter-spacing:.06em; font-weight:600; }
  .ins-head .n { font-size:16px; font-weight:650; margin-top:4px; word-break:break-word; font-family:"SFMono-Regular",Menlo,Consolas,monospace; }
  .ins-body { padding:14px 20px 40px; }
  .occ { border:1px solid var(--line); border-radius:8px; margin-bottom:12px; overflow:hidden; }
  .occ-h { display:flex; justify-content:space-between; gap:8px; padding:8px 11px; background:#f3f5f8; font-size:12px; }
  .status { font-weight:650; }
  .status.start { color:#1971c2; }
  .status.success { color:#2f9e44; }
  .status.error, .status.failure, .status.failed { color:#e03131; }
  .ts { color:var(--muted); }
  table.props { width:100%; border-collapse:collapse; font-size:12px; }
  table.props td { padding:5px 11px; border-top:1px solid var(--line); vertical-align:top; }
  table.props td.k { color:var(--muted); white-space:nowrap; width:42%; }
  table.props td.v { font-family:"SFMono-Regular",Menlo,Consolas,monospace; word-break:break-word; }
  .noprops { padding:9px 11px; color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <div class="legend">${legend}</div>
</header>
<div class="layout">
  <div class="canvas">${svg}</div>
</div>
<script>
document.querySelectorAll('.msg').forEach(g=>{
  const select = ()=>{
    document.querySelectorAll('.msg.sel').forEach(m=>m.classList.remove('sel'));
    g.classList.add('sel');
  };
  g.addEventListener('click', select);
  g.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); select(); }});
});
</script>
</body>
</html>
`;
}

// ---- main ------------------------------------------------------------------

const srcPath = process.argv[2] || "diagnostics.txt";
const outPath = process.argv[3] || "diagnostics.html";
const raw = JSON.parse(readFileSync(srcPath, "utf8"));
const items = collapseOccurrences(raw.diagnosticEvents || []);
const steps = buildSteps(items);
const title = "Copilot on Rails - Diagnostics Flow";
writeFileSync(outPath, buildHtml(items, title));
console.log(`wrote ${outPath}: ${items.length} events, ${steps.length} arrows`);
for (const st of steps)
  console.log(`  ${String(st.src).padEnd(12)} -> ${String(st.tgt).padEnd(12)} ${st.label}`);
