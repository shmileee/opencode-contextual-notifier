FROM oven/bun:1.3.14-alpine

ARG OPENCODE_VERSION

USER root

RUN test -n "$OPENCODE_VERSION" \
  && apk add --no-cache bash jq procps tmux \
  && bun add --global "opencode-ai@$OPENCODE_VERSION" \
  && opencode --version

COPY test/e2e/services.ts /opt/e2e/services.ts
COPY test/e2e/container-tmux.sh /usr/local/bin/container-tmux-e2e

RUN chmod +x /usr/local/bin/container-tmux-e2e

ENTRYPOINT ["/usr/local/bin/container-tmux-e2e"]
