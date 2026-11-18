/**
 * THE APP WRITES EVERY WORD (envelope §2, "Messages").
 *
 * An app declares its words once, in `app/plan.json` `messages`: a flat map
 * from a message id to a string in the app's `plan.locale`. `pwf build` and
 * `pwf dev` carry it into `project.json`; the runner draws its gate, pill,
 * account labels and not-found page from it, and blocks read their accessible
 * names from it (`useAppMessage`, app-messages.tsx).
 *
 * THE ENGINE WRITES NO VISITOR WORD (founder decision, 3.0.1). It keeps no
 * fallback table: a message the app does not set reads as `''` — a block may
 * still pass a fallback of its own (`useAppMessage(id, fallback)`, the
 * block's words, not the engine's) — and under `pwf dev` the console names
 * the missing id once (`warnMissingMessage`). `pwf validate` reports every id
 * the app can reach and does not set (MESSAGES_MISSING).
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

/**
 * The renderer's own message ids — the words it draws around blocks:
 *  - `ui.retry`: the accessible name of the retry button a block whose module
 *    failed to load is drawn as (any page can meet it);
 *  - `ui.loading`: the loading gate's line (`loadingStrategy: 'gate'` only —
 *    the runner paints `immediate`, so a published app never draws it).
 */
export const RENDERER_MESSAGE_IDS = ['ui.retry', 'ui.loading'] as const

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

/** Ids already named in the console, so a missing word is said once, not per render. */
const warned = new Set<string>()

/**
 * Under `pwf dev` (the dev server's reload client sets `globalThis.__pwfabric_dev`),
 * names a message id the app does not set, once. Silent anywhere else — a
 * published app's visitor has no use for it, and `pwf validate` has said it.
 */
export function warnMissingMessage(id: string): void {
  if ((globalThis as { __pwfabric_dev?: unknown }).__pwfabric_dev !== true || warned.has(id)) return
  warned.add(id)
  console.warn(`[pwapp] the app sets no message "${id}": nothing is drawn there. Write it in app/plan.json messages.`)
}

/**
 * The app's message for `id` when it sets a non-empty string, else
 * `fallback` (a block's own word) when one is given, else `''`; then its
 * placeholders filled.
 *
 * Only a string counts: a number or an object under an id is a mistake in the
 * plan, and is read as not set rather than as `[object Object]`.
 */
export function messageOf(
  messages: AppMessages | null | undefined,
  id: string,
  fallback?: string,
  vars?: MessageVars
): string {
  const own = messages && Object.prototype.hasOwnProperty.call(messages, id) ? messages[id] : undefined
  if (typeof own === 'string' && own.length > 0) return formatMessage(own, vars)
  if (fallback !== undefined) return formatMessage(fallback, vars)
  warnMissingMessage(id)
  return ''
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
