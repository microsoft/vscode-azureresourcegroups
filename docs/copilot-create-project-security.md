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

`.azure/created-by-cor.json` is an extension-written breadcrumb with schema version `1`, source
`copilot-on-rails`, and the pseudonymous `corProjectId` already used for telemetry correlation. Treat the
file as untrusted when reading it because workspace tools can modify it. Use the ID only to correlate CoR
workflow stages and recognize the generated-project contract; never copy it into Azure resource names,
resource tags, application logs, diagnostic exports, or user-visible output.

The Requirements controller may query Azure authentication and subscription availability to enable the
Sandbox choice. Only a coarse availability state crosses into the webview. `.azure/requirements.json` may
record `developmentEnvironment: sandbox|regular` and `executionMode: auto|guided`, but must never contain
account names, account IDs, tenant IDs, subscription IDs, access tokens, or credential material. Treat both
fields as untrusted when reading the artifact and narrow them to their known enum values before they affect
workflow control.

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

Deployment endpoint anchors, the featured application link, and frontend preview URLs require absolute
HTTP or HTTPS URLs without embedded credentials. Use the shared `getHttpUrl` helper: it parses with the
native `URL` constructor without a base URL, checks the scheme and credentials, and returns the canonical
`url.href`. Pass that result to webview URL sinks and the extension-host URI parser; do not validate one
representation and then open the original string.
Unsupported deployment endpoint strings remain inert report text. Validate external-open messages again
in the extension before calling `vscode.env.openExternal`; webview-side validation alone is insufficient.
This scheme validation does not establish host trust and must not be used as an authenticated-request or
Cloud Shell endpoint policy. Preserve loopback preview servers and remote port-forwarded HTTP(S) URLs.

### Static UI previews

The preview reader transports `.azure/.preview-temp/*.html` and `theme.css` as untrusted text.
`UiPreviewCard` must call `preparePreviewHtml` immediately before assigning iframe `srcDoc`. That
browser-only helper uses a separate DOMPurify instance, preserving static HTML, inline SVG icons and
styles while removing scripts, event handlers, document redirects, embedded browsing contexts and
navigation/submission attributes. Do not replace it with regular-expression HTML filtering.

Rewrite links on parsed elements: only known sibling `<slug>.html` pages become host-driven navigation;
fragment anchors remain local and all other anchors are inert. Ignore author-supplied navigation data
attributes. Cancel default navigation for every preview anchor, including `href="#"`: a `srcDoc`
document inherits its parent webview's base URL, so native fragment navigation can load the parent URL
and blank the iframe. Trusted host code switches pages or scrolls to local fragment targets instead.
Inline only the shared `theme.css` stylesheet and remove other stylesheet links. Encode the opening `<`
of every case-insensitive `</style` sequence in CSS raw text so a stylesheet cannot close its `<style>`
element during HTML serialization and reparsing. Preserve other `<` characters, including CSS range-query
operators. Accept only color custom-property names and 3-, 4-, 6- or 8-digit hex values for palette
overrides. Sanitize the assembled markup again with empty, sanitizer-created theme style placeholders;
only then insert the encoded theme text into those placeholders. Do not disable DOMPurify's XML safety
checks to preserve CSS containing markup-like strings or comments.

Preserve `sandbox="allow-same-origin"` without script, form, popup or top-navigation permissions. The
same-origin permission lets trusted host code handle page switching; it must never be combined with
script permission. Prepend a trusted iframe CSP (`default-src 'none'`, no scripts or form submission,
inline styles and data-only images/fonts) in addition to the parent webview's existing CSP. This keeps
CSS imports, remote assets and other preview network requests blocked. Do not weaken either policy
to display workspace content.

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
