import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { $ } from "bun"

import { ContextualNotifier } from "../src"

type Shell = PluginInput["$"]
type ShellExpression = Parameters<Shell>[1]
type Invocation = {
  readonly expressions: readonly ShellExpression[]
  readonly strings: TemplateStringsArray
}

const responseHeaders = { "Content-Type": "application/json" } as const

function createClient(): ReturnType<typeof createOpencodeClient> {
  return createOpencodeClient({
    baseUrl: "http://notifier.test",
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      if (path.endsWith("/todo")) {
        return new Response(JSON.stringify([{ status: "completed" }]), {
          headers: responseHeaders,
        })
      }
      if (path.endsWith("/message")) {
        return new Response(
          JSON.stringify([
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "hi" }],
            },
            {
              info: { role: "assistant" },
              parts: [{ type: "text", text: "Hello" }],
            },
          ]),
          { headers: responseHeaders },
        )
      }
      return new Response(JSON.stringify({ title: "Sound adapter" }), {
        headers: responseHeaders,
      })
    },
  })
}

function createShell(invocations: Invocation[], windowLabel: string): Shell {
  return Object.assign(
    (strings: TemplateStringsArray, ...expressions: ShellExpression[]) => {
      invocations.push({ expressions, strings })
      if (strings.some((part) => part.includes(" window_label"))) {
        return $`printf %s ${windowLabel}`
      }
      return $`true`
    },
    {
      braces: $.braces,
      escape: $.escape,
      env: $.env,
      cwd: $.cwd,
      nothrow: $.nothrow,
      throws: $.throws,
    },
  )
}

function createInput(invocations: Invocation[], windowLabel: string): PluginInput {
  return {
    client: createClient(),
    project: {
      id: "global",
      worktree: "/tmp",
      time: { created: 0 },
    },
    directory: "/tmp",
    worktree: "/tmp",
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://notifier.test"),
    $: createShell(invocations, windowLabel),
  }
}

async function deliverCompletion(
  invocations: Invocation[],
  windowLabel: string,
  options?: Record<string, unknown>,
): Promise<Invocation | undefined> {
  const hooks = await ContextualNotifier(createInput(invocations, windowLabel), options)
  await hooks.event?.({
    event: { type: "session.idle", properties: { sessionID: "main" } },
  })
  return invocations.find((invocation) => invocation.strings[0] === "osascript -e ")
}

describe("ContextualNotifier adapter", () => {
  test("sends one pane-labeled notification with the default sound", async () => {
    // Given
    const invocations: Invocation[] = []

    // When
    const notification = await deliverCompletion(invocations, "5: ha")

    // Then
    expect(notification).toBeDefined()
    expect(notification?.expressions).toContain("5: ha · Sound adapter")
    expect(notification?.expressions).toContain("Submarine")
    const helper = invocations.find((invocation) =>
      invocation.strings.some((part) => part.includes(" window_label")),
    )
    expect(String(helper?.expressions[0])).toEndWith("/scripts/opencode-notifier-tmux")
  })

  test("preserves the session subtitle outside tmux", async () => {
    // Given
    const invocations: Invocation[] = []

    // When
    const notification = await deliverCompletion(invocations, "")

    // Then
    expect(notification).toBeDefined()
    if (!notification) return
    expect(notification.expressions).toContain("Sound adapter")
  })

  test("uses a configured notification sound", async () => {
    // Given
    const invocations: Invocation[] = []

    // When
    const notification = await deliverCompletion(invocations, "5: ha", { sound: "Glass" })

    // Then
    expect(notification).toBeDefined()
    if (!notification) return
    expect(notification.expressions).toContain("Glass")
    expect(notification.expressions).not.toContain("Submarine")
  })
})
