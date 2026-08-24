#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/opencode-notifier-e2e.XXXXXX")"
IMAGE="opencode-contextual-notifier-e2e:$PPID-$$-$RANDOM"

cleanup() {
	docker image rm --force "$IMAGE" >/dev/null 2>&1 || true
	rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || {
	printf '%s\n' "Docker is required for the container E2E test" >&2
	exit 1
}

cd "$ROOT"
bun run build
bun pm pack --ignore-scripts --destination "$TEMP_ROOT" >/dev/null
ARTIFACT="$(printf '%s\n' "$TEMP_ROOT"/*.tgz)"
[ -f "$ARTIFACT" ] || {
	printf '%s\n' "bun pm pack did not produce a tarball" >&2
	exit 1
}

OPENCODE_VERSION="$(bun -e '
  import packageJson from "./package.json"
  const specifier = packageJson.devDependencies["@opencode-ai/plugin"]
  process.stdout.write(specifier.replace(/^[~^]/, ""))
')"

docker build \
	--build-arg "OPENCODE_VERSION=$OPENCODE_VERSION" \
	--file "$ROOT/test/e2e/Dockerfile" \
	--tag "$IMAGE" \
	"$ROOT"

docker run --rm --volume "$ARTIFACT:/artifact/plugin.tgz:ro" "$IMAGE"
