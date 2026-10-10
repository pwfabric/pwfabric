import { describe, expect, it } from 'vitest'
import { main, parseArgs } from '../index.js'
import { COMMANDS } from '../commands/registry.js'
import type { CommandIO } from '../commands/types.js'

function capture(): { io: CommandIO; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { io: { cwd: process.cwd(), out: (l) => out.push(l), err: (l) => err.push(l), env: {} }, out, err }
}

describe('parseArgs', () => {
  it('splits the command, positionals and flags', () => {
    expect(parseArgs(['create', 'my-app', '--dir', 'x', '--force', '--port=4601'])).toEqual({
      command: 'create',
      args: { positionals: ['my-app'], flags: { dir: 'x', force: true, port: '4601' } },
    })
  })
  it('treats everything after -- as positional', () => {
    expect(parseArgs(['run', '--', '--not-a-flag']).args.positionals).toEqual(['--not-a-flag'])
  })
  it('makes a flag followed by another flag boolean', () => {
    expect(parseArgs(['x', '--a', '--b', 'v']).args.flags).toEqual({ a: true, b: 'v' })
  })
})

describe('main', () => {
  it('prints help with no command', async () => {
    const c = capture()
    expect(await main([], c.io)).toBe(0)
    expect(c.out[0]).toContain('Usage: pwf')
  })
  it('prints the package version on --version, -v and version', async () => {
    const { readFileSync } = await import('node:fs')
    const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
    for (const flag of ['--version', '-v', 'version']) {
      const c = capture()
      expect(await main([flag], c.io)).toBe(0)
      expect(c.out).toEqual([version])
    }
  })
  it('fails with exit 2 on an unknown command', async () => {
    const c = capture()
    expect(await main(['nope'], c.io)).toBe(2)
    expect(c.err[0]).toContain('unknown command "nope"')
  })
  it('dispatches to a registered command and prints its usage on --help', async () => {
    COMMANDS.push({ name: 'probe', summary: 'test probe', usage: 'pwf probe', run: async () => 7 })
    try {
      const c = capture()
      expect(await main(['probe'], c.io)).toBe(7)
      expect(await main(['probe', '--help'], c.io)).toBe(0)
      expect(c.out).toContain('Usage: pwf probe')
    } finally {
      COMMANDS.splice(COMMANDS.findIndex((x) => x.name === 'probe'), 1)
    }
  })
})
