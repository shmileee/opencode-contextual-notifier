import { z } from "zod"

export const sessionIDSchema = z.string().brand<"SessionID">()
const messageIDSchema = z.string().brand<"MessageID">()

export type SessionID = z.infer<typeof sessionIDSchema>
type MessageID = z.infer<typeof messageIDSchema>

export type NotifierEvent =
  | {
      readonly kind: "session_created"
      readonly parentID: SessionID | undefined
      readonly sessionID: SessionID
    }
  | {
      readonly kind: "user_message"
      readonly messageID: MessageID
      readonly sessionID: SessionID
    }
  | { readonly kind: "activity"; readonly sessionID: SessionID }
  | { readonly kind: "idle"; readonly sessionID: SessionID }
  | { readonly kind: "question"; readonly sessionID: SessionID }
  | {
      readonly kind: "permission"
      readonly notificationKind: "permission" | "plan_exit"
      readonly sessionID: SessionID
    }
  | {
      readonly errorName: string
      readonly errorText: string | undefined
      readonly kind: "error"
      readonly sessionID: SessionID
    }

const eventSchema = z.object({ type: z.string(), properties: z.unknown() })
const sessionPropertiesSchema = z.object({ sessionID: sessionIDSchema })
const sessionCreatedPropertiesSchema = z.object({
  info: z.object({ id: sessionIDSchema, parentID: sessionIDSchema.optional() }),
})
const messagePropertiesSchema = z.object({
  info: z.object({
    id: messageIDSchema,
    role: z.string(),
    sessionID: sessionIDSchema,
  }),
})
const permissionPropertiesSchema = z.object({
  sessionID: sessionIDSchema,
  permission: z.string().optional(),
  title: z.string().optional(),
  type: z.string().optional(),
})
const errorPropertiesSchema = z.object({
  sessionID: sessionIDSchema.optional(),
  error: z
    .object({
      name: z.string(),
      data: z.object({ message: z.string().optional() }).loose().optional(),
    })
    .optional(),
})

const activityTypes = new Set([
  "permission.replied",
  "question.rejected",
  "question.replied",
  "question.v2.rejected",
  "question.v2.replied",
])

export function parseNotifierEvent(rawEvent: unknown): NotifierEvent | undefined {
  const event = eventSchema.safeParse(rawEvent)
  if (!event.success) return undefined
  const { type, properties } = event.data

  if (type === "session.created") {
    const parsed = sessionCreatedPropertiesSchema.safeParse(properties)
    if (!parsed.success) return undefined
    return {
      kind: "session_created",
      parentID: parsed.data.info.parentID,
      sessionID: parsed.data.info.id,
    }
  }

  if (type === "message.updated") {
    const parsed = messagePropertiesSchema.safeParse(properties)
    if (!parsed.success || parsed.data.info.role !== "user") return undefined
    return {
      kind: "user_message",
      messageID: parsed.data.info.id,
      sessionID: parsed.data.info.sessionID,
    }
  }

  if (activityTypes.has(type)) {
    const parsed = sessionPropertiesSchema.safeParse(properties)
    return parsed.success ? { kind: "activity", sessionID: parsed.data.sessionID } : undefined
  }

  if (type === "session.idle") {
    const parsed = sessionPropertiesSchema.safeParse(properties)
    return parsed.success ? { kind: "idle", sessionID: parsed.data.sessionID } : undefined
  }

  if (type === "question.asked" || type === "question.v2.asked") {
    const parsed = sessionPropertiesSchema.safeParse(properties)
    return parsed.success ? { kind: "question", sessionID: parsed.data.sessionID } : undefined
  }

  if (type === "permission.asked" || type === "permission.updated") {
    const parsed = permissionPropertiesSchema.safeParse(properties)
    if (!parsed.success) return undefined
    const name = [parsed.data.permission, parsed.data.type, parsed.data.title]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase()
    return {
      kind: "permission",
      notificationKind: name.includes("plan") ? "plan_exit" : "permission",
      sessionID: parsed.data.sessionID,
    }
  }

  if (type !== "session.error") return undefined
  const parsed = errorPropertiesSchema.safeParse(properties)
  if (!parsed.success || !parsed.data.sessionID || !parsed.data.error) return undefined
  return {
    errorName: parsed.data.error.name,
    errorText: parsed.data.error.data?.message,
    kind: "error",
    sessionID: parsed.data.sessionID,
  }
}
