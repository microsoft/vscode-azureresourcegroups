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
  not the merge-base diff. Adding general shell access would let it use Git,
  but would also let instructions embedded in PR files steer command
  execution. The selected design instead wraps fixed Git operations in the
  existing MCP tool, without giving the agent a shell.

## Decision

Keep the reviewer at `checkout: false`, `tools.bash: []`, and `cli-proxy: false`.
Trusted workflow steps check that the open PR is from the same repository and
still at the recorded base and head SHAs. They check out the exact head commit
with `fetch-depth: 0` so the merge base is available, and
`persist-credentials: false` so checkout does not leave its token in Git
configuration. They record PR metadata and prepare an empty Git blob for
additions and deletions, then move the checkout out of the agent workspace
into runner temporary storage. The reader receives it through a read-only
container mount.

Inside the isolated MCP container, Git produces a complete NUL-delimited
file listing, including renames and deletions. The reader reconciles its
count with the PR's `changed_files`, then computes a patch only when asked
for a scoped file. It compares the old and new blob IDs rather than passing
an untrusted filename to Git. The reader and reviewer instructions come
from the workflow commit, which is the base workflow for
`pull_request_target`, not from files in the PR checkout.

The `read_pr_diff` stdio tool has no GitHub token or network access. Its
container has a read-only filesystem, no Linux capabilities, no new
privileges, and read-only mounts for the checkout and PR identity. It
paginates metadata and returns scoped UTF-8 patches as bounded chunks with
offsets, byte totals, and SHA-256 digests. It checks the recorded PR states
and SHAs, full file count, Git hunk lengths, and addition/deletion counts.
The reviewer must traverse every page and chunk, check that identities,
offsets, and digests agree, and return `INCOMPLETE` on missing evidence.

Compared with staging full patches in Actions, this keeps Git parsing and
bounded output in one module while retaining coverage of scoped files past
position 300. The agent still has no general shell, and the reader has no
network-capable token.

## Trust and remaining limits

`pull_request_target` runs trusted workflow code with GitHub credentials, so
the same-repository and permitted-actor gates still matter. The pinned
checkout runs **before** the agent. Its Git objects stay outside the agent
workspace and mount read-only into the offline MCP container. The reader
invokes a fixed set of Git commands with validated SHA arguments, disabled
hooks, external diffs, text conversion, and system/global Git configuration.
It does not execute PR scripts or accept commands from the agent. The agent
receives PR content as evidence only. Its GitHub MCP
tools remain read-only, and safe outputs can post a COMMENT review or
diagnostic comment, not approve or modify the PR. The trusted steps and
existing GitHub tools still need their tokens; "token-free" applies only to
the custom reader. A checkout with credentials persisted, PR-controlled
scripts executed, a writable mount, or general agent shell access would
change this assessment.

- Git and GitHub can choose different hunk boundaries. For #1892, Git's
  `generate.md` patch was 27,371 bytes and GitHub's REST patch was 27,275.
  The verified contract is the pinned Git merge-base comparison, not
  byte-for-byte equality with GitHub's patch text.
- The reader's MCP envelope is limited to 7,000 bytes per response. It uses
  UTF-8 byte offsets, adjusts chunks to character boundaries, and errors
  rather than returning a silently shortened patch. An oversized filename
  can also make a metadata response impossible.
- Git commands are limited to 18 MiB of output per call. Fetching full history
  for the merge base costs time and bandwidth. The pinned container image
  must include Git; its version and behavior must be rechecked on upgrades.
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
bytes. That run proved the earlier Git-staging version could traverse seven
bounded calls and submit a PASS review; it does **not** test the new Git-backed
MCP container. Local tests of the new reader listed all 61 files from #1892
and reconstructed its scoped Git patch in five chunks. They also covered a
scoped file after position 300, renames, deletions, additions, mode-only
changes, binary rejection, unusual paths, stale SHAs, and mismatched counts.
An offline, read-only container test checked its Git mount and MCP response.
The new workflow still needs a hosted review before this version is proven.
