# Copilot on Rails artifact security

This document is the security contract for contributors and reviewers working on code that reads or renders
Copilot on Rails artifacts. See [Files & state](copilot-create-project.md#files--state) for the artifact
inventory.

## Trust boundary

**SDL requirement.** Treat `.azure/*`, `.azure/.preview-temp/*`,
`.copilot-azure/sessions/*`, and `package.json` files inside the Copilot on Rails user's project workspace
as untrusted input. Agents may write these files, and users and other workspace tools can edit them. A
reader can also observe a partial write. Validate data before it influences a path, URL, command, process,
file operation, HTML node, or SVG node.

**Design assumptions.** Artifacts belong to the current workspace and may be incomplete while an agent is
working. Readers may preserve fields that are already valid, but they must not infer that the rest of the
document is trustworthy.

**Residual risk.** Runtime shape checks do not make a string safe for every later use. Validate again for the
specific sink. A future deserializer, renderer, or URL handler can introduce a new execution path even when
the current JSON parsing step is data-only.

## JSON parsing and partial artifacts

Safe deserialization and safe downstream use are separate checks.

Use plain, one-argument `JSON.parse(text)`. This operation is data-only. JSON content cannot supply or invoke
a reviver; application code would have to pass the optional second argument. Do not add a reviver without a
separate security review.

Assign the parse result to `unknown`. Narrow the root and every consumed field with runtime checks before use.
A TypeScript cast only changes the compiler's view and does not validate runtime data.

Malformed JSON follows the caller's existing error or retry path. For valid JSON with an incomplete object,
preserve valid fields and ignore or default invalid fields according to the artifact contract. Filtering an
invalid array entry must not discard its valid siblings. Never silently coerce an object to a string, which
can turn unsupported input into text such as `[object Object]`.

### Project correlation marker

`.azure/created-by-cor.json` is an authoritative project-level correlation breadcrumb, but it remains
untrusted workspace input. The extension creates or restores this exact payload when project planning begins
in either a same-folder or folder-handoff flow:

```json
{
  "schemaVersion": 1,
  "source": "copilot-on-rails",
  "corProjectId": "<existing random CoR UUID>"
}
```

Unlike partially rendered plan artifacts, a reader must validate this identity marker as one complete,
closed schema. Require a plain object with exactly the three documented own properties: reject missing or
extra fields, arrays, and `null`. Require `schemaVersion` to be the number `1`, `source` to equal
`"copilot-on-rails"` exactly, and `corProjectId` to be a valid UUID string. Do not trim, coerce, infer,
merge, or accept a partially valid marker. Malformed JSON, partial writes, and any invalid field make the
whole marker unusable for correlation.

The marker makes a random CoR project identity portable for a future Azure Attach consumer; it does not
itself prove an Azure deployment relationship. The UUID is pseudonymous correlation data that contains no
user or Azure identity. Never copy it into ARM tags, resource names, logs, or diagnostics; a downstream
reader may use it only as the approved telemetry join key.

The canonical Azure App Onboard consumer and telemetry owner lives in `microsoft/azure-skills` under
`skills/azure-app-onboard/`, outside this repository. That consumer must apply the same strict validation
before end-to-end correlation can be claimed; this Resources extension change alone does not complete the
downstream join. Do not confuse the marker with the non-unique ARM tag `created-by-cor: true`, which
classifies CoR-created infrastructure but does not identify a project.

## Paths and package metadata

Validate every artifact-supplied path part before passing it to `Uri.joinPath`, `path.join`, or another file
API. Preview page slugs use kebab case and must match `[a-z0-9]+(?:-[a-z0-9]+)*`. A value such as
`../outside` must fail validation before the code constructs `<slug>.html`; joining first would let the
artifact escape the preview directory.

When reading a `package.json` from the user's project workspace, require an object root. Require
`dependencies`, `devDependencies`, and `scripts` to be object records when present. Preserve entries whose
values are strings and drop entries with other value types. When key presence changes behavior, use an
own-property check such as `Object.hasOwn(record, key)` rather than reading through the prototype chain.

## Markdown, HTML, and SVG

Prefer a small parsed node model and React nodes for agent-written Markdown. Do not use
`dangerouslySetInnerHTML` for plan text. Explicitly allowlist link protocols before creating anchors. The
local debug plan currently allows `http`, `https`, and `mailto`. Restore only the HTML tags required by the
plan contract, currently attribute-free `<details>`, `<summary>`, and `<br>` tags. Leave unknown or
attribute-bearing HTML as text.

Mermaid output is still generated SVG inserted into the document. Initialize Mermaid with
`securityLevel: "strict"` before rendering and keep that setting in place before inserting its SVG.

## Audit checklist

1. Find every JSON parse, file read, and deserializer used by the changed flow.
2. Confirm each `JSON.parse` call has one argument and no reviver. Review deserializer dependencies for code
   execution or unsafe object construction.
3. Parse into `unknown`, validate the root, and narrow every consumed field at runtime.
4. Check malformed JSON follows the existing error or retry path. Check incomplete objects preserve valid
   fields without coercing invalid values.
5. Trace artifact values into path construction, shell or process calls, file operations, and URLs. Apply
   sink-specific validation and confinement.
6. Trace artifact text into HTML and SVG sinks. Prefer React nodes, allowlist protocols and tags, and keep
   Mermaid in strict security mode.
7. Add targeted tests for malformed roots, wrong field types, partial objects, traversal strings, unsafe
   links or tags, and other inputs that reach the changed sink.
