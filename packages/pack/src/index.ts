/**
 * @pwfabric/pack — the single reader and writer of the
 * pwpack folder and its `.pwpack` archive.
 *
 * A pwpack is a rootless folder: `pwpack.json` (identity), `app/` (an app's
 * own declaration), `atoms/` (reusable parts) and `media/` (content files:
 * images, video, fonts) with `media/provenance.json`. `<name>-<version>.pwpack` is the deterministic
 * gzipped tar of that folder.
 *
 *   readFolder(dir)      folder on disk  → PackFolder
 *   readPwpack(bytes)    .pwpack bytes   → PackFolder
 *   writePwpack(pack)    PackFolder      → deterministic .pwpack bytes
 *   validatePack(pack)   PackFolder      → structured issues
 *   packContent(pack)    PackFolder      → the part that is the pack (no tooling)
 *   hashPack(pack)       PackFolder      → content hash of the pack content (framing-independent)
 *   deriveManifest(...)  PackFolder      → PwpackManifest
 *   mediaDeclarations()  PackFolder      → media declarations + bytes + provenance
 *
 * @module @pwfabric/pack
 */
export { PackError, type PackErrorCode, type PackFolder, type PackIssue, type PackIssueSeverity } from './types.js'
export {
  compareBytes,
  findCaseConflicts,
  findPathConflict,
  foldPath,
  isSafePackPath,
  unsafePathReason,
} from './paths.js'
export { isPackContentPath, PACK_DOC_FILES, PACK_ROOT_DIRS, packContent, ROOTLESS_FAMILY_DIRS } from './content.js'
export { DEFAULT_IGNORED_NAMES, packFromRecord, readFolder, type ReadFolderOptions } from './folder.js'
export {
  DEFAULT_LIMITS,
  GZIP_LEVEL,
  GZIP_OS_UNIX,
  readPwpack,
  writePwpack,
  type PwpackLimits,
} from './archive.js'
export { DIR_MODE, FILE_MODE, FIXED_MTIME } from './tar.js'
export { hashPack, legacyContentHash, sha256Hex } from './hash.js'
export {
  deriveAtoms,
  deriveManifest,
  IDENTITY_FILE,
  type DeriveManifestOptions,
} from './manifest.js'
export {
  LEGACY_ASSETS_DIR,
  MEDIA_DECLARATIONS_DIR,
  MEDIA_DIR,
  MEDIA_PROVENANCE_FILE,
  mediaDeclarations,
  readMediaProvenance,
  type PackMedia,
  type PackMediaDeclaration,
  type ProvenanceRead,
} from './media.js'
export {
  ATOM_FAMILIES,
  SUPPORTED_FORMAT_MAJOR,
  validatePack,
  type PackLayout,
  type PackValidation,
} from './validate.js'
