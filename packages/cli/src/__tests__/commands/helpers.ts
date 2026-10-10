import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormatsModule from 'ajv-formats'
import { afterEach, vi } from 'vitest'
import type { CommandIO } from '../../commands/types.js'

// Each test writes and reads whole pack folders; under a full parallel workspace run on a
// slow file system that can exceed vitest's default 5 s.
vi.setConfig({ testTimeout: 30_000 })

const HERE = dirname(fileURLToPath(import.meta.url))

/** The minimised foundation pack the commands are tested against. */
export const FIXTURE_FOUNDATION = join(HERE, '..', '..', '__fixtures__', 'j-foundation')

export interface Captured {
  io: CommandIO
  out: string[]
  err: string[]
  text(): string
}

export function capture(cwd: string, env: Record<string, string | undefined> = {}): Captured {
  const out: string[] = []
  const err: string[] = []
  return {
    io: { cwd, out: (l) => out.push(l), err: (l) => err.push(l), env },
    out,
    err,
    text: () => [...out, ...err].join('\n'),
  }
}

const temps: string[] = []

/** A fresh temporary folder, removed after the test. */
export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pwf-j-'))
  temps.push(dir)
  return dir
}

afterEach(async () => {
  while (temps.length) await rm(temps.pop() as string, { recursive: true, force: true })
})

/**
 * The spec's JSON Schemas. They are read from a `spec/` folder beside the
 * engine when one is present; without it the schema assertions skip with
 * {@link SPEC_SCHEMAS_MISSING} as the reason and everything else still runs.
 */
const SCHEMAS = join(HERE, '..', '..', '..', '..', '..', 'spec', 'schemas')

/** Why the schema assertions are skipped, or undefined when the spec is here. */
export const SPEC_SCHEMAS_MISSING: string | undefined = existsSync(SCHEMAS)
  ? undefined
  : `the spec is not beside the engine (${SCHEMAS} does not exist; it is a separate repository upstream)`

type Validator = ((doc: unknown) => boolean) & { errors?: unknown }
type AjvCtor = new (opts: object) => { addSchema(s: object): void; getSchema(id: string): Validator | undefined }
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (a: unknown) => void
const AjvClass = ((Ajv2020 as unknown as { default?: unknown }).default ?? Ajv2020) as AjvCtor
let ajv: InstanceType<AjvCtor> | null = null

function schemas(): InstanceType<AjvCtor> {
  if (ajv) return ajv
  if (SPEC_SCHEMAS_MISSING) throw new Error(SPEC_SCHEMAS_MISSING)
  const a = new AjvClass({ strict: false, allErrors: true })
  addFormats(a)
  for (const f of readdirSync(SCHEMAS).filter((f) => f.endsWith('.schema.json'))) {
    a.addSchema(JSON.parse(readFileSync(join(SCHEMAS, f), 'utf8')))
  }
  ajv = a
  return a
}

/** Validates `doc` against a spec schema by name; returns the errors (empty when valid). Guard callers with {@link SPEC_SCHEMAS_MISSING}. */
export function schemaErrors(name: string, doc: unknown): unknown[] {
  const validate = schemas().getSchema(`https://pwfabric.com/spec/schemas/${name}.schema.json`)
  if (!validate) throw new Error(`no schema ${name}`)
  return validate(doc) ? [] : ((validate.errors as unknown[]) ?? ['invalid'])
}
