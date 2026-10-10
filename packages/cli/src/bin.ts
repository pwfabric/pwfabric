#!/usr/bin/env node
import { main } from './index.js'

const code = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (line) => process.stdout.write(line + '\n'),
  err: (line) => process.stderr.write(line + '\n'),
  env: process.env,
})
process.exitCode = code
