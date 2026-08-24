import { describe, expect, test } from "bun:test"

import {
  buildNotificationContent,
  type CompletionReadiness,
  decideCompletionNotification,
  type NotificationContext,
} from "../src/domain"

const ready = {
  background: "idle",
  session: "top-level",
  superseded: false,
  todos: "complete",
} satisfies CompletionReadiness

describe("decideCompletionNotification", () => {
  test("notifies when a top-level session is ready", () => {
    // Given
    const readiness = ready

    // When
    const decision = decideCompletionNotification(readiness)

    // Then
    expect(decision).toEqual({ kind: "notify" })
  })

  test.each([
    [{ ...ready, background: "active" }, "active_background_work"],
    [{ ...ready, session: "child" }, "child_session"],
    [{ ...ready, todos: "incomplete" }, "incomplete_todos"],
    [{ ...ready, superseded: true }, "superseded"],
  ] as const)("skips completion when readiness is blocked", (readiness, reason) => {
    // Given
    const blockedReadiness = readiness

    // When
    const decision = decideCompletionNotification(blockedReadiness)

    // Then
    expect(decision).toEqual({ kind: "skip", reason })
  })

  test.each([
    { ...ready, background: "unknown" },
    { ...ready, session: "unknown" },
    { ...ready, todos: "unknown" },
  ] as const)("fails closed when readiness is unknown", (readiness) => {
    // Given
    const unknownReadiness = readiness

    // When
    const decision = decideCompletionNotification(unknownReadiness)

    // Then
    expect(decision).toEqual({ kind: "skip", reason: "unknown_state" })
  })
})

describe("buildNotificationContent", () => {
  test("renders completion context", () => {
    // Given
    const context = {
      event: "complete",
      projectName: "opencode",
      sessionTitle: "Fix notifications",
      lastUserText: "Stop duplicate alerts",
      lastAssistantText: "The notifier now filters child sessions.",
    } satisfies NotificationContext

    // When
    const content = buildNotificationContent(context)

    // Then
    expect(content).toEqual({
      title: "OpenCode · opencode",
      subtitle: "Fix notifications",
      body: "Ready for input You: Stop duplicate alerts Agent: The notifier now filters child sessions.",
    })
  })

  test("renders actionable error context", () => {
    // Given
    const context = {
      event: "error",
      projectName: "opencode",
      sessionTitle: "Run migration",
      lastUserText: "Apply the schema update",
      errorText: "Database connection refused",
    } satisfies NotificationContext

    // When
    const content = buildNotificationContent(context)

    // Then
    expect(content.body).toBe("Error You: Apply the schema update Database connection refused")
  })

  test("bounds untrusted notification text", () => {
    // Given
    const context = {
      event: "question",
      projectName: "A".repeat(200),
      sessionTitle: "B".repeat(200),
      lastUserText: "C".repeat(1_000),
      lastAssistantText: "D".repeat(1_000),
    } satisfies NotificationContext

    // When
    const content = buildNotificationContent(context)

    // Then
    expect(content.title.length).toBeLessThanOrEqual(80)
    expect(content.subtitle.length).toBeLessThanOrEqual(100)
    expect(content.body.length).toBeLessThanOrEqual(420)
  })
})
