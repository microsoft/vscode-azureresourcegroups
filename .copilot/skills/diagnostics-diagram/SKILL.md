---
name: diagnostics-diagram
description: >-
  Turn a Copilot on Rails diagnostics dump (JSON with a `diagnosticEvents`
  array) into a polished, full-page UML-style sequence diagram (self-contained
  interactive HTML) that visualizes the event flow across the Extension,
  Webview, MCP Server, and Copilot Chat. Ask the user for the path to their
  diagnostics file. Use when asked to visualize, diagram, or chart Copilot on
  Rails diagnostics / telemetry events.
---

# Copilot on Rails - diagnostics sequence diagram

Generate a clean sequence diagram from a diagnostics dump. The generator is
`seqdiagram.mjs` (Node.js, zero dependencies). `reference-output.png` shows the
exact look to reproduce - treat it as the visual contract.

**First, ask the user for the path to their diagnostics file** (a JSON dump with
a `diagnosticEvents` array). Do not assume a location or filename.

## Quick start

```bash
node seqdiagram.mjs <path-to-diagnostics-file> [out.html]
```

It writes a single self-contained `.html` (inline SVG, no external assets) and
prints a routing table to stdout for a fast sanity check.

To rasterize a PNG preview (headless Chrome, macOS path shown):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1500,2160 \
  --screenshot=preview.png "file://$PWD/diagnostics.html"
```

## Input shape

JSON with a top-level `diagnosticEvents` array. Each event has:
`name`, `type`, `status` (`start` | `success`), `timestamp`, and `properties`.

Types seen: `extensionCommand`, `webviewAction`, `mcpTool`. There are **no**
`/execute` events in the data - those are derived (see below).

## Design decisions (already baked in - keep them)

These encode the captain's accumulated feedback. Do not regress them.

1. **Node.js only.** Never a Python port.
2. **Four fixed lifelines**, left to right: `Extension`, `Webview`,
   `MCP Server`, `Copilot Chat`. Each drawn as a tall column with a rounded
   header and footer cap plus a role glyph.
3. **Routing by event type** (`ROUTING`): `extensionCommand` Extension -> Copilot
   Chat; `mcpTool` Copilot Chat -> MCP Server; `webviewAction` Webview -> Copilot
   Chat. Arrowhead is at the target.
4. **Collapse start/success pairs, but preserve distinct triggers.** One arrow
   per real occurrence. If the same event fires twice (e.g.
   `open_local_next_steps_view` or `startDebugConfiguration`), show it **twice** -
   never merge separate triggers. Only the redundant `success` half of a single
   occurrence is folded away. Faithfulness to the actual sequence matters.
5. **Show name only, not the type text.** Color encodes the type, so there is no
   `type:` label. A small color legend sits in the header.
6. **Color by type** (`TYPE_COLOR`): extensionCommand `#e8590c` (orange),
   mcpTool `#3b5bdb` (blue), webviewAction `#2f9e44` (green).
7. **Strip the `copilotOnRails.` prefix** from displayed names (`cleanName`).
8. **Derived `/execute` arrows.** Every `mcpTool` call is followed by a
   `<name>/execute` arrow from `MCP Server` -> `Webview` (the usual next hop), or
   -> `Extension` when the *next* step is an `extensionCommand`. It uses the
   **same solid line and same mcpTool blue** as the call (no separate dotted
   style, no distinct color).
9. **Action suffix on next-step events.** When an occurrence carries a
   `properties.action` (only `debugNextStepsAction` does today, with values
   `apiTests` / `deploy` / `integrate`), append `.<action>` to the label, e.g.
   `debugNextStepsAction.deploy`. Note the `action` lives on the **success**
   event, so read it from the whole occurrence, not just the start.
10. **`deploy` routes to the Extension.** A `webviewAction` whose action is
    `deploy` is a handoff to the extension command, so its arrow targets
    `Extension` instead of `Copilot Chat`.
11. **Full page, full width, no subtitle, no inspector panel.** The header shows
    only the title + color legend. The SVG is responsive (`width:100%`) so the
    diagram spans the whole page. Sequence badges number each arrow; zebra bands
    aid row tracking.

## Latent interactivity

Each arrow is a focusable `.msg` group with click/keyboard select handlers and a
selection highlight already wired up. The old right-side inspector panel was
removed per request (full-page look), but the hooks and inspector CSS remain so
a future task can re-enable a "click an arrow to inspect its raw occurrences
(status, timestamp, properties)" panel with minimal work.

## Extending

- New event `type`: add it to `ROUTING` and `TYPE_COLOR` (and `LANE_GLYPH` only
  if adding a lifeline). Everything else is data-driven.
- New action label: nothing to do - any `properties.action` is appended
  automatically. Add routing overrides in `buildSteps` only for special handoffs
  (like `deploy` -> Extension).
- Layout tuning: the constants block near the top (`LANE_W`, `ROW_H`, `BOX_W`,
  `HDR_H`, etc.) controls spacing.

## Environment notes (learned the hard way)

- Node v24 works. `require()` on a `.txt` file fails; the script uses
  `readFileSync` + `JSON.parse`.
- Prefer headless Chrome for PNG previews. Java/PlantUML/Mermaid CLIs are not
  reliably available here.
- Use absolute paths; avoid `cd` in tooling that hooks `cd`.
- After a look change, re-render and eyeball against `reference-output.png`.
