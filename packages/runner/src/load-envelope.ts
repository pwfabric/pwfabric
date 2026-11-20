/**
 * The envelope files a runner reads on boot, in one place.
 *
 * Everything is fetched in parallel. `project.json` and the block manifest are
 * required; every other file is optional and reads as `null` when absent.
 *
 * `auth.json` exists only when the app has a way in (envelope §1), and the
 * publisher writes `project.identity` whenever it writes `auth.json`. So the
 * file is asked for only when `project.json` declares an identity that has a
 * door: an app without one makes no request that is bound to 404.
 *
 * A manifest's `moduleUrl`s are written relative to the app's folder — the
 * folder `blocks/` and `engines/` sit in — not to the page that runs the app.
 * They are made absolute here, once, against the folder the manifest was read
 * from, so every reader (the block loader, the preload, the engine registry)
 * fetches the app's file wherever the page itself is (envelope §5).
 *
 * @module @pwfabric/runner/load-envelope
 */

import { withVersion } from './helpers.js'
import type {
  BlockManifest,
  PwappAuth,
  PwappConnections,
  PwappEngineManifest,
  PwappNavigation,
  PwappProject,
} from './types.js'

export type JsonFetcher = <T>(url: string) => Promise<T>

export interface EnvelopeLocations {
  /** The address the relative locations below resolve against: the document's base URL. */
  readonly documentBase: string
  /** The envelope folder (`./pwpack`), no trailing slash. */
  readonly source: string
  /** The block folder (`./blocks`), no trailing slash. */
  readonly blocksBase: string
  /** The engine folder (`./engines`), no trailing slash. */
  readonly enginesBase: string
  /** Appended as `?v=` to every address under {@link source}; see {@link RunAppOptions.version}. */
  readonly version?: string | number | undefined
}

export interface LoadedEnvelope {
  readonly project: PwappProject
  readonly navigation: PwappNavigation | null
  readonly appearance: unknown
  readonly auth: PwappAuth | null
  readonly connections: PwappConnections | null
  readonly blockManifest: BlockManifest
  readonly engineManifest: PwappEngineManifest | null
}

/**
 * Whether the runner should ask for `auth.json`: only when the app declares an
 * identity, and not when that identity says it has no door (`door: false` —
 * an app that wants a signed-in visitor, built with no host to sign in at).
 */
export function wantsAuthJson(project: Pick<PwappProject, 'identity'>): boolean {
  return project.identity !== undefined && project.identity !== null && project.identity.door !== false
}

/**
 * A manifest's entries with every `moduleUrl` made absolute against the app's
 * folder: the folder that holds the manifest's own folder (`blocks/`,
 * `engines/`). An entry without a `moduleUrl` (a declared engine) is kept as
 * it is.
 */
export function withAbsoluteModuleUrls<T extends { readonly moduleUrl?: string | undefined }>(
  entries: readonly T[],
  manifestUrl: string
): T[] {
  const appFolder = new URL('..', manifestUrl)
  return entries.map((e) =>
    typeof e.moduleUrl === 'string' && e.moduleUrl.length > 0
      ? { ...e, moduleUrl: new URL(e.moduleUrl, appFolder).href }
      : e
  )
}

export async function loadEnvelope(at: EnvelopeLocations, fetchJson: JsonFetcher): Promise<LoadedEnvelope> {
  const { documentBase, source: base, blocksBase, enginesBase, version } = at
  const blockManifestAt = `${blocksBase}/manifest.json`
  const engineManifestAt = `${enginesBase}/manifest.json`
  const inSource = (file: string): string => withVersion(`${base}/${file}`, version)
  const projectP = fetchJson<PwappProject>(inSource('project.json'))
  const [project, navigation, appearance, auth, connections, blockManifest, engineManifest] = await Promise.all([
    projectP,
    fetchJson<PwappNavigation>(inSource('navigation.json')).catch(() => null),
    fetchJson<unknown>(inSource('appearance.json')).catch(() => null),
    projectP.then(
      (p) => (wantsAuthJson(p) ? fetchJson<PwappAuth>(inSource('auth.json')).catch(() => null) : null),
      () => null
    ),
    fetchJson<PwappConnections>(inSource('connections.json')).catch(() => null),
    fetchJson<BlockManifest>(blockManifestAt),
    // Shipped connector/provider engine descriptors. Absent on exports built
    // before they existed, or apps with no bundled engine — connector panels
    // then degrade honestly.
    fetchJson<PwappEngineManifest>(engineManifestAt).catch(() => null),
  ])
  return {
    project,
    navigation,
    appearance,
    auth,
    connections,
    blockManifest: withAbsoluteModuleUrls(blockManifest, new URL(blockManifestAt, documentBase).href),
    engineManifest: engineManifest
      ? withAbsoluteModuleUrls(engineManifest, new URL(engineManifestAt, documentBase).href)
      : null,
  }
}
