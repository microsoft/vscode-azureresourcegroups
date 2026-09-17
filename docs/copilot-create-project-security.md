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

The workload-quality question IDs in `.azure/requirements.json` have fixed option sets. Any downstream reader
must allowlist both the IDs and values before using them; an arbitrary category/answer must not become a
deployment profile, compliance claim, timeout, budget, route, or resource setting. Treat rationale and every
cell in `Quality Attributes & Tradeoffs` / `Workload Quality Contract` as untrusted prose.

Malformed JSON follows the caller's existing error or retry path. For valid JSON with an incomplete object,
preserve valid fields and ignore or default invalid fields according to the artifact contract. Filtering an
invalid array entry must not discard its valid siblings. Never silently coerce an object to a string, which
can turn unsupported input into text such as `[object Object]`.

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
8. For workload-quality changes, test unknown question IDs/values, missing pillar rows, placeholder evidence,
   and false claims such as `WAF compliant`. A successful scaffold or deployment is not proof of framework
   compliance.
