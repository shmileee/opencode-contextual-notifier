#!/usr/bin/env bash

set -u

[ -n "${TMUX:-}" ] || exit 0
command -v tmux >/dev/null 2>&1 || exit 0

MARKER="$(tmux show-option -gqv @opencode-notifier-marker 2>/dev/null)"
[ -n "$MARKER" ] || tmux set-option -gq @opencode-notifier-marker "●"

MARKER_SEGMENT='#{?@opencode_waiting,#{@opencode_waiting} ,}'

prepend_marker() {
	local option_name="$1"
	local current
	current="$(tmux show-window-options -gv "$option_name" 2>/dev/null)"
	case "$current" in
	*'#{@opencode_waiting}'*) ;;
	*) tmux set-window-option -g "$option_name" "${MARKER_SEGMENT}${current}" ;;
	esac
}

prepend_marker window-status-format
prepend_marker window-status-current-format

STATUS_RIGHT="$(tmux show-option -gv status-right 2>/dev/null)"
case "$STATUS_RIGHT" in
"${MARKER_SEGMENT}"*) tmux set-option -g status-right "${STATUS_RIGHT#"$MARKER_SEGMENT"}" ;;
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
