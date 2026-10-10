/**
 * Conventional Commits (loosened).
 *
 * Load-bearing rule = commit TYPE: feat→MINOR, fix→PATCH, BREAKING CHANGE→MAJOR.
 * Cosmetic rules (case, trailing period, line lengths) are relaxed so valid
 * commits stop getting blocked. Type-enum / type-empty / subject-empty stay on.
 *
 * CI: .github/workflows/commitlint.yml  ·  Local: npx commitlint --from=origin/main
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
    'subject-full-stop': [0],
    'body-max-line-length': [0, 'always', Infinity],
    'footer-max-line-length': [0, 'always', Infinity],
    // Header length is not checked: it has no effect on the version; the commit type is what matters.
    'header-max-length': [0],
  },
}
