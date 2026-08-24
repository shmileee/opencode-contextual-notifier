import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

const helper = join(import.meta.dir, "..", "scripts", "opencode-notifier-tmux")
const plugin = join(import.meta.dir, "..", "opencode-contextual-notifier.tmux")
const resources: Array<{ readonly session: string; readonly socket: string }> = []

type ProcessResult = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

async function runProcess(
  command: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): Promise<ProcessResult> {
  const process = Bun.spawn([...command], {
    env: { ...Bun.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { exitCode, stderr, stdout }
}

async function runTmux(socket: string, args: readonly string[]): Promise<string> {
  const result = await runProcess(["tmux", "-L", socket, ...args])
  expect(result.exitCode, result.stderr).toBe(0)
  return result.stdout.trim()
}

async function createTmux(): Promise<{
  readonly environment: Readonly<Record<string, string>>
  readonly paneID: string
  readonly session: string
  readonly socket: string
}> {
  const suffix = crypto.randomUUID()
  const socket = `opencode-notifier-test-${suffix}`
  const session = `notifier-test-${suffix}`
  resources.push({ session, socket })
  await runTmux(socket, ["-f", "/dev/null", "new-session", "-d", "-s", session, "-n", "ha"])
  const paneID = await runTmux(socket, ["display-message", "-p", "-t", session, "#{pane_id}"])
  const tmux = await runTmux(socket, [
    "display-message",
    "-p",
    "-t",
    session,
    "#{socket_path},#{pid},0",
  ])
  return { environment: { TMUX: tmux, TMUX_PANE: paneID }, paneID, session, socket }
}

afterEach(async () => {
  await Promise.all(
    resources
      .splice(0)
      .map(({ session, socket }) =>
        runProcess(["tmux", "-L", socket, "kill-session", "-t", session]),
      ),
  )
})

describe("tmux helper", () => {
  test("sets, labels, and clears the originating window", async () => {
    // Given
    const tmux = await createTmux()

    // When
    const completion = await runProcess([helper, "complete"], tmux.environment)
    const label = await runProcess([helper, "window_label"], tmux.environment)

    // Then
    expect(completion.exitCode, completion.stderr).toBe(0)
    expect(label.stdout.trim()).toBe("0: ha")
    expect(
      await runTmux(tmux.socket, [
        "display-message",
        "-p",
        "-t",
        tmux.paneID,
        "#{@opencode_waiting}",
      ]),
    ).toBe("●")

    await runProcess([helper, "user_message"], tmux.environment)
    expect(
      await runTmux(tmux.socket, [
        "display-message",
        "-p",
        "-t",
        tmux.paneID,
        "#{@opencode_waiting}",
      ]),
    ).toBe("")
  })

  test("resolves the originating pane when TMUX_PANE is absent", async () => {
    // Given
    const tmux = await createTmux()
    const done = `done-${crypto.randomUUID()}`
    const release = `release-${crypto.randomUUID()}`
    const command = `env -u TMUX_PANE "${helper}" complete; tmux wait-for -S "${done}"; tmux wait-for "${release}"`
    const waiter = runTmux(tmux.socket, ["wait-for", done])

    // When
    await runTmux(tmux.socket, ["send-keys", "-t", tmux.session, "-l", command])
    await runTmux(tmux.socket, ["send-keys", "-t", tmux.session, "Enter"])
    await waiter

    // Then
    expect(
      await runTmux(tmux.socket, [
        "display-message",
        "-p",
        "-t",
        tmux.paneID,
        "#{@opencode_waiting}",
      ]),
    ).toBe("●")
    await runTmux(tmux.socket, ["wait-for", "-S", release])
  })
})

describe("TPM entrypoint", () => {
  test("renders the waiting marker on the origin after another window is selected", async () => {
    // Given
    const tmux = await createTmux()
    await runTmux(tmux.socket, ["set-window-option", "-g", "window-status-format", "WINDOW"])
    await runProcess([plugin], tmux.environment)
    await runTmux(tmux.socket, ["new-window", "-d", "-t", tmux.session, "-n", "other"])

    // When
    await runProcess([helper, "complete"], tmux.environment)
    await runTmux(tmux.socket, ["select-window", "-t", `${tmux.session}:other`])

    // Then
    expect(
      await runTmux(tmux.socket, [
        "display-message",
        "-p",
        "-t",
        tmux.paneID,
        "#{E:window-status-format}",
      ]),
    ).toContain("● WINDOW")
  })

  test("installs window rendering and clear hooks idempotently", async () => {
    // Given
    const tmux = await createTmux()
    await runTmux(tmux.socket, [
      "set-option",
      "-g",
      "status-right",
      "#{?@opencode_waiting,#{@opencode_waiting} ,}RIGHT",
    ])
    await runTmux(tmux.socket, ["set-window-option", "-g", "window-status-format", "WINDOW"])
    await runTmux(tmux.socket, [
      "set-window-option",
      "-g",
      "window-status-current-format",
      "CURRENT",
    ])
    await runTmux(tmux.socket, [
      "set-hook",
      "-g",
      "after-select-window",
      "set-option -g @existing-hook yes",
    ])

    // When
    await runProcess([plugin], tmux.environment)
    await runProcess([plugin], tmux.environment)

    // Then
    expect(await runTmux(tmux.socket, ["show-option", "-gv", "status-right"])).toBe("RIGHT")
    for (const [optionName, original] of [
      ["window-status-format", "WINDOW"],
      ["window-status-current-format", "CURRENT"],
    ] as const) {
      const format = await runTmux(tmux.socket, ["show-window-options", "-gv", optionName])
      expect(format.match(/#\{@opencode_waiting\}/g)).toHaveLength(1)
      expect(format).toContain(original)
    }
    const hook = await runTmux(tmux.socket, ["show-hooks", "-g", "after-select-window"])
    expect(hook).toContain("@existing-hook")
    expect(hook).toContain("@opencode_waiting")
  })
})
