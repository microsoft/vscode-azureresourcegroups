/*
 * Shared renderer for the Copilot on Rails sequence-diagram generators
 * (seqdiagram.mjs = diagnostics JSON, seqtelemetry.mjs = telemetry log).
 *
 * Both front-ends parse their own input into an ordered array of `steps`:
 *   { src, tgt, type, label, execute, refIdx }
 * and hand it here. Lifelines, routing, colors, layout, and the full-page HTML
 * shell live in one place so a look change updates both diagrams.
 */

// lifelines, left to right
export const LANES = ["Extension", "Webview", "MCP Server", "Copilot Chat"];

// type -> [source lane, target lane]; arrowhead is drawn at the target.
export const ROUTING = {
  extensionCommand: ["Extension", "Copilot Chat"],
  mcpTool: ["Copilot Chat", "MCP Server"],
  webviewAction: ["Webview", "Copilot Chat"],
};

// type -> accent color (color encodes the type, so no type text is drawn).
export const TYPE_COLOR = {
  extensionCommand: "#e8590c",
  mcpTool: "#3b5bdb",
  webviewAction: "#2f9e44",
};
export const FALLBACK_COLOR = "#5c5f66";

// lane -> subtle role glyph shown in the header/footer cell.
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
const HDR_H = 60;
const FIRST_ARROW_Y = BOX_TOP + HDR_H + 58;
const ROW_H = 58;
const GAP_AFTER_ARROWS = 40;

export const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// A rounded accent cell: rounded on the given side, straight on the other, so
// the header/footer read as caps on the tall lane column.
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

export function buildSvg(steps) {
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

  for (let i = 0; i < n; i++) {
    if (i % 2 === 1) continue;
    const y = FIRST_ARROW_Y + i * ROW_H;
    p.push(
      `<rect class="zebra" x="0" y="${y - ROW_H + 14}" width="${width}" height="${ROW_H}"/>`
    );
  }

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

export function buildHtml(steps, title) {
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
  .legend { margin-top:9px; display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
  .lg { font-size:12px; color:var(--muted); display:inline-flex; align-items:center; gap:6px; }
  .sw { width:12px; height:12px; border-radius:3px; display:inline-block; }
  .layout { display:flex; align-items:flex-start; }
  .canvas { flex:1; overflow:auto; padding:16px 20px 60px; }
  .canvas svg { width:100%; height:auto; display:block; }
  svg text { font-family: "Times New Roman", Times, serif; }
  .zebra { fill:#000000; opacity:.022; }
  .lane { fill:#ffffff; stroke:#d4dae2; stroke-width:1.2; }
  .lane-cap { fill:#eef2fb; stroke:none; }
  .lane-glyph { text-anchor:middle; font-size:19px; font-family:-apple-system,"Segoe UI",sans-serif; }
  .lane-name { text-anchor:middle; font-size:19px; fill:#1b1f24; font-weight:600; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; }
  .mname { text-anchor:middle; font-size:16.5px; }
  .seq-bg { fill:#ffffff; stroke-width:1.4; }
  .seq { text-anchor:middle; font-size:11.5px; font-weight:600; font-family:-apple-system,"Segoe UI",sans-serif; }
  .band { fill:transparent; }
  .msg { cursor:pointer; }
  .msg .band { transition:fill .08s ease; }
  .msg:hover .band { fill:rgba(59,91,219,.06); }
  .msg.sel .band { fill:rgba(59,91,219,.13); }
  .msg:focus { outline:none; }
  .msg:focus .band { fill:rgba(59,91,219,.10); }
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
