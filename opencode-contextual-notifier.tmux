#!/usr/bin/env bash

set -u

[ -n "${TMUX:-}" ] || exit 0
command -v tmux >/dev/null 2>&1 || exit 0

MARKER="$(tmux show-option -gqv @opencode-notifier-marker 2>/dev/null)"
[ -n "$MARKER" ] || tmux set-option -gq @opencode-notifier-marker "●"

STATUS_SEGMENT='#{?@opencode_waiting,#{@opencode_waiting} ,}'
STATUS_RIGHT="$(tmux show-option -gv status-right 2>/dev/null)"
case "$STATUS_RIGHT" in
*'#{@opencode_waiting}'*) ;;
*) tmux set-option -g status-right "${STATUS_SEGMENT}${STATUS_RIGHT}" ;;
esac

append_hook() {
	local hook_name="$1"
	local hook_command="$2"
	local current
	current="$(tmux show-hooks -g "$hook_name" 2>/dev/null)"
	case "$current" in
	*"$hook_command"*) ;;
	*) tmux set-hook -ag "$hook_name" "$hook_command" ;;
	esac
}

CLEAR_MARKER='set-option -wq -u @opencode_waiting'
append_hook after-select-window "$CLEAR_MARKER"
append_hook session-window-changed "$CLEAR_MARKER"
append_hook client-focus-in "$CLEAR_MARKER"

exit 0
