/**
 * @pwfabric/compiler — the atom compiler.
 *
 * Block / capability / connector / provider source in, one ES module out, with
 * the host-provided imports left external. Pure: the caller supplies the files
 * and stores the result.
 *
 * @module @pwfabric/compiler
 */
export {
  compileAtom,
  MAX_ATOM_BUNDLE_BYTES,
  type CompileInput,
  type CompileResult,
  type CompileTarget,
  type Diagnostic,
  type DiagnosticCode,
} from './compile.js'
export { compileFolder, readSourceTree } from './folder.js'
export {
  screenSource,
  maskSource,
  SCREEN_IMPORT_ALLOWLIST,
  screenBlockSource,
  BLOCK_SOURCE_IMPORT_ALLOWLIST,
  type ScreenOptions,
  type ScreenResult,
} from './screen.js'
export {
  collectCompanions,
  isCompanionTarget,
  resolveCompanion,
  type CompanionScan,
  type ScreenFn,
} from './companions.js'
export { buildWrapperSource, isValidEngineName, isValidSourceBase, type WrapperContext } from './wrappers.js'
export { COMPILER_VERSION, ESBUILD_VERSION } from './version.js'
