/**
 * Surface keyframe registry CSS generation (arbitrary `@keyframes`).
 *
 * The runtime ships a fixed set of `pw-*` keyframes in `SURFACE_BASE_CSS`
 * (pulse / fade-in / marquee / slide-up / slide-down / scale-in / spin /
 * bounce / spring-in), so `block.style.animation` could only reference those. A surface can
 * now declare arbitrary named keyframes via `appearance.config.keyframes`
 * (name → keyframe body); this module emits one `@keyframes <name>{<body>}` per
 * entry so a block can drive custom motion offline.
 *
 * Each name is PREFIXED with `pw-kf-` to avoid colliding with host-page or
 * runtime-shipped keyframes — so a surface declaring `{ wiggle: '…' }` makes the
 * animation available as `pw-kf-wiggle`, and a block references it via
 * `block.style.animation: 'pw-kf-wiggle 0.4s ease'`.
 *
 * The keyframe BODY passes through untouched (authors supply standard
 * `@keyframes` selector blocks, e.g. `0%{…}50%{…}100%{…}`). An empty/absent
 * registry emits zero bytes. The existing `prefers-reduced-motion` gate in
 * `SURFACE_BASE_CSS` neutralises these animations for users who opt out (it
 * matches by animation, not by keyframe name), so no extra gating is needed
 * here.
 *
 * @module @pwfabric/runtime/render/keyframes-css
 */

/** Prefix applied to every surface-declared keyframe name (collision guard). */
const KEYFRAME_PREFIX = 'pw-kf-'

/**
 * Build the surface keyframe CSS from the appearance `keyframes` registry
 * (name → keyframe body). Emits `@keyframes pw-kf-<name>{<body>}` for each
 * entry. Entries with an empty name or empty body are skipped. Returns '' when
 * the registry is empty/undefined (zero bytes emitted).
 */
export function buildKeyframesCss(
  keyframes: Readonly<Record<string, string>> | undefined
): string {
  if (!keyframes) return ''
  let css = ''
  for (const [name, body] of Object.entries(keyframes)) {
    if (!name || typeof body !== 'string' || body.trim().length === 0) continue
    css += `@keyframes ${KEYFRAME_PREFIX}${name}{${body}}`
  }
  return css
}
