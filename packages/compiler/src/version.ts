/**
 * Versions a caller records next to a compiled bundle.
 *
 * Same input + same compiler version + same esbuild version → identical bytes.
 * Both versions are read at run time (not copied into a constant) so a release
 * that bumps `package.json` cannot leave a stale number behind.
 */
import { createRequire } from 'node:module'
import { version as esbuildVersion } from 'esbuild'

const require = createRequire(import.meta.url)

/** This package's version — `dist/` and `src/` both sit one level below `package.json`. */
export const COMPILER_VERSION: string = (require('../package.json') as { version: string }).version

/** The esbuild version that produced the bytes. */
export const ESBUILD_VERSION: string = esbuildVersion
