import { describe, expect, test } from "bun:test"

import { createNotifierEventHandler } from "../src/runtime"
import { createRuntimeHarness, idleEvent, userMessageEvent } from "./runtime-harness"

describe("createNotifierEventHandler", () => {
  test("delivers one completion for a ready top-level session", async () => {
    // Given
    const harness = createRuntimeHarness()
    const handle = createNotifierEventHandler(harness.runtime)

    // When
    await handle(idleEvent)

    // Then
    expect(harness.markers).toEqual(["complete"])
    expect(harness.notifications).toHaveLength(1)
    expect(harness.notifications[0]?.title).toBe("OpenCode · opencode")
  })

  test("deduplicates idle until a new user message", async () => {
    // Given
    const harness = createRuntimeHarness()
    const handle = createNotifierEventHandler(harness.runtime)

    // When
    await handle(idleEvent)
    await handle(idleEvent)
    await handle(userMessageEvent)
    await handle(idleEvent)

    // Then
    expect(harness.markers).toEqual(["complete", "user_message", "complete"])
    expect(harness.notifications).toHaveLength(2)
  })

  test.each([
    { readBackground: async () => "active" as const },
    { readSession: async () => ({ parentID: "main", title: "Child" }) },
    { readTodos: async () => [{ status: "in_progress" }] },
  ])("suppresses completion while work is not ready", async (overrides) => {
    // Given
    const harness = createRuntimeHarness(overrides)

    // When
    await createNotifierEventHandler(harness.runtime)(idleEvent)

    // Then
    expect(harness.markers).toEqual([])
    expect(harness.notifications).toEqual([])
  })

  test("delivers question and plan-review events separately", async () => {
    // Given
    const harness = createRuntimeHarness()
    const handle = createNotifierEventHandler(harness.runtime)

    // When
    await handle({ type: "question.asked", properties: { sessionID: "main" } })
    await handle({
      type: "permission.asked",
      properties: { sessionID: "main", permission: "plan_exit" },
    })

    // Then
    expect(harness.markers).toEqual(["question", "plan_exit"])
    expect(harness.notifications).toHaveLength(2)
  })

  test("delivers real errors and ignores user aborts", async () => {
    // Given
    const harness = createRuntimeHarness()
    const handle = createNotifierEventHandler(harness.runtime)

    // When
    await handle({
      type: "session.error",
      properties: {
        sessionID: "main",
        error: { name: "APIError", data: { message: "Connection refused" } },
      },
    })
    await handle({
      type: "session.error",
      properties: { sessionID: "main", error: { name: "MessageAbortedError" } },
    })

    // Then
    expect(harness.markers).toEqual(["error"])
    expect(harness.notifications[0]?.body).toContain("Connection refused")
  })

  test("clears only top-level session activity", async () => {
    // Given
    const parent = createRuntimeHarness()
    const child = createRuntimeHarness({
      readSession: async () => ({ parentID: "main", title: "Child" }),
    })

    // When
    await createNotifierEventHandler(parent.runtime)(userMessageEvent)
    await createNotifierEventHandler(child.runtime)({
      type: "message.updated",
      properties: { info: { id: "child-1", role: "user", sessionID: "child" } },
    })

    // Then
    expect(parent.markers).toEqual(["user_message"])
    expect(child.markers).toEqual([])
  })

  test("clears only top-level session creation", async () => {
    // Given
    const harness = createRuntimeHarness()
    const handle = createNotifierEventHandler(harness.runtime)

    // When
    await handle({ type: "session.created", properties: { info: { id: "main" } } })
    await handle({
      type: "session.created",
      properties: { info: { id: "child", parentID: "main" } },
    })

    // Then
    expect(harness.markers).toEqual(["session_started"])
  })
})
