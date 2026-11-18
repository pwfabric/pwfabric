/**
 * `@pwfabric/authoring/block` — what a block calls when its bundle loads.
 *
 * A block written the documented way imports `defineBlock` from
 * `@pwfabric/authoring` and calls it on load, so a page that renders shipped
 * blocks seeds the `@pwfabric/authoring` global (`__pwfabric_sdk`). On a
 * visitor's page that global is the runtime plus THIS module, not the whole
 * kit: factories, the custom-block registry and the props validators are for
 * the tools that compose and check blocks, and a page runs none of them.
 * `@pwfabric/embed`'s embed.js seeds it so; any other host that serves blocks
 * to visitors can do the same.
 *
 * @module @pwfabric/authoring/block
 */
export {
  defineBlock,
  isCustomBlockDefinition,
  createBlockInstance,
  validateBlockDefinition,
  type BlockDefinitionIssue,
} from './define-block.js'
