# OpenCode Contextual Notifier

Context-aware macOS notifications and tmux attention markers for OpenCode.

```text
OpenCode event
     │
     ▼
Filter child sessions, unfinished work, and duplicate events
     │
     ├── tmux helper → set ● and read "5: ha"
     │
     └── macOS → one sound-bearing contextual notification
```

## Features

- Notifies for completed work, questions, permissions, plan review, and errors.
- Includes the project, session title, latest prompt, and latest result.
- Prefixes notifications with the originating tmux window, such as `5: ha`.
- Leaves `●` on the waiting tmux window and clears it when you return.
- Ignores child sessions, unfinished todos, active continuation work, duplicate idle events,
  stale async work, and repeated updates for the same user message.
- Works without tmux; macOS notifications continue without the window label or marker.
- Sends no telemetry.

## Requirements

- OpenCode with the stable community plugin API (`plugin` in `opencode.json`).
- macOS for Notification Center delivery.
- tmux 3.2 or newer for the optional marker integration.
- TPM for the easiest tmux installation.

## Install the OpenCode plugin

Add the npm package to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-contextual-notifier"]
}
```

OpenCode installs npm plugins with Bun on the next startup. Quit and restart every running
OpenCode process after changing the configuration.

### Choose another sound

Use OpenCode's plugin tuple form:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [["opencode-contextual-notifier", { "sound": "Glass" }]]
}
```

The default sound is `Submarine`.

## Install the tmux companion

Add the plugin before the TPM loader at the bottom of `~/.tmux.conf`:

```tmux
set -g @plugin "shmileee/opencode-contextual-notifier"

run "~/.tmux/plugins/tpm/tpm"
```

Press `prefix` + <kbd>I</kbd> to install it. The companion:

- prepends the waiting marker to `status-right` once;
- preserves existing status content and hooks;
- clears the marker on window selection or client focus;
- exposes `@opencode-notifier-marker` for customization.

Example marker customization:

```tmux
set -g @opencode-notifier-marker "!"
```

Without TPM, clone the repository and source the entrypoint:

```tmux
run-shell "/absolute/path/opencode-contextual-notifier/opencode-contextual-notifier.tmux"
```

Reload tmux configuration after installation. Do not restart the tmux server.

## Oh My OpenAgent users

Oh My OpenAgent includes its own session notification hook. Disable that hook to avoid duplicate
macOS notifications:

```json
{
  "disabled_hooks": ["session-notification"]
}
```

Put this in your active `oh-my-openagent.json[c]` or `oh-my-opencode.json[c]` configuration and
restart OpenCode.

## Install from source

```bash
git clone https://github.com/shmileee/opencode-contextual-notifier.git
cd opencode-contextual-notifier
bun install
bun run check
bun run build
```

Load the built plugin with an absolute file URL while developing:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/opencode-contextual-notifier/dist/index.mjs"]
}
```

## Development

```bash
bun run check
bun run build
bun pm pack
```

Tests use UUID-scoped tmux sockets and never touch the live tmux server.

## License

MIT
