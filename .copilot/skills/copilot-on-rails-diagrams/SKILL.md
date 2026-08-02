---
name: copilot-on-rails-diagrams
description: >-
  Turn Copilot on Rails event data into a polished, full-page UML-style sequence
  diagram (self-contained interactive HTML) that visualizes the flow across the
  Extension, Webview, MCP Server, and Copilot Chat. Handles two inputs: a
  diagnostics dump (JSON with a `diagnosticEvents` array) via `seqdiagram.mjs`,
  and a telemetry log (line-based `** TELEMETRY(...)`) via `seqtelemetry.mjs`.
  Ask the user which file to use and for its path. Use when asked to visualize,
  diagram, or chart Copilot on Rails diagnostics / telemetry events.
---

# Copilot on Rails - sequence diagrams

Generate a clean sequence diagram from Copilot on Rails event data. Two
generators share one renderer and look (Node.js, zero dependencies):

- **`seqdiagram.mjs`** - diagnostics dump (JSON with `diagnosticEvents`).
  Visual contract: `reference-output.png`.
- **`seqtelemetry.mjs`** - telemetry log (line-based `** TELEMETRY(...)`).
  Visual contract: `reference-output-telemetry.png`.
- **`render.mjs`** - shared renderer imported by both: lifelines, `ROUTING`,
  `TYPE_COLOR`, the inline-SVG builder, and the full-page HTML shell. Each
  front-end only parses its input into an ordered `steps` array and hands it
  here, so a look change in `render.mjs` updates both diagrams at once.

**First, ask the user which input they have (diagnostics vs telemetry) and for
its path.** Do not assume a location or filename. The two share lifelines,
colors, and layout; only the parsing/labeling rules differ (see below).

## Quick start

```bash
# diagnostics JSON
node seqdiagram.mjs <path-to-diagnostics-file> [out.html]
# telemetry log
node seqtelemetry.mjs <path-to-telemetry-file> [out.html]
```

Each writes a single self-contained `.html` (inline SVG, no external assets) and
prints a routing table plus the diagram's native pixel size to stdout, e.g.
`diagram 1230x1894px  ->  render 1:1 with --window-size=1230,1894`.

To rasterize a PNG preview (headless Chrome, macOS path shown), size the window
to the exact `--window-size=WxH` the generator printed. The SVG is responsive
(`width:100%`), so a wider window upscales it and stretches the height past the
frame, clipping the bottom arrows - always use the printed native dimensions:

```bash
# use the WxH the generator printed for --window-size (native, 1:1)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1230,1894 \
  --screenshot=preview.png "file://$PWD/diagnostics.html"
```

## Input shape (diagnostics)

JSON with a top-level `diagnosticEvents` array. Each event has:
`name`, `type`, `status` (`start` | `success`), `timestamp`, and `properties`.

Types seen: `extensionCommand`, `webviewAction`, `mcpTool`. There are **no**
`/execute` events in the data - those are derived (see below).

## Design decisions - diagnostics (already baked in - keep them)

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
12. **Defensive invocation-order sort (`orderByStart`).** Occurrences are
    ordered by their first event's `timestamp`, comparing only when both
    neighbours have one (a local pass, not a global sort). Diagnostics logs an
    explicit `start` at invocation time, so this is normally a **no-op** here -
    it exists to remove the hidden "the source emits starts in order" assumption
    and to mirror the telemetry generator, which genuinely needs it (see below).

## Latent interactivity

Each arrow is a focusable `.msg` group with click/keyboard select handlers and a
selection highlight already wired up. The old right-side inspector panel was
removed per request (full-page look), but the hooks and inspector CSS remain so
a future task can re-enable a "click an arrow to inspect its raw occurrences
(status, timestamp, properties)" panel with minimal work.

## Extending

- Shared look (both diagrams): edit `render.mjs` - lifelines (`LANES`),
  `ROUTING`, `TYPE_COLOR`, `LANE_GLYPH`, layout constants, SVG/HTML shell.
- New event `type`: add it to `ROUTING` and `TYPE_COLOR` in `render.mjs` (and
  `LANE_GLYPH` only if adding a lifeline). Everything else is data-driven.
