# Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
#
# The Ambivo dev container: Node, Claude Code, Chromium and the ambivo-devkit plugin, ready to build apps
# on the Ambivo API. Build it from the root of this repository:
#
#   docker build -f container/Dockerfile -t ambivo-devkit .
#
# Run it from the folder your apps live in (the README has the Windows form):
#
#   docker run -it --rm -p 127.0.0.1:4200:4200 -v ambivo-devkit-home:/home/node/.claude -v "$PWD":/work ambivo-devkit
FROM node:22-bookworm-slim

# chromium: Claude looks at the screens it builds (plugin scripts/ambivo-screenshot.mjs), headless.
# poppler-utils: Claude Code reads a PDF brief with pdftoppm. tini: passes Ctrl+C on and reaps processes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git zip unzip ca-certificates procps less poppler-utils \
      chromium fonts-liberation tini \
 && rm -rf /var/lib/apt/lists/*

ARG CLAUDE_CODE_VERSION=2.1.288
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

# The plugin marketplace, read-only: Claude Code installs the plugin from this folder, with no network.
COPY .claude-plugin /opt/ambivo-devkit/.claude-plugin
COPY plugins /opt/ambivo-devkit/plugins
COPY container/CLAUDE.md /opt/ambivo-devkit/container/CLAUDE.md
COPY container/ambivo-start /usr/local/bin/ambivo-start
RUN chmod 0755 /usr/local/bin/ambivo-start && chmod -R a-w /opt/ambivo-devkit \
 && mkdir -p /work && chown node:node /work

# Everything that must survive a new container lives in one folder, so one volume keeps it: Claude Code's
# sign-in and sessions (CLAUDE_CONFIG_DIR), the plugin, and the Ambivo sandbox sign-in (XDG_CONFIG_HOME).
ENV CLAUDE_CONFIG_DIR=/home/node/.claude \
    XDG_CONFIG_HOME=/home/node/.claude/config \
    CHROMIUM=/usr/bin/chromium \
    DISABLE_AUTOUPDATER=1 \
    AMBIVO_DEV_CONTAINER=1

# The node user (uid 1000) owns files written to /work, which is a folder on your computer.
# ambivo-start installs the plugin from /opt/ambivo-devkit on the first start, with no network. Not at
# build time: Claude Code crashes (exit 139) under the emulation a cross-platform build uses.
USER node
RUN mkdir -p /home/node/.claude

WORKDIR /work
EXPOSE 4200
ENTRYPOINT ["tini", "--", "ambivo-start"]
