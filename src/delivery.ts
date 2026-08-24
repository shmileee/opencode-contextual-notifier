import {
  buildNotificationContent,
  decideCompletionNotification,
  type NotificationContent,
  type NotificationKind,
} from "./domain"
import type { SessionID } from "./events"

export type SessionSnapshot = {
  readonly parentID?: string | undefined
  readonly title: string
}

export type MessageSnapshot = {
  readonly lastAssistantText?: string | undefined
  readonly lastUserText?: string | undefined
}

export type TodoSnapshot = {
  readonly status: string
}

export type MarkerEvent = NotificationKind | "session_started" | "user_message"

export type NotifierRuntime = {
  readonly projectName: string
  readonly readBackground: (sessionID: SessionID) => Promise<"active" | "idle" | "unknown">
  readonly readMessages: (sessionID: SessionID) => Promise<MessageSnapshot | undefined>
  readonly readSession: (sessionID: SessionID) => Promise<SessionSnapshot | undefined>
  readonly readTodos: (sessionID: SessionID) => Promise<readonly TodoSnapshot[] | undefined>
  readonly mark: (event: MarkerEvent) => Promise<void>
  readonly notify: (content: NotificationContent) => Promise<void>
}

type CurrentRequest = {
  readonly isCurrent: () => boolean
  readonly sessionID: SessionID
}

type ActionRequest = CurrentRequest & {
  readonly errorText?: string | undefined
  readonly event: NotificationKind
}

function failClosed<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.then(
    (value) => value,
    () => fallback,
  )
}

export async function deliverAction(
  runtime: NotifierRuntime,
  request: ActionRequest,
): Promise<boolean> {
  const session = await failClosed(runtime.readSession(request.sessionID), undefined)
  if (!session || session.parentID || !request.isCurrent()) return false

  const messages = await failClosed(runtime.readMessages(request.sessionID), undefined)
  if (!request.isCurrent()) return false
  const content = buildNotificationContent({
    event: request.event,
    projectName: runtime.projectName,
    sessionTitle: session.title,
    lastUserText: messages?.lastUserText,
    lastAssistantText: messages?.lastAssistantText,
    errorText: request.errorText,
  })
  await Promise.allSettled([runtime.mark(request.event), runtime.notify(content)])
  return true
}

export async function handleCompletion(
  runtime: NotifierRuntime,
  request: CurrentRequest,
): Promise<boolean> {
  const [session, background, todos] = await Promise.all([
    failClosed(runtime.readSession(request.sessionID), undefined),
    failClosed(runtime.readBackground(request.sessionID), "unknown" as const),
    failClosed(runtime.readTodos(request.sessionID), undefined),
  ])
  const sessionState = session
    ? session.parentID
      ? ("child" as const)
      : ("top-level" as const)
    : ("unknown" as const)
  const todosState = todos
    ? todos.some((todo) => todo.status !== "completed" && todo.status !== "cancelled")
      ? ("incomplete" as const)
      : ("complete" as const)
    : ("unknown" as const)
  const decision = decideCompletionNotification({
    background,
    session: sessionState,
    superseded: !request.isCurrent(),
    todos: todosState,
  })
  if (decision.kind === "skip" || !session) return false

  const messages = await failClosed(runtime.readMessages(request.sessionID), undefined)
  if (!request.isCurrent()) return false
  const content = buildNotificationContent({
    event: "complete",
    projectName: runtime.projectName,
    sessionTitle: session.title,
    lastUserText: messages?.lastUserText,
    lastAssistantText: messages?.lastAssistantText,
  })
  await Promise.allSettled([runtime.mark("complete"), runtime.notify(content)])
  return true
}

export async function markTopLevel(runtime: NotifierRuntime, sessionID: SessionID): Promise<void> {
  const session = await failClosed(runtime.readSession(sessionID), undefined)
  if (!session || session.parentID) return
  await Promise.allSettled([runtime.mark("user_message")])
}
