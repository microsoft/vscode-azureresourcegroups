FROM mcr.microsoft.com/devcontainers/javascript-node:22-bookworm@sha256:33cc368bc8ce9dac872703c7b9ebf6dabcc7b14bbb8cfd2b64be0e7232e3a361

ARG AZURE_CLI_VERSION=2.91.0-1~bookworm
ARG FUNCTIONS_CORE_TOOLS_VERSION=4.16.0

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        dnsutils \
        netcat-openbsd \
        postgresql-client \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc \
        | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg \
    && chmod go+r /etc/apt/keyrings/microsoft.gpg \
    && printf '%s\n' \
        'Types: deb' \
        'URIs: https://packages.microsoft.com/repos/azure-cli/' \
        'Suites: bookworm' \
        'Components: main' \
        'Architectures: amd64 arm64' \
        'Signed-By: /etc/apt/keyrings/microsoft.gpg' \
        > /etc/apt/sources.list.d/azure-cli.sources \
    && apt-get update \
    && apt-get install --yes --no-install-recommends "azure-cli=${AZURE_CLI_VERSION}" \
    && npm install --global \
        "azure-functions-core-tools@${FUNCTIONS_CORE_TOOLS_VERSION}" \
        --unsafe-perm true \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspaces/copilot-on-rails-sandbox

COPY scripts/dev-entrypoint.sh /usr/local/bin/cor-sandbox-entrypoint

RUN chmod +x /usr/local/bin/cor-sandbox-entrypoint \
    && mkdir -p /workspaces/copilot-on-rails-sandbox/node_modules \
    && chown -R node:node /workspaces/copilot-on-rails-sandbox

USER node

ENTRYPOINT ["/usr/local/bin/cor-sandbox-entrypoint"]
CMD ["sleep", "infinity"]
