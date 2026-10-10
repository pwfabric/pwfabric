/**
 * The envelope files a runner reads on boot, in one place.
 *
 * Everything is fetched in parallel. `project.json` and the block manifest are
 * required; every other file is optional and reads as `null` when absent.
 *
 * `auth.json` exists only when the app has a way in (envelope §1), and the
 * publisher writes `project.identity` whenever it writes `auth.json`. So the
 * file is asked for only when `project.json` declares an identity: an app
 * without sign-in makes no request that is bound to 404.
 *
 * @module @pwfabric/runner/load-envelope
 */

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
  /** The envelope folder (`./pwpack`), no trailing slash. */
  readonly source: string
  /** The block folder (`./blocks`), no trailing slash. */
  readonly blocksBase: string
  /** The engine folder (`./engines`), no trailing slash. */
  readonly enginesBase: string
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

/** Whether the runner should ask for `auth.json`: only when the app declares an identity. */
export function wantsAuthJson(project: Pick<PwappProject, 'identity'>): boolean {
  return project.identity !== undefined && project.identity !== null
}

export async function loadEnvelope(at: EnvelopeLocations, fetchJson: JsonFetcher): Promise<LoadedEnvelope> {
  const { source, blocksBase, enginesBase } = at
  const projectP = fetchJson<PwappProject>(`${source}/project.json`)
  const [project, navigation, appearance, auth, connections, blockManifest, engineManifest] = await Promise.all([
    projectP,
    fetchJson<PwappNavigation>(`${source}/navigation.json`).catch(() => null),
    fetchJson<unknown>(`${source}/appearance.json`).catch(() => null),
    projectP.then(
      (p) => (wantsAuthJson(p) ? fetchJson<PwappAuth>(`${source}/auth.json`).catch(() => null) : null),
      () => null
    ),
    fetchJson<PwappConnections>(`${source}/connections.json`).catch(() => null),
    fetchJson<BlockManifest>(`${blocksBase}/manifest.json`),
    // Shipped connector/provider engine descriptors. Absent on exports built
    // before they existed, or apps with no bundled engine — connector panels
    // then degrade honestly.
    fetchJson<PwappEngineManifest>(`${enginesBase}/manifest.json`).catch(() => null),
  ])
  return { project, navigation, appearance, auth, connections, blockManifest, engineManifest }
}
