#!/usr/bin/env bash

set -euo pipefail

ARTIFACT="/artifact/plugin.tgz"
ROOT="/tmp/opencode-notifier-e2e"
SOCKET="opencode-notifier-e2e"
SESSION="notifier-e2e"
SERVICES_PID=""

tmux_e2e() {
	tmux -u -L "$SOCKET" "$@"
}

event_seen() {
	local expected="$1"
	local event
	[ -f "$ROOT/helper-events.log" ] || return 1
	while IFS= read -r event; do
		[ "$event" = "$expected" ] && return 0
	done <"$ROOT/helper-events.log"
	return 1
}

fail() {
	printf 'container e2e failed: %s\n' "$1" >&2
	local log_file
	for log_file in "$ROOT/install.log" "$ROOT/config.log" "$ROOT/opencode.log" "$ROOT/pane.log" "$ROOT/helper-events.log"; do
		if [ -f "$log_file" ]; then
			printf '%s\n' "--- ${log_file##*/} ---" >&2
			while IFS= read -r line; do
				printf '%s\n' "$line" >&2
			done <"$log_file"
		fi
	done
	exit 1
}

cleanup() {
	tmux_e2e kill-server >/dev/null 2>&1 || true
	if [ -n "$SERVICES_PID" ]; then
		kill "$SERVICES_PID" >/dev/null 2>&1 || true
	fi
}
trap cleanup EXIT

[ -f "$ARTIFACT" ] || fail "packed plugin artifact is missing"

export HOME="$ROOT/home"
export XDG_CACHE_HOME="$ROOT/cache"
export XDG_CONFIG_HOME="$ROOT/config"
export XDG_DATA_HOME="$ROOT/data"
export XDG_STATE_HOME="$ROOT/state"
export NPM_CONFIG_REGISTRY="http://127.0.0.1:4873"

mkdir -p "$HOME" "$XDG_CONFIG_HOME/opencode" "$ROOT/project"
tar -xOf "$ARTIFACT" package/package.json >"$ROOT/package.json"
PACKAGE_NAME="$(jq -er '.name' "$ROOT/package.json")"
PACKAGE_VERSION="$(jq -er '.version' "$ROOT/package.json")"

coproc FIXTURE_SERVICES {
	bun /opt/e2e/services.ts "$ROOT/package.json" "$ARTIFACT"
}
read -r service_state <&"${FIXTURE_SERVICES[0]}"
SERVICES_PID="$FIXTURE_SERVICES_PID"
[ "$service_state" = "ready" ] || fail "fixture services did not become ready"

cat >"$XDG_CONFIG_HOME/opencode/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "e2e/deterministic",
  "small_model": "e2e/deterministic",
  "permission": "allow",
  "provider": {
    "e2e": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Deterministic E2E",
      "options": {
        "apiKey": "e2e",
        "baseURL": "http://127.0.0.1:8080/v1"
      },
      "models": {
        "deterministic": {
          "name": "Deterministic E2E"
        }
      }
    }
  }
}
JSON

if ! opencode plugin "$PACKAGE_NAME@$PACKAGE_VERSION" --global --force >"$ROOT/install.log" 2>&1; then
	fail "OpenCode plugin installation failed"
fi

INSTALLED_ROOT="$XDG_CACHE_HOME/opencode/packages/$PACKAGE_NAME@$PACKAGE_VERSION/node_modules/$PACKAGE_NAME"
[ -f "$INSTALLED_ROOT/dist/index.mjs" ] || fail "OpenCode did not install the packed plugin"
[ -x "$INSTALLED_ROOT/opencode-contextual-notifier.tmux" ] || fail "TPM entrypoint is not executable"
[ -x "$INSTALLED_ROOT/scripts/opencode-notifier-tmux" ] || fail "tmux helper is not executable"

REAL_HELPER="$INSTALLED_ROOT/scripts/opencode-notifier-tmux.real"
mv "$INSTALLED_ROOT/scripts/opencode-notifier-tmux" "$REAL_HELPER"
cat >"$INSTALLED_ROOT/scripts/opencode-notifier-tmux" <<'BASH'
#!/usr/bin/env bash
printf '%s\n' "${1:-}" >>/tmp/opencode-notifier-e2e/helper-events.log
exec "$(dirname -- "$0")/opencode-notifier-tmux.real" "$@"
BASH
chmod +x "$INSTALLED_ROOT/scripts/opencode-notifier-tmux"

if ! (cd "$ROOT/project" && opencode debug config) >"$ROOT/config.json" 2>"$ROOT/config.log"; then
	fail "OpenCode could not resolve the project configuration"
fi
if ! jq -e --arg spec "$PACKAGE_NAME@$PACKAGE_VERSION" '(.plugin // []) | index($spec) != null' "$ROOT/config.json" >/dev/null; then
	fail "OpenCode did not configure the installed plugin"
fi

tmux_e2e new-session -d -s "$SESSION" -n ha -c "$ROOT/project"
tmux_e2e new-window -d -t "$SESSION" -n work -c "$ROOT/project"
PANE_ID="$(tmux_e2e display-message -p -t "$SESSION:ha" '#{pane_id}')"

