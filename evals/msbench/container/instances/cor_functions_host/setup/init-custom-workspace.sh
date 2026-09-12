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
# Deliberately NOT installed here: nothing. An earlier version of this file stopped
# at `func` and said a PostgreSQL server was out of reach because "a database also
# has to be *running* while the agent works, and this script only runs at build
# time". The first half is right and the second is a build-time/run-time split, not
# a wall: the phase preamble in `config/phases/local.yaml` runs inside the container
# before the agent starts, which is exactly where a service gets started.
#
# So this script installs, and the preamble starts. Neither emulator needs Docker,
# which is what made `datastoreRequiresContainer` look like a closed door.

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

# ── Datastore emulators ───────────────────────────────────────────────────────
#
# The runtime gates can start an app; what they could not do until now is watch it
# talk to anything. `runtime-crud` stood down with `datastoreRequiresContainer` on
# every Azure-shaped project, and the reason code was derived from the absence of
# Docker rather than from anyone checking whether a datastore could be had another
# way. It can: neither of these needs a container.
#
# Azurite is an npm package, not an image. `npm root -g` resolves to a writable
# path here (/opt/nvm/.../lib/node_modules), and this build runs against the public
# registry, so the E401 that kills the runtime `func` install does not apply.
#
# PostgreSQL is an apt package with a local cluster. Ubuntu 22.04 ships 14.
#
# Both are INSTALLED here and STARTED at run time by the phase preamble in
# config/phases/local.yaml, because this script only ever runs at image build time
# and a database that is not running is no more useful than one that is absent.
echo "==> Installing Azurite (Azure Storage emulator)"
. /opt/nvm/nvm.sh
nvm use 22 >/dev/null
npm install -g azurite

if ! command -v azurite >/dev/null 2>&1; then
    echo "FATAL: azurite installed but is not on PATH" >&2
    exit 1
fi
echo "==> azurite $(azurite --version 2>&1 | tail -1) at $(command -v azurite)"

echo "==> Installing PostgreSQL"
apt-get update
apt-get install -y --no-install-recommends postgresql postgresql-client
rm -rf /var/lib/apt/lists/*

if ! command -v psql >/dev/null 2>&1; then
    echo "FATAL: postgresql installed but psql is not on PATH" >&2
    exit 1
fi
echo "==> psql $(psql --version 2>&1 | tail -1)"

# The cluster is created by the package but owned by root-only paths that the
# runtime start would fail on. Fixing ownership here keeps the run-time preamble to
# a single start command with nothing to diagnose.
PG_VERSION="$(ls /etc/postgresql 2>/dev/null | head -1)"
if [ -z "$PG_VERSION" ]; then
    echo "FATAL: postgresql installed but no cluster under /etc/postgresql" >&2
    exit 1
fi
echo "==> PostgreSQL cluster version ${PG_VERSION}"
chown -R postgres:postgres "/var/lib/postgresql" "/etc/postgresql" "/var/log/postgresql"
echo "$PG_VERSION" > /etc/cor-pg-version
