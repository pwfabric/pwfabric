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
 *  3. else `fallback`, the block's neutral default.
 *
 * Block ids are namespaced `ui.*` (`ui.close`, `ui.dismiss`, `ui.remove`,
 * `ui.pagination.next`, `ui.carousel.previous`, `ui.menu.open` …); the
 * runner's own are listed in `@pwfabric/runner` (`RUNNER_MESSAGES`).
 *
 * The host provides the map once per render (`AppMessagesContext`; embed
 * does it from the `messages` render option). Outside a provider every id
 * reads its fallback.
 *
 * @module @pwfabric/runtime/render/app-messages
 */

import { createContext, useContext } from 'react'
import { messageOf, type AppMessages, type MessageVars } from './messages.js'

export const AppMessagesContext = createContext<AppMessages | null>(null)

/** The app's whole message map, or null outside a provider. */
export function useAppMessages(): AppMessages | null {
  return useContext(AppMessagesContext)
}

/**
 * The app's word for `id`, else `fallback`, with `{placeholders}` filled
 * from `vars`. See the module note for the order.
 */
export function useAppMessage(id: string, fallback: string, vars?: MessageVars): string {
  return messageOf(useContext(AppMessagesContext), id, fallback, vars)
}
