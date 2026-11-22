/**
 * The app's words, offered to the blocks (envelope §2, "Messages").
 *
 * A block that draws a word of its own — the accessible name of a close
 * button, "Next page" on a pager, "Previous slide" on a carousel — reads it
 * through `useAppMessage(id, fallback, vars)`:
 *
 *  1. a prop the block already has for it wins (the block passes that prop
 *     instead of calling the hook, or ignores the hook's answer);
 *  2. else the app's message for `id` (`plan.json` `messages`);
 *  3. else `fallback`, when the block passes one — the block's own word;
 *  4. else nothing (`''`): the engine writes no visitor word, and under
 *     `pwf dev` the console names the id.
 *
 * Block ids are namespaced `ui.*` (`ui.close`, `ui.dismiss`, `ui.remove`,
 * `ui.pagination.next`, `ui.carousel.previous`, `ui.menu.open` …); the
 * runner's own are listed in `@pwfabric/runner` (`RUNNER_MESSAGE_IDS`); the
 * renderer's own is `ui.loading` (the loading gate, `loadingStrategy: 'gate'`).
 *
 * The host provides the map once per render (`AppMessagesContext`; embed
 * does it from the `messages` render option). Outside a provider every id
 * reads its fallback, or nothing.
 *
 * @module @pwfabric/runtime/render/app-messages
 */

import { createContext, useContext } from 'react'
import { messageOf, type AppMessages, type MessageVars } from './messages.js'

export const AppMessagesContext = createContext<AppMessages | null>(null)

/**
 * The app's locale (BCP 47), whose plural rules and numbers a message's
 * plural is written in (envelope §2.1). Absent: `en`.
 */
export const AppLocaleContext = createContext<string | undefined>(undefined)

/** The app's whole message map, or null outside a provider. */
export function useAppMessages(): AppMessages | null {
  return useContext(AppMessagesContext)
}

/**
 * The app's word for `id`, else `fallback`, else `''`, with `{placeholders}`
 * filled from `vars`. See the module note for the order.
 */
export function useAppMessage(id: string, fallback?: string, vars?: MessageVars): string {
  return messageOf(useContext(AppMessagesContext), id, fallback, vars, useContext(AppLocaleContext))
}
