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
 *   checkBlockProps(...) PackFolder      → receipt props that do not fit the block manifests (warnings)
 *   checkRowFields(pack) PackFolder      → row fields receipts read that their sources lack
 *   checkBlockTypes / checkBlockIds      → unknown block types; a block id used twice on a page (errors)
 *   checkDefaultCopy / checkErrorsAsText → words the app did not write; codes shown as text (warnings)
 *   connectionFieldSets  PackFolder      → the row fields each connection's engine declares
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
  PUBLIC_RESERVED_DIRS,
  PUBLIC_RESERVED_FILES,
  publicReservedReason,
  publicScriptReason,
  SUPPORTED_FORMAT_MAJOR,
  validatePack,
  zodImportLine,
  ZOD_REMEDY,
  type PackLayout,
  type PackValidation,
} from './validate.js'
export {
  atomManifestPath,
  BLOCK_PROP_ENUM,
  BLOCK_PROP_NOT_BINDABLE,
  BLOCK_PROP_SHAPE,
  BLOCK_PROP_TYPE,
  BLOCK_PROP_UNKNOWN,
  blockPropDescriptors,
  blockPropsCatalog,
  blockTypeNames,
  blockTypeNameParts,
  resolveBlockType,
  namedBlocksOf,
  ambiguousBlockTypeMessage,
  BLOCK_TYPE_AMBIGUOUS,
  checkBlockProps,
  checkReceiptBlockProps,
  nearestName,
  isBinding,
  isTemplate,
  type BlockPropDescriptor,
  type BlockPropsCatalog,
  type BlockPropsEntry,
  type BlockSource,
  type NamedBlock,
} from './block-props.js'
export {
  BLOCK_ID_DUPLICATE,
  checkAmbiguousBlockTypes,
  blockTypeFirstUses,
  checkBlockIds,
  checkBlockTypes,
  definedBlockTypes,
  UNKNOWN_BLOCK_TYPE,
  unknownBlockTypeIssue,
  walkReceiptBlocks,
  type PageReceipt,
} from './receipt-blocks.js'
export {
  BLOCK_DEFAULT_COPY,
  ERROR_BOUND_AS_TEXT,
  checkDefaultCopy,
  checkErrorsAsText,
  checkReceiptDefaultCopy,
  checkReceiptErrorsAsText,
} from './app-words.js'
export {
  checkReceiptRowFields,
  checkRowFields,
  connectionFieldSets,
  entityFieldSets,
  RECORD_ENVELOPE_FIELDS,
  rowFieldSets,
  type ConnectionFieldSets,
  type ConnectionRowFields,
  type RowFieldSets,
} from './row-fields.js'
