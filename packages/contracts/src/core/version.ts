/**
 * Semantic Versioning Types
 *
 * PHASE0-WS1: Version types following SemVer 2.0.0
 *
 * @module @pwfabric/contracts/core/version
 */

// ============================================================
// SEMANTIC VERSION TYPE
// ============================================================

/**
 * Semantic version components
 */
export interface SemanticVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease?: string
  readonly build?: string
}

/**
 * Version string format: MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
 */
export type VersionString = `${number}.${number}.${number}${string}`

// ============================================================
// VERSION PARSING
// ============================================================

/**
 * SemVer regex pattern
 */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/**
 * Parse a version string into components
 */
export function parseVersion(version: string): SemanticVersion | null {
  const match = version.match(SEMVER_PATTERN)
  if (!match || !match[1] || !match[2] || !match[3]) return null

  const result: SemanticVersion = {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  }

  if (match[4]) {
    ;(result as { prerelease?: string }).prerelease = match[4]
  }

  if (match[5]) {
    ;(result as { build?: string }).build = match[5]
  }

  return result
}

/**
 * Convert a SemanticVersion to string format
 */
export function versionToString(version: SemanticVersion): VersionString {
  let str = `${version.major}.${version.minor}.${version.patch}`
  if (version.prerelease) str += `-${version.prerelease}`
  if (version.build) str += `+${version.build}`
  return str as VersionString
}

/**
 * Check if a string is a valid semantic version
 */
export function isValidVersion(version: string): boolean {
  return SEMVER_PATTERN.test(version)
}

// ============================================================
// VERSION COMPARISON
// ============================================================

/**
 * Comparison result
 */
export type ComparisonResult = -1 | 0 | 1

/**
 * Compare two semantic versions
 * Returns:
 *   -1 if a < b
 *    0 if a == b
 *    1 if a > b
 */
export function compareVersions(a: SemanticVersion, b: SemanticVersion): ComparisonResult {
  // Compare major
  if (a.major !== b.major) {
    return a.major < b.major ? -1 : 1
  }

  // Compare minor
  if (a.minor !== b.minor) {
    return a.minor < b.minor ? -1 : 1
  }

  // Compare patch
  if (a.patch !== b.patch) {
    return a.patch < b.patch ? -1 : 1
  }

  // Handle prerelease (presence means lower precedence than no prerelease)
  if (a.prerelease && !b.prerelease) return -1
  if (!a.prerelease && b.prerelease) return 1
  if (a.prerelease && b.prerelease) {
    // Lexicographic comparison for prerelease
    if (a.prerelease < b.prerelease) return -1
    if (a.prerelease > b.prerelease) return 1
  }

  return 0
}

/**
 * Check if version a is compatible with version b (same major, >= minor.patch)
 */
export function isCompatible(a: SemanticVersion, b: SemanticVersion): boolean {
  if (a.major !== b.major) return false
  if (a.major === 0) {
    // Pre-1.0: minor version changes are breaking
    return a.minor === b.minor && a.patch >= b.patch
  }
  // Post-1.0: minor/patch can be higher
  return a.minor > b.minor || (a.minor === b.minor && a.patch >= b.patch)
}

// ============================================================
// VERSION CONSTANTS
// ============================================================

/**
 * Initial development version
 */
export const INITIAL_VERSION: SemanticVersion = {
  major: 0,
  minor: 1,
  patch: 0,
}

/**
 * First stable version
 */
export const STABLE_VERSION: SemanticVersion = {
  major: 1,
  minor: 0,
  patch: 0,
}
