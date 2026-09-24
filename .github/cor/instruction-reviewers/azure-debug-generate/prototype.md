# Staged PR review prototype

The workflow runs on the trusted base branch. Before the agent starts, a
GitHub API step checks that the PR is open and same-repository, pins its base
and head commits, and compares event SHAs on automatic runs. An
`actions/checkout` step fetches the exact head with full history into
`.review-head` without persisting credentials. It does not run PR files or
install their dependencies.

With `checkout: false`, gh-aw does not check out the repository in the agent
job. An explicit sparse checkout fetches only the reviewer helpers from the
workflow's pinned commit (`main` for normal PR and comment runs) into
the workspace root. The scripts are copied to runner temp before the separate
PR-head checkout and before inference. A branch-scoped `workflow_dispatch`
used for this prototype deliberately fetches helpers from that test branch;
remove the temporary dispatch exception before relying on the default-branch
trust boundary.

`stage-review.mjs` computes the merge base, gets a NUL-delimited Git file
listing, and checks its count against the PR API's `changed_files`. It stages
one Git patch per scoped file, including deletions and either side of a
rename. It also stages proposed head content for non-deleted scoped files.
The agent has no bash or edit tool. Its offline stdio reader runs in a pinned
Node container with read-only mounts for the trusted reader source and
staged bundle. Only the two reader tools and read-only GitHub tools are
available alongside COMMENT-only safe outputs.

The stage fails before inference if the checkout or file count differs from
the pinned identity, history is missing, any scoped patch is absent, or
content is binary, non-UTF-8, or an unsupported file type. It also rejects
more than 3,000 changed files, files or patches above 4 MiB each, and more
than 32 MiB of combined scoped patch and head content. The reader returns up to 50 listing entries within an 8,192-byte metadata
page, or at most 8,192 UTF-8 bytes of a patch or head file per call. A failed
or incomplete read must never become a PASS.

Run the local fixture tests:

```sh
node --test .github/cor/instruction-reviewers/azure-debug-generate/review-reader.test.mjs
```

For the historical #1892 replay, the local Git repository must contain
commits `5a564544ee12d00fc276effdc2f26c611e85a754` and
`90e65bd6af6f0abe86794bb61455fc1ceb371e9b`. Docker must have the pinned
`gh-aw-node` image. The test clones locally, stages all 61 changed files,
then reads every scoped patch through the actual containerized MCP stdio
protocol, without using Git, network access, or a token in the reader:

```sh
REPLAY_PR_1892=1 node --test .github/cor/instruction-reviewers/azure-debug-generate/review-reader.test.mjs
gh aw validate cor-debug-generate-review
```

The replay's local shared clone is not a measure of Actions' remote
full-history fetch time. Compilation and local protocol tests do not prove
that the hosted gateway can launch the reader or that a live review can
finish inside the workflow timeout. Do not run this prototype against a
live PR until the base-branch lock file and gateway mounts are reviewed.
