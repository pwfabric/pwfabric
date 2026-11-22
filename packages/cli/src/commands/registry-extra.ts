import type { Command } from './types.js'
import { media } from './media.js'
import { locale } from './locale.js'
import { page } from './page.js'
import { upgrade } from './upgrade.js'
import { check } from './check.js'
import { compare } from './compare.js'
import { records } from './records.js'
import { doctorCommand } from './doctor.js'

/**
 * The commands that work on an app folder or a built pwapp after it exists
 * (3.5): kept in their own list so the main registry changes by one line.
 * `pwf help` prints them after the others, in this order.
 */
export const EXTRA_COMMANDS: readonly Command[] = [media, locale, page, upgrade, check, compare, records, doctorCommand]
