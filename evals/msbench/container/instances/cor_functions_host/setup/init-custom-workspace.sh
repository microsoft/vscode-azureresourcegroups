#!/usr/bin/env bash
# Runs at IMAGE BUILD time, before the workspace directory is copied in.
#
# Everything installed here is baked into the image, so it costs nothing per run.
# That is the entire reason this file exists: the preamble route we tried first
# (config/phases/local.yaml installing func with npm) failed in the MSBench
# container with `npm error code E401 - Unable to authenticate`, because that
# container's npm resolves through a registry the run holds no token for.
#
# Here we are on a clean Ubuntu with the public package feeds, during a build we
# control, so the same install has none of that problem.
#
# -- Why func -------------------------------------------------------------------
#
# Every Copilot-on-Rails stimulus is an Azure Functions project, and all five
# runtime-* gates stand down without the Core Tools host: detectFunctionsProject
# in evals/src/runtime/runtimeTarget.ts returns
# notApplicable('functionsHostUnavailable') when `func` is not on PATH, so those
# gates have been red on every run since they were written.
#
# Deliberately NOT installed yet: a PostgreSQL server. `runtime-crud` needs one,
# and `datastoreRequiresContainer` is the reason code for its absence, but a
# database also has to be *running* while the agent works, and this script only
# runs at build time. Starting it needs a decision about the container's single
# entrypoint, which is worth making separately from proving that a custom image
# works at all. One change, one question.

set -euo pipefail

echo "==> Installing Azure Functions Core Tools v4"

# The Microsoft apt feed rather than npm. The npm package is a ~40 KB stub whose
# postinstall downloads the real binary from a CDN at install time, which adds a
# second network dependency and a second way to fail quietly - npm can exit 0
# while leaving nothing on PATH. The apt package carries the binary itself.
apt-get update
apt-get install -y --no-install-recommends gnupg ca-certificates curl

curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
    | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg

# 22.04 / jammy is the base image's release, hardcoded rather than derived: a
# wrong-but-plausible codename resolves to a feed that 404s during install
# instead of failing here, where the cause is obvious.
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/ubuntu/22.04/prod jammy main" \
    > /etc/apt/sources.list.d/microsoft-prod.list

apt-get update
apt-get install -y --no-install-recommends azure-functions-core-tools-4
rm -rf /var/lib/apt/lists/*

# Assert rather than assume. A build that "succeeded" while leaving func off PATH
# would produce an image indistinguishable from the one we already have, and the
# only symptom would be five gates still reporting functionsHostUnavailable -
# after a push, a dataset edit and a paid run.
if ! command -v func >/dev/null 2>&1; then
    echo "FATAL: azure-functions-core-tools-4 installed but 'func' is not on PATH" >&2
    exit 1
fi

echo "==> func $(func --version 2>&1 | tail -1) is on PATH at $(command -v func)"
