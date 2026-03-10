---
applyTo: "*"
---

# Package Upgrade PR Instructions

When upgrading a dependency package version and opening a PR, always follow this process:

## Steps

1. **Identify the current and target versions** from `package.json`.
2. **Research what changed** between the two versions:
   - Check the package's GitHub repository for commits/PRs between the two versions.
   - Use npm publish timestamps to identify the date range, then find relevant commits.
   - Focus on bug fixes, new features, and breaking changes.
3. **Update `package.json`** with the new version.
4. **Run `npm install`** (or `npm install --package-lock-only`) to update `package-lock.json`.
5. **Create a branch** named `alex/upgrade-<package-short-name>-<version>`.
6. **Commit and push** the changes.
7. **Open a PR** with a well-structured description (see format below).

## PR Description Format

The PR description must include:

```markdown
Updates `<package-name>` from `<old-version>` to `<new-version>`.

## Bug fixes included in this upgrade

- **<Short title>** ([<repo>#<pr-number>](<pr-url>)) — <Description of what was broken and how it's fixed.>

## Other changes

- **<Short title>** ([<repo>#<pr-number>](<pr-url>)) — <Brief description.>
```

### Rules for the description:
- Always separate **bug fixes** from **other changes** (improvements, refactors, dependency bumps).
- Link to the upstream PRs that introduced each change.
- If a bug fix resolves a known issue in this repo, link to it (e.g., "Fixes #123").
- Skip internal-only changes like CI updates, dependency bumps within the upstream package, or trivial refactors that don't affect consumers.
- Write descriptions from the consumer's perspective — explain the impact, not the implementation.
