/**
 * THE APP WRITES EVERY WORD (envelope §2, "Messages").
 *
 * An app declares its words once, in `app/plan.json` `messages`: a flat map
 * from a message id to a string in the app's `plan.locale`. `pwf build` and
 * `pwf dev` carry it into `project.json`; the runner draws its gate, pill,
 * account labels and not-found page from it, and blocks read their accessible
 * names from it (`useAppMessage`, app-messages.tsx).
 *
 * The engine keeps only NEUTRAL fallbacks: one English string per id, for a
 * screen the app did not write and for the accessible name of a control. A
 * message the app sets always wins; one it leaves out reads the fallback.
 *
 * Placeholders are `{name}`, `{code}` and `{n}` — whatever `vars` names, in
 * braces. A placeholder `vars` does not fill is written as nothing, so a
 * visitor never sees `{name}`.
 *
 * Pure: no React, no DOM. The runner imports this file on its own
 * (`@pwfabric/runtime/render/messages`) without pulling in the renderer.
 *
 * @module @pwfabric/runtime/render/messages
 */

/** The app's words: message id → string, in the app's locale. */
export type AppMessages = Readonly<Record<string, string>>

/** The values a message's `{placeholders}` are filled from. */
export type MessageVars = Readonly<Record<string, string | number | null | undefined>>

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g

/** `template` with each `{name}` replaced by `vars.name` (nothing when unset). */
export function formatMessage(template: string, vars?: MessageVars): string {
  return template.replace(PLACEHOLDER, (_, name: string) => {
    const v = vars?.[name]
    return v === undefined || v === null ? '' : String(v)
  })
}

/**
 * The app's message for `id` when it sets a non-empty string, else
 * `fallback`; then its placeholders filled.
 *
 * Only a string counts: a number or an object under an id is a mistake in the
 * plan, and the fallback reads better than `[object Object]`.
 */
export function messageOf(
  messages: AppMessages | null | undefined,
  id: string,
  fallback: string,
  vars?: MessageVars
): string {
  const own = messages && Object.prototype.hasOwnProperty.call(messages, id) ? messages[id] : undefined
  return formatMessage(typeof own === 'string' && own.length > 0 ? own : fallback, vars)
}

/**
 * The app's messages as a plain map: string values only, from `project.json`
 * or `plan.json` `messages`. Anything else is `{}`.
 */
export function appMessagesOf(value: unknown): AppMessages {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
  return out
}
