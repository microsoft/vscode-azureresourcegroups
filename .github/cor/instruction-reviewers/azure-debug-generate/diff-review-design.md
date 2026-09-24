# CoR debug-generate diff review

Temporary design note for draft #1915. This can be moved into the PR description
and removed before merge.

## The failure

The [#1892 review run](https://github.com/microsoft/vscode-azureresourcegroups/actions/runs/35893034848)
returned `INCOMPLETE`. The PR changed 61 files, 21 in the reviewer's scope.
GitHub supplied a roughly 27 KB patch for `generate.md`, but the agent could not
receive the complete old-side change. Its full head-file read worked, which
made this easy to mistake for a complete review. The existing completeness
rule correctly stopped it instead of treating new-side content as proof of
what changed.

## Limits we ran into

- `pull_request_read(get_files)` for the whole PR and `get_diff` both exceeded
  the MCP response limit. Paginating `get_files` retrieved most filenames, but
  each entry still included its entire patch. Individual 23-35 KB results
  spilled to temporary files that the reviewer, which has no shell, could not
  open. A `get_commit` fallback also spilled at roughly 28 KB. Smaller pages
  cannot split an individual patch.
- `get_file_contents` returns a file, not a byte range. Reading the new file
  does not recover removed lines. Reading the base-tip file is not always the
  PR's old side either: the PR compares its head to the **merge base**. Large
  full-file reads can themselves exceed the tool's usable output size.
- An early local HTTP reader created an unauthenticated endpoint, so we
  replaced it with stdio. Giving that reader a GitHub token to fetch patches
  would put credentials in a process serving PR-controlled requests with
  network access. We instead moved GitHub reads into trusted Actions steps
  and kept the stdio reader offline and token-free.
- That first token-free design staged GitHub's PR-file pages and an immutable
  compare response. It solved #1892, but the compare response contains at
  most 300 files. For a scoped change beyond that position, the reader could
  not cross-check its patch even though the PR remained within the existing
  3,000-file PR limit. It correctly returned `INCOMPLETE` rather than
  pretending the later patch was verified.
- Checking out the PR head for the **agent** would make new files accessible,
  not the merge-base diff. Adding general shell access would let it use Git
  and read bounded output, but would also let instructions embedded in PR
  files steer command execution. Isolation without a token or outbound
  network might make that design viable; we did not implement or test those
  controls. It is not the same as a checkout in a trusted pre-agent step.

## Decision

Keep the reviewer at `checkout: false`, `tools.bash: []`, and `cli-proxy: false`.
Trusted workflow steps check that the open PR is from the same repository and
still at the recorded base and head SHAs. They check out the exact head commit
with `fetch-depth: 0` so the merge base is available, and
`persist-credentials: false` so checkout does not leave its token in Git
configuration. The steps compare that merge base to the head with Git.

Git produces the complete NUL-delimited file listing, including renames and
deletions; the step reconciles its count with the PR's `changed_files`. Only
scoped files get patches in the snapshot. For those, Git compares the old and
new blob IDs rather than passing an untrusted filename to a shell command.
The step disables external diffs and text conversion and removes the PR
checkout before the agent starts. The reader and reviewer instructions come
from the workflow commit, which is the base workflow for
`pull_request_target`, not from files in the PR checkout.

The `read_pr_diff` stdio tool reads the staged snapshot from a read-only mount
with `--network none` and no GitHub token. It paginates metadata and returns
scoped UTF-8 patches as bounded chunks with offsets, byte totals, and SHA-256
digests. It checks file counts, the recorded PR states and SHAs, patch
checksums, hunk lengths, and addition/deletion counts. The reviewer must
traverse every page and chunk, check that the identities and offsets agree,
and return `INCOMPLETE` on missing or inconsistent evidence.

This is more staging code than the API snapshot. The gain is coverage of
scoped files past position 300 without giving the agent a general shell or
giving the reader a network-capable token.

## Trust and remaining limits

`pull_request_target` runs trusted workflow code with GitHub credentials, so
the same-repository and permitted-actor gates still matter. The pinned
checkout and Git commands run **before** the agent. They do not intentionally
execute PR scripts, and the Git commands disable hooks, external diffs,
text conversion, and the runner's global Git configuration. The agent
receives PR content as evidence only. Its GitHub MCP
tools remain read-only, and safe outputs can post a COMMENT review or
diagnostic comment, not approve or modify the PR. The trusted steps and
existing GitHub tools still need their tokens; "token-free" applies only to
the custom reader. A checkout with credentials persisted, PR-controlled
scripts executed, or general agent shell access would change this assessment.

- Git and GitHub can choose different hunk boundaries. For #1892, Git's
  `generate.md` patch was 27,371 bytes and GitHub's REST patch was 27,275.
  The verified contract is the pinned Git merge-base comparison, not
  byte-for-byte equality with GitHub's patch text.
- The reader's MCP envelope is limited to 7,000 bytes per response. It uses
  UTF-8 byte offsets, adjusts chunks to character boundaries, and errors
  rather than returning a silently shortened patch. An oversized filename
  can also make a metadata response impossible.
- Git commands are limited to 18 MiB of output and the staged snapshot to
  16 MiB. Fetching full history for the merge base costs time and bandwidth.
  Scoped binary files, symlinks and other unsupported Git object types,
  invalid UTF-8, missing commits or a non-unique merge base do not become
  successful text reviews.
- A PR with more than 3,000 changed files is outside the existing file-list
  limit. A GitHub/Git rename-count mismatch, a moved or closed PR, stale
  SHAs, tool errors, inaccessible head files, or exhausted agent time/tool
  budget also prevents a complete review. The reviewer checks PR state
  again before posting; as with any remote check, a change after that check
  can still race publication. Its verdict records the reviewed head SHA.
- Removing the checkout before agent execution also means the reviewer must
  read proposed file content through the read-only GitHub tool at the pinned
  head SHA. If a required full file is too large for that tool, it must
  return `INCOMPLETE`; bounded diffs do not silently waive missing context.

These cases fail closed as `INCOMPLETE` when the agent can run, or fail the
workflow if preparation itself cannot run. They are not treated as PASS.

## Hosted runtime constraints

The reader also needs a working MCP gateway and Copilot runtime. An earlier
gateway could not list MCP tools; upgrading gh-aw brought gateway v0.4.25 but
also upgraded Copilot CLI to 1.0.85. That combination failed with a
[zero-token 400](https://github.com/microsoft/vscode-azureresourcegroups/actions/runs/35790339047).
Pinning the CLI back to 1.0.80 while using AWF v0.28.20 also
[failed](https://github.com/microsoft/vscode-azureresourcegroups/actions/runs/35792449603).
The workflow therefore keeps the tested CLI 1.0.80 and AWF v0.28.14 pins
while gh-aw supplies gateway v0.4.25. These pins address hosted runtime
failures, not the patch-size problem; change them only after another hosted
review succeeds.

## Verification

The [hosted test run](https://github.com/microsoft/vscode-azureresourcegroups/actions/runs/35940916817)
reviewed a temporary `generate.md` patch whose GitHub REST patch was 37,713
bytes. The agent traversed seven bounded diff calls, submitted a PASS review,
and the checkout cleanup succeeded. The temporary patch and branch dispatch
gate were removed afterward. Local tests listed all 61 files from #1892 and
reconstructed its scoped Git patch in five chunks. They also covered a scoped
file after position 300, renames, deletions, additions, mode-only changes,
binary rejection, unusual paths, stale SHAs, and missing or truncated data.
The final branch passed strict gh-aw compilation and validation with
actionlint and shellcheck, plus its draft PR's build and API checks.
