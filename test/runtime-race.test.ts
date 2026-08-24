import { describe, expect, test } from "bun:test"

import { createNotifierEventHandler, type SessionSnapshot } from "../src/runtime"
import { createRuntimeHarness, idleEvent, userMessageEvent } from "./runtime-harness"

describe("concurrent notifier events", () => {
  test("reserves completion before asynchronous checks finish", async () => {
    // Given
    const gate = Promise.withResolvers<SessionSnapshot | undefined>()
    const harness = createRuntimeHarness({ readSession: async () => gate.promise })
    const handle = createNotifierEventHandler(harness.runtime)

    // When
    const first = handle(idleEvent)
    const second = handle(idleEvent)
    gate.resolve({ title: "Main session" })
    await Promise.all([first, second])

    // Then
    expect(harness.markers).toEqual(["complete"])
    expect(harness.notifications).toHaveLength(1)
  })

  test("cancels pending completion when user activity supersedes it", async () => {
    // Given
    const gate = Promise.withResolvers<SessionSnapshot | undefined>()
    let reads = 0
    const harness = createRuntimeHarness({
      readSession: async () => {
        reads += 1
        return reads === 1 ? gate.promise : { title: "Main session" }
      },
    })
    const handle = createNotifierEventHandler(harness.runtime)

    // When
    const pendingIdle = handle(idleEvent)
    await handle(userMessageEvent)
    gate.resolve({ title: "Main session" })
    await pendingIdle

    // Then
    expect(harness.markers).toEqual(["user_message"])
    expect(harness.notifications).toEqual([])
  })

  test("allows a newer turn while an older idle check is pending", async () => {
    // Given
    const gate = Promise.withResolvers<SessionSnapshot | undefined>()
    let reads = 0
    const harness = createRuntimeHarness({
      readSession: async () => {
        reads += 1
        return reads === 1 ? gate.promise : { title: "Main session" }
      },
    })
    const handle = createNotifierEventHandler(harness.runtime)

    // When
    const staleIdle = handle(idleEvent)
    await handle(userMessageEvent)
    const currentIdle = handle(idleEvent)
    gate.resolve({ title: "Main session" })
    await Promise.all([staleIdle, currentIdle])

    // Then
    expect(harness.markers).toEqual(["user_message", "complete"])
    expect(harness.notifications).toHaveLength(1)
  })

  test("ignores trailing updates for an already handled user message", async () => {
    // Given
    const harness = createRuntimeHarness()
    const handle = createNotifierEventHandler(harness.runtime)

    // When
    await handle(userMessageEvent)
    await handle(idleEvent)
    await handle(userMessageEvent)
    await handle(idleEvent)

    // Then
    expect(harness.markers).toEqual(["user_message", "complete"])
    expect(harness.notifications).toHaveLength(1)
  })

  test("cancels a pending question when its reply arrives", async () => {
    // Given
    const gate = Promise.withResolvers<SessionSnapshot | undefined>()
    let reads = 0
    const harness = createRuntimeHarness({
      readSession: async () => {
        reads += 1
        return reads === 1 ? gate.promise : { title: "Main session" }
      },
    })
    const handle = createNotifierEventHandler(harness.runtime)

    // When
    const pendingQuestion = handle({
      type: "question.asked",
      properties: { sessionID: "main" },
    })
    await handle({ type: "question.replied", properties: { sessionID: "main" } })
    gate.resolve({ title: "Main session" })
    await pendingQuestion

    // Then
    expect(harness.markers).toEqual(["user_message"])
    expect(harness.notifications).toEqual([])
  })
})
