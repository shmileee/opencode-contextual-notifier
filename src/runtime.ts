import { deliverAction, handleCompletion, markTopLevel, type NotifierRuntime } from "./delivery"
import { parseNotifierEvent, type SessionID } from "./events"

export type {
  MarkerEvent,
  MessageSnapshot,
  NotifierRuntime,
  SessionSnapshot,
  TodoSnapshot,
} from "./delivery"

export function createNotifierEventHandler(
  runtime: NotifierRuntime,
): (event: unknown) => Promise<void> {
  const completedSessions = new Set<SessionID>()
  const inFlightCompletions = new Map<SessionID, number>()
  const latestUserMessageIDs = new Map<SessionID, string>()
  const revisions = new Map<SessionID, number>()
  const revision = (sessionID: SessionID): number => revisions.get(sessionID) ?? 0
  const supersede = (sessionID: SessionID): void => {
    revisions.set(sessionID, revision(sessionID) + 1)
    completedSessions.delete(sessionID)
  }

  return async (rawEvent: unknown): Promise<void> => {
    const event = parseNotifierEvent(rawEvent)
    if (!event) return

    switch (event.kind) {
      case "session_created": {
        supersede(event.sessionID)
        if (!event.parentID) {
          await Promise.allSettled([runtime.mark("session_started")])
        }
        return
      }
      case "user_message": {
        if (latestUserMessageIDs.get(event.sessionID) === event.messageID) return
        latestUserMessageIDs.set(event.sessionID, event.messageID)
        supersede(event.sessionID)
        await markTopLevel(runtime, event.sessionID)
        return
      }
      case "activity": {
        supersede(event.sessionID)
        await markTopLevel(runtime, event.sessionID)
        return
      }
      case "idle": {
        const startedAt = revision(event.sessionID)
        if (
          completedSessions.has(event.sessionID) ||
          inFlightCompletions.get(event.sessionID) === startedAt
        ) {
          return
        }
        inFlightCompletions.set(event.sessionID, startedAt)
        try {
          const delivered = await handleCompletion(runtime, {
            isCurrent: () => revision(event.sessionID) === startedAt,
            sessionID: event.sessionID,
          })
          if (delivered && revision(event.sessionID) === startedAt) {
            completedSessions.add(event.sessionID)
          }
        } finally {
          if (inFlightCompletions.get(event.sessionID) === startedAt) {
            inFlightCompletions.delete(event.sessionID)
          }
        }
        return
      }
      case "question": {
        const startedAt = revision(event.sessionID)
        await deliverAction(runtime, {
          event: "question",
          isCurrent: () => revision(event.sessionID) === startedAt,
          sessionID: event.sessionID,
        })
        return
      }
      case "permission": {
        const startedAt = revision(event.sessionID)
        await deliverAction(runtime, {
          event: event.notificationKind,
          isCurrent: () => revision(event.sessionID) === startedAt,
          sessionID: event.sessionID,
        })
        return
      }
      case "error": {
        if (event.errorName === "MessageAbortedError") return
        const startedAt = revision(event.sessionID)
        await deliverAction(runtime, {
          errorText: event.errorText ?? event.errorName,
          event: "error",
          isCurrent: () => revision(event.sessionID) === startedAt,
          sessionID: event.sessionID,
        })
        return
      }
      default: {
        const exhaustive: never = event
        return exhaustive
      }
    }
  }
}
