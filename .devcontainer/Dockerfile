# Development image for app-control-pediatrico.
# Toolchain lives here, not on the host: Node 24 + pnpm, Python 3 + uv (ui-ux-pro-max),
# PostgreSQL 18 client, OpenCode, GitHub CLI. Playwright browsers are installed in postCreate.
# Runs as root on purpose: the dev host user is root, so bind-mounted files keep the same owner.
FROM mcr.microsoft.com/devcontainers/base:debian

ARG NODE_MAJOR=24
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg git jq unzip \
      python3 python3-venv postgresql-common \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs postgresql-client-18 gh \
 && rm -rf /var/lib/apt/lists/*

# uv / uvx (Python tooling)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# pnpm via corepack, OpenCode CLI
RUN corepack enable \
 && npm install -g opencode-ai \
 && npm cache clean --force

