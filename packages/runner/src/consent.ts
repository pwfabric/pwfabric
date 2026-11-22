/**
 * The visitor's consent, and the scripts that wait for it (envelope §2.2).
 *
 * An app declares third-party scripts in `project.json` `scripts`, each
 * waiting for a consent category. Nothing is consented by default: the
 * engine draws no banner and decides nothing on the visitor's behalf. The
 * app asks, with a block of its own, and records the answer through the
 * block context (`context.setConsent`), which lands here.
 *
 * The answers are kept in `localStorage["pwapp_consent:<appId>"]`, so they
 * hold on every page and on the next visit. Each change — and the start of
 * an app that has stored answers — dispatches `pw:consent` on `window` with
 * the answers as `detail`. A category that becomes `true` loads every script
 * waiting for it, once per page load, as `<script async>` in `<head>`; one
 * that becomes `false` loads nothing more (a running script cannot be
 * unloaded; on the next page load it is not loaded). Storage that cannot be
 * read or written is not an error: the answers then last for the page load.
 *
 * Nothing is loaded before {@link Consent.start}, which the runner calls
 * once the first page is drawn.
 *
 * @module @pwfabric/runner/consent
 */

/** One script the app loads once the visitor consents (`project.json` `scripts[]`). */
export interface PwappScript {
  readonly key: string
  readonly src: string
  readonly integrity?: string
  readonly consent: string
}

/** The visitor's answers: category → consented. A category not answered is absent. */
export type ConsentAnswers = Readonly<Record<string, boolean>>

export interface Consent {
  /** The categories the app's scripts name, each once, in declaration order. */
  readonly categories: readonly string[]
  /** The answers so far. The same object until they change. */
  answers(): ConsentAnswers
  /** Records answers, merged over the previous ones; a category not in {@link categories} is ignored. */
  set(answers: ConsentAnswers): void
  /** Called after every change of the answers; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** Once the first page is drawn: announces stored answers and loads what they consent to. */
  start(): void
}

interface ConsentWindow {
  dispatchEvent(event: Event): boolean
  readonly CustomEvent?: typeof CustomEvent
}

interface ConsentDocument {
  createElement(tag: 'script'): HTMLScriptElement
  readonly head: { appendChild(node: Node): unknown }
}

export interface ConsentOptions {
  readonly appId: string
  readonly scripts: readonly unknown[] | undefined
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | undefined
  readonly win: ConsentWindow
  readonly doc: ConsentDocument
}

/** The storage key of an app's answers. */
export function consentStorageKey(appId: string): string {
  return `pwapp_consent:${appId}`
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The scripts a runner may load: each with a key, an https `src` and a
 * consent category. The build has checked them; a hand-edited envelope is
 * read as carefully.
 */
export function scriptsOf(raw: readonly unknown[] | undefined): PwappScript[] {
  const out: PwappScript[] = []
  for (const s of raw ?? []) {
    if (!isRecord(s)) continue
    const { key, src, integrity, consent } = s
    if (typeof key !== 'string' || typeof src !== 'string' || typeof consent !== 'string' || consent === '') continue
    if (!/^https:\/\/[\x21-\x7e]+$/.test(src)) continue
    out.push({ key, src, consent, ...(typeof integrity === 'string' ? { integrity } : {}) })
  }
  return out
}

export function createConsent(options: ConsentOptions): Consent {
  const scripts = scriptsOf(options.scripts)
  const categories = [...new Set(scripts.map((s) => s.consent))]
  const key = consentStorageKey(options.appId)
  const keep = (value: unknown): ConsentAnswers => {
    const out: Record<string, boolean> = {}
    if (isRecord(value)) for (const c of categories) if (typeof value[c] === 'boolean') out[c] = value[c] as boolean
    return out
  }
  let answers: ConsentAnswers = {}
  try {
    const stored = options.storage?.getItem(key)
    if (stored) answers = keep(JSON.parse(stored))
  } catch {
    // unreadable storage or a corrupt entry: nothing answered yet
  }
  const listeners = new Set<() => void>()
  const loaded = new Set<string>()
  let started = false

  const announce = (): void => {
    try {
      const Ctor = options.win.CustomEvent ?? CustomEvent
      options.win.dispatchEvent(new Ctor('pw:consent', { detail: { ...answers } }))
    } catch {
      // no event support: the answers still load the scripts
    }
  }
  const load = (): void => {
    for (const s of scripts) {
      if (answers[s.consent] !== true || loaded.has(s.key)) continue
      loaded.add(s.key)
      const el = options.doc.createElement('script')
      el.async = true
      el.src = s.src
      if (s.integrity) {
        el.integrity = s.integrity
        el.crossOrigin = 'anonymous'
      }
      options.doc.head.appendChild(el)
    }
  }

  return {
    categories,
    answers: () => answers,
    set(next) {
      const merged = { ...answers, ...keep(next) }
      if (Object.keys(merged).length === Object.keys(answers).length && Object.entries(merged).every(([c, v]) => answers[c] === v)) return
      answers = merged
      try {
        options.storage?.setItem(key, JSON.stringify(answers))
      } catch {
        // the answers last for this page load
      }
      for (const l of listeners) l()
      announce()
      if (started) load()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start() {
      if (started) return
      started = true
      if (Object.keys(answers).length > 0) announce()
      load()
    },
  }
}
