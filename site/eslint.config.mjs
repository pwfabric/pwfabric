import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  {
    // Build output and content artefacts are not source — never lint them.
    ignores: ['.next/**', 'out/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Nextra `_meta` files are navigation config — an anonymous default
    // export is the documented Nextra convention for them.
    files: ['**/_meta.ts', '**/_meta.tsx'],
    rules: { 'import/no-anonymous-default-export': 'off' },
  },
]

export default eslintConfig