- New action label: nothing to do - the action is appended automatically
  (`.<action>` for diagnostics, ` (<action>)` for telemetry). Add routing
  overrides in the front-end's `buildSteps` only for special handoffs (like
  `deploy` -> Extension).
- New telemetry extension command: add its base name to `EXTENSION_COMMANDS` in
  `seqtelemetry.mjs`.

## Telemetry mode (`seqtelemetry.mjs`)

Telemetry is a different input shape but renders with the same lifelines,
colors, layout, and interactivity. Rules that differ from diagnostics:

1. **Input shape.** Line-based log; each line is
   `** TELEMETRY("<product>/<name>", <version>) properties={...json...} ...`.
   Unlike diagnostics, each line is already a **complete** event (carries
   `result` plus `startTimestamp`/`endTimestamp`), so there is **no start/success
   pair to collapse** - one line == one arrow.
2. **Type is encoded in the name path, not a field.** Infer it:
   `mcpTool/<x>` -> `mcpTool`; `mcpTool/<x>/execute` -> `mcpTool` + execute;
   `copilotOnRails.<x>` -> `webviewAction`, except a known set of extension
   commands (`EXTENSION_COMMANDS` = `startDebugConfiguration`, `startDeployment`)
   -> `extensionCommand`. Telemetry does not label this, so that set is a small
   maintained allow-list - extend it if new extension commands appear.
3. **Keep the full name after the `<product>/` prefix.** Strip only the first
   path segment (e.g. `vscode-azureresourcegroups/`). Do **not** strip
   `copilotOnRails.` here (unlike diagnostics) - show
   `copilotOnRails.debugNextStepsAction`, `mcpTool/open_plan_view/execute`, etc.
4. **`/execute` events are EXPLICIT** (not derived like diagnostics). Telemetry
   logs each `/execute` immediately **before** its own tool call; `reorderExecutes`
   bundles the pair so the call (Copilot Chat -> MCP Server) precedes its execute
   (MCP Server -> Webview). This structural bundling handles call/execute order -
   nothing fancier is needed for it.
5. **Order by `startTimestamp`, but only when both events have one.** A telemetry
   event that calls another *inside itself* finishes - and therefore logs - last,
   so raw log order (completion order) can be reversed. `orderByStart` compares
   `startTimestamp` for a neighbour pair **only when both carry one**, and swaps
   if out of order; events without a `startTimestamp` (an `mcpTool` call, whose
   time lives on its `/execute` half) are never compared and act as barriers.
   This is a **local pass, not a global sort**. It is what puts
   `debugNextStepsAction (deploy)` (invoked `...:04.605Z`) ahead of the
   `startDeployment` (invoked `...:04.606Z`) it wraps - on real invocation time,
   not a hardcoded name rule.
6. **Action in parentheses.** When an event carries `properties.action` (today
   only `debugNextStepsAction`, values `apiTests` / `deploy` / `integrate`),
   append ` (<action>)` to the label, e.g. `... debugNextStepsAction (deploy)`.
   A `deploy` action routes the arrow to the **Extension** (handoff to the
   extension command), same as diagnostics.
7. **Never collapse duplicates - show what actually happened.** Every occurrence
   is drawn, including consecutive repeats (e.g. `createProjectSubmitPrompt` can
   fire several times in a row). Faithfulness to the real sequence is the rule.

Everything else (four lifelines, `ROUTING`, `TYPE_COLOR`, full-page/full-width,
sequence badges, zebra bands, latent click-to-select) is shared with the
diagnostics generator.

## Environment notes (learned the hard way)

- Node v24 works. `require()` on a `.txt` file fails; the script uses
  `readFileSync` + `JSON.parse`.
- Prefer headless Chrome for PNG previews. Java/PlantUML/Mermaid CLIs are not
  reliably available here.
- Use absolute paths; avoid `cd` in tooling that hooks `cd`.
- After a look change, re-render and eyeball against the matching reference
  image (`reference-output.png` for diagnostics,
  `reference-output-telemetry.png` for telemetry).
