import type { NotificationContent } from "../src/domain"
import type { MarkerEvent, NotifierRuntime } from "../src/runtime"

export type RuntimeHarness = {
  readonly markers: MarkerEvent[]
  readonly notifications: NotificationContent[]
  readonly runtime: NotifierRuntime
}

export function createRuntimeHarness(overrides: Partial<NotifierRuntime> = {}): RuntimeHarness {
  const markers: MarkerEvent[] = []
  const notifications: NotificationContent[] = []
  const runtime = {
    projectName: "opencode",
    readBackground: async () => "idle" as const,
    readMessages: async () => ({
      lastUserText: "Fix duplicate notifications",
      lastAssistantText: "The notifier is ready.",
    }),
    readSession: async () => ({ title: "Contextual notifier" }),
    readTodos: async () => [{ status: "completed" }],
    mark: async (event: MarkerEvent) => {
      markers.push(event)
    },
    notify: async (content: NotificationContent) => {
      notifications.push(content)
    },
    ...overrides,
  } satisfies NotifierRuntime

  return { markers, notifications, runtime }
}

export const idleEvent = {
  type: "session.idle",
  properties: { sessionID: "main" },
}

export const userMessageEvent = {
  type: "message.updated",
  properties: { info: { id: "user-1", role: "user", sessionID: "main" } },
}