PANE_COMMAND="printf '%s' \"\$TMUX\" >$ROOT/tmux.env; printf '%s' \"\$TMUX_PANE\" >$ROOT/tmux-pane.env; $INSTALLED_ROOT/opencode-contextual-notifier.tmux && opencode --mini --no-replay --model e2e/deterministic --print-logs --log-level DEBUG 2>$ROOT/opencode.log"
tmux_e2e send-keys -t "$PANE_ID" -l "$PANE_COMMAND"
tmux_e2e send-keys -t "$PANE_ID" Enter

TUI_READY=""
for _ in $(seq 1 300); do
	if [ -f "$ROOT/opencode.log" ]; then
		LOG_CONTENT="$(<"$ROOT/opencode.log")"
		case "$LOG_CONTENT" in
		*'message="global event connected"'*)
			TUI_READY="yes"
			break
			;;
		esac
	fi
	sleep 0.1
done
if [ -z "$TUI_READY" ]; then
	tmux_e2e capture-pane -p -t "$PANE_ID" >"$ROOT/pane.log"
	fail "OpenCode TUI did not become ready"
fi

# Detached command clients can trigger clear hooks; assert installation, then isolate event-driven marker state.
for hook_name in after-select-window session-window-changed client-focus-in; do
	HOOK="$(tmux_e2e show-hooks -g "$hook_name")"
	case "$HOOK" in
	*'@opencode_waiting'*) ;;
	*) fail "TPM entrypoint did not install $hook_name" ;;
	esac
	tmux_e2e set-hook -gu "$hook_name"
done

TMUX_VALUE="$(<"$ROOT/tmux.env")"
PANE_ENV="$(<"$ROOT/tmux-pane.env")"
[ "$PANE_ENV" = "$PANE_ID" ] || fail "tmux pane environment does not match the target pane"

TMUX="$TMUX_VALUE" TMUX_PANE="$PANE_ID" "$INSTALLED_ROOT/scripts/opencode-notifier-tmux" complete
SEEDED_MARKER="$(tmux_e2e display-message -p -t "$PANE_ID" '#{@opencode_waiting}')"
[ "$SEEDED_MARKER" = "●" ] || fail "installed helper did not seed the tmux marker"
: >"$ROOT/helper-events.log"

tmux_e2e send-keys -t "$PANE_ID" -l "E2E_REQUEST"
tmux_e2e send-keys -t "$PANE_ID" Enter

USER_EVENT_CLEARED=""
for _ in $(seq 1 300); do
	CURRENT_MARKER="$(tmux_e2e display-message -p -t "$PANE_ID" '#{@opencode_waiting}')"
	if [ -z "$CURRENT_MARKER" ]; then
		USER_EVENT_CLEARED="yes"
		break
	fi
	sleep 0.1
done
if [ -z "$USER_EVENT_CLEARED" ]; then
	tmux_e2e capture-pane -p -t "$PANE_ID" >"$ROOT/pane.log"
	fail "user message did not clear the seeded marker"
fi
event_seen user_message || fail "OpenCode did not dispatch the user message marker event"

: >"$ROOT/model-release"
tmux_e2e select-window -t "$SESSION:work"

MARKER=""
for _ in $(seq 1 300); do
	MARKER="$(tmux_e2e display-message -p -t "$PANE_ID" '#{@opencode_waiting}')"
	[ "$MARKER" = "●" ] && break
	sleep 0.1
done
if [ "$MARKER" != "●" ]; then
	tmux_e2e capture-pane -p -t "$PANE_ID" >"$ROOT/pane.log"
	fail "completion did not set the tmux marker"
fi
ORIGIN_STATUS="$(tmux_e2e display-message -p -t "$PANE_ID" '#{E:window-status-format}')"
case "$ORIGIN_STATUS" in
*"●"*) ;;
*) fail "completion marker is not rendered on the non-current origin window" ;;
esac

[ -f "$ROOT/model-requested" ] || fail "OpenCode did not request a model completion"
[ -f "$ROOT/model-completed" ] || fail "the deterministic model did not complete successfully"
event_seen complete || fail "OpenCode did not dispatch the completion marker event"
if event_seen error; then
	fail "OpenCode dispatched an error marker event"
fi

for option_name in window-status-format window-status-current-format; do
	WINDOW_FORMAT="$(tmux_e2e show-window-options -gv "$option_name")"
	case "$WINDOW_FORMAT" in
	*'#{@opencode_waiting}'*) ;;
	*) fail "TPM entrypoint did not install marker rendering in $option_name" ;;
	esac
done

TMUX="$TMUX_VALUE" TMUX_PANE="$PANE_ID" "$INSTALLED_ROOT/scripts/opencode-notifier-tmux" user_message
CLEARED_MARKER="$(tmux_e2e display-message -p -t "$PANE_ID" '#{@opencode_waiting}')"
[ -z "$CLEARED_MARKER" ] || fail "installed helper did not clear the marker"

printf '%s\n' "container e2e passed: $PACKAGE_NAME@$PACKAGE_VERSION installed by OpenCode; marker set and cleared"
